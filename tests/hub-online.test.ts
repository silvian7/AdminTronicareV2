import { describe, expect, it } from "vitest";
import supertest from "supertest";
import { createApp } from "../server/app";
import { MemorySessions } from "../server/sessions";
import {
  decodeHubOnline,
  type HubOnlineHours,
  type HubOnlineResponse,
} from "../shared/hub-online";
import { resourceMap, type Identity } from "../shared/resources";
import {
  fixtureRecord,
  fixtureTransport,
  testConfig,
  testIdentity,
} from "./fixtures";
import type { Transport } from "../server/upstream";

const hubId = "9223372036854775806";
const route = `/api/hubs/${hubId}/online`;
const upstreamRoute = `/v1/hubs/${hubId}/online`;

function sample(hours: HubOnlineHours = 24): HubOnlineResponse {
  const end = Date.parse("2026-11-07T12:00:00.000Z");
  const start = end - hours * 3_600_000;
  return {
    hubId,
    hours,
    rangeStart: new Date(start).toISOString(),
    rangeEnd: new Date(end).toISOString(),
    observedAt: new Date(end).toISOString(),
    bucketSeconds: 300,
    coverage: "retained_only",
    limited: false,
    scanLimit: 100000,
    scannedItemCount: 0,
    buckets: Array.from({ length: hours * 12 }, (_, i) => ({
      start: new Date(start + i * 300_000).toISOString(),
      end: new Date(start + (i + 1) * 300_000).toISOString(),
      receivedCount: "0",
    })),
  };
}

describe("hub online history contract", () => {
  it.each([24, 48, 168] as const)(
    "accepts exact %s-hour empty retained-activity windows",
    (hours) => {
      expect(decodeHubOnline(sample(hours), hubId, hours)).toEqual(
        sample(hours),
      );
    },
  );
  it("keeps count-bearing buckets and truncated prefixes distinct", () => {
    const value = sample();
    value.buckets[10].receivedCount = "3";
    value.scannedItemCount = 3;
    expect(decodeHubOnline(value).buckets[10].receivedCount).toBe("3");
    value.limited = true;
    value.scannedItemCount = 100000;
    value.buckets.slice(0, 10).forEach((row) => (row.receivedCount = null));
    expect(decodeHubOnline(value).buckets[0].receivedCount).toBeNull();
  });
  const invalid: [string, (value: HubOnlineResponse) => void][] = [
    ["wrong hub", (value) => (value.hubId = "2")],
    ["wrong span", (value) => (value.hours = 48)],
    ["incomplete window", (value) => value.buckets.pop()],
    [
      "overlapping bucket",
      (value) => (value.buckets[1].start = value.buckets[0].start),
    ],
    ["gap", (value) => (value.buckets[1].end = value.buckets[2].end)],
    ["invalid date", (value) => (value.rangeEnd = "2026-02-30T12:00:00Z")],
    [
      "non-UTC date",
      (value) => (value.observedAt = "2026-11-07T13:00:00+01:00"),
    ],
    [
      "negative event count",
      (value) => (value.buckets[0].receivedCount = "-1"),
    ],
    ["noncanonical count", (value) => (value.buckets[0].receivedCount = "01")],
    ["unexplained events", (value) => (value.buckets[0].receivedCount = "1")],
    ["missing events", (value) => (value.scannedItemCount = 1)],
    [
      "unflagged incomplete data",
      (value) => (value.buckets[0].receivedCount = null),
    ],
    ["unexplained scan limit", (value) => (value.limited = true)],
    [
      "incomplete non-prefix",
      (value) => {
        value.limited = true;
        value.scannedItemCount = 100000;
        value.buckets[1].receivedCount = null;
      },
    ],
  ];
  it.each(invalid)(
    "rejects %s instead of drawing false availability",
    (_, change) => {
      const value = sample();
      change(value);
      expect(() => decodeHubOnline(value, hubId, 24)).toThrow(
        "Hub online history is unavailable.",
      );
    },
  );
  it("rejects numeric identities rather than rounding int64 IDs", () => {
    expect(() =>
      decodeHubOnline({ ...sample(), hubId: Number(hubId) }),
    ).toThrow();
  });
});

const ordinary: Identity = {
  ...testIdentity,
  level: 30,
  userTypeId: "30",
  permissions: [{ entity: "hubs", rights: "r" }],
};
async function setup(identity: Identity = testIdentity) {
  const fixture = fixtureTransport(identity);
  fixture.records.set("hubs", [
    fixtureRecord(resourceMap.hubs, hubId, {
      m_nIDAsset: "1",
      m_nIDOrganization: "7",
    }),
  ]);
  let status = 200;
  let reply: unknown = sample();
  let beforeResponse: (() => void) | undefined;
  const reads: { url: URL; headers: Headers; method: string }[] = [];
  const transport: Transport = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === upstreamRoute) {
      reads.push({
        url,
        headers: new Headers(init?.headers),
        method: init?.method ?? "GET",
      });
      beforeResponse?.();
      return Response.json(reply, { status });
    }
    return fixture.transport(input, init);
  };
  const api = supertest.agent(
    createApp(
      {
        ...testConfig,
        caregiverUserTypeIds: new Set(
          identity.caregiverReadOnly ? [identity.userTypeId] : [],
        ),
      },
      new MemorySessions(),
      transport,
    ),
  );
  const login = await api
    .post("/api/session/login")
    .set("Origin", testConfig.publicOrigin)
    .send({ login: "synthetic-reader", password: "synthetic-password" });
  expect(login.status).toBe(200);
  return {
    api,
    fixture,
    reads,
    setReply: (value: unknown) => {
      reply = value;
    },
    setStatus: (value: number) => {
      status = value;
    },
    beforeResponse: (fn: () => void) => {
      beforeResponse = fn;
    },
  };
}

describe("caller-scoped hub online history gateway", () => {
  it.each([testIdentity, ordinary])(
    "uses the caller's exact visible hub with read-only rights at level $level",
    async (identity) => {
      const { api, reads } = await setup(identity);
      const response = await api.get(route);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(sample());
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(reads).toHaveLength(1);
      expect(reads[0].method).toBe("GET");
      expect(reads[0].headers.get("Token")).toBe("synthetic-session-token");
      expect(reads[0].url.searchParams.toString()).toBe("hours=24");
    },
  );
  it("forwards only a bounded requested span", async () => {
    const { api, reads, setReply } = await setup();
    setReply(sample(48));
    expect((await api.get(route + "?hours=48&_organization=7")).status).toBe(
      200,
    );
    expect(reads[0].url.searchParams.toString()).toBe("hours=48");
  });
  it.each([
    "?hours=0",
    "?hours=720",
    "?hours=024",
    "?hours=24&hours=48",
    "?start=2026-11-01",
    "?_organization=01",
    "?_organization=7&_organization=8",
  ])(
    "rejects unsupported parameters %s before upstream reads",
    async (query) => {
      const { api, reads } = await setup();
      expect((await api.get(route + query)).status).toBe(400);
      expect(reads).toHaveLength(0);
    },
  );
  it("denies a selected-organization mismatch", async () => {
    const { api, reads } = await setup();
    expect((await api.get(route + "?_organization=8")).status).toBe(403);
    expect(reads).toHaveLength(0);
  });
  it("denies an out-of-scope hub before requesting its history", async () => {
    const { api, fixture, reads } = await setup(ordinary);
    fixture.records.get("hubs")![0].m_nIDAsset = "2";
    expect((await api.get(route)).status).toBe(403);
    expect(reads).toHaveLength(0);
  });
  it("revalidates hub scope after the history response", async () => {
    const test = await setup(ordinary);
    test.beforeResponse(() => {
      test.fixture.records.get("hubs")![0].m_nIDAsset = "2";
    });
    const response = await test.api.get(route);
    expect(response.status).toBe(403);
    expect(response.body).not.toHaveProperty("buckets");
  });
  it.each([
    { ...ordinary, permissions: [] },
    { ...testIdentity, caregiverReadOnly: true },
    { ...testIdentity, mustChangePassword: true },
  ])(
    "denies technical history when account access does not permit it",
    async (identity) => {
      const { api, reads } = await setup(identity);
      expect((await api.get(route)).status).toBe(403);
      expect(reads).toHaveLength(0);
    },
  );
  it.each([401, 403, 404, 405, 503])(
    "does not turn upstream %s into an empty graph",
    async (status) => {
      const { api, reads, setStatus } = await setup();
      setStatus(status);
      const response = await api.get(route);
      expect(response.status).toBe([404, 405].includes(status) ? 503 : status);
      expect(response.body).not.toHaveProperty("buckets");
      expect(reads).toHaveLength(1);
    },
  );
  it("rejects a response for a different hub", async () => {
    const { api, setReply } = await setup();
    setReply({ ...sample(), hubId: "2" });
    const response = await api.get(route);
    expect(response.status).toBe(502);
    expect(response.body).not.toHaveProperty("buckets");
  });
});
