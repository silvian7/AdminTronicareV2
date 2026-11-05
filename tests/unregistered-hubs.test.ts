import { describe, expect, it } from "vitest";
import supertest from "supertest";
import { createApp } from "../server/app";
import { MemorySessions } from "../server/sessions";
import { decodeUnregisteredHubs } from "../shared/unregistered-hubs";
import type { UnregisteredHubsResponse } from "../shared/unregistered-hubs";
import type { Config } from "../server/config";
import { fixtureTransport, testConfig, testIdentity } from "./fixtures";

const route = "/api/core/unregistered-hubs";
const coreRoute = "/v1/coreadmin/unregistered-hubs";
const privateDetail = "synthetic-private-upstream-detail";

function sample(): UnregisteredHubsResponse {
  return {
    data: [
      {
        hubKind: "SYNTHETIC-KIND",
        serialNumber: "SYNTHETIC-SERIAL",
        firstSeenAt: "2026-11-04T10:00:00.000Z",
        lastSeenAt: "2026-11-05T11:00:00.000Z",
        rejectionCount: "3",
        hubTypeStatus: "registered",
      },
    ],
    limit: 100,
    hasMore: false,
    scanLimit: 10000,
    scannedMessageCount: 3,
    messagesLimited: false,
    observedAt: "2026-11-05T12:00:00.000Z",
  };
}

function mutable(): Record<string, unknown> {
  return sample() as unknown as Record<string, unknown>;
}
const first = (value: Record<string, unknown>) =>
  (value.data as Record<string, unknown>[])[0];

async function setup(
  level = 90,
  options: { mustChangePassword?: boolean; config?: Config } = {},
) {
  const config = options.config ?? testConfig;
  const fixture = fixtureTransport({
    ...testIdentity,
    level,
    userTypeId: String(level),
    mustChangePassword: options.mustChangePassword ?? false,
  });
  const api = supertest.agent(
    createApp(config, new MemorySessions(), fixture.transport),
  );
  const login = await api
    .post("/api/session/login")
    .set("Origin", config.publicOrigin)
    .send({ login: "fixture-admin", password: "fixture-password" });
  expect(login.status).toBe(200);
  return { api, fixture, csrf: login.body.csrf };
}

const invalid: [string, (value: Record<string, unknown>) => void][] = [
  ["missing rows", (value) => delete value.data],
  ["non-array rows", (value) => (value.data = {})],
  ["null row", (value) => (value.data = [null])],
  ["missing identity", (value) => delete first(value).hubKind],
  ["non-string identity", (value) => (first(value).hubKind = 123)],
  ["empty identity", (value) => (first(value).serialNumber = "")],
  [
    "overlong identity",
    (value) => (first(value).serialNumber = "X".repeat(129)),
  ],
  [
    "control character in identity",
    (value) => (first(value).hubKind = "SYNTHETIC\nKIND"),
  ],
  ["missing row count", (value) => delete first(value).rejectionCount],
  ["zero row count", (value) => (first(value).rejectionCount = "0")],
  ["negative row count", (value) => (first(value).rejectionCount = "-1")],
  ["fractional row count", (value) => (first(value).rejectionCount = "1.5")],
  [
    "row count above scan bound",
    (value) => (first(value).rejectionCount = "10001"),
  ],
  [
    "oversized integer row count",
    (value) => (first(value).rejectionCount = "9223372036854775807"),
  ],
  ["noncanonical row count", (value) => (first(value).rejectionCount = "03")],
  [
    "unknown HubType state",
    (value) => (first(value).hubTypeStatus = "unknown"),
  ],
  ["missing HubType state", (value) => delete first(value).hubTypeStatus],
  ["missing timestamp", (value) => delete first(value).firstSeenAt],
  [
    "non-UTC timestamp",
    (value) => (first(value).firstSeenAt = "2026-11-04T12:00:00.000+02:00"),
  ],
  [
    "timestamp without milliseconds",
    (value) => (first(value).firstSeenAt = "2026-11-04T10:00:00Z"),
  ],
  [
    "invalid calendar date",
    (value) => (first(value).firstSeenAt = "2026-02-30T10:00:00.000Z"),
  ],
  [
    "first seen after last seen",
    (value) => (first(value).firstSeenAt = "2026-11-05T11:00:00.001Z"),
  ],
  [
    "last seen after observation",
    (value) => (first(value).lastSeenAt = "2026-11-05T12:00:00.001Z"),
  ],
  ["invalid observation", (value) => (value.observedAt = "not-a-date")],
  ["missing fixed limit", (value) => delete value.limit],
  ["wrong fixed limit", (value) => (value.limit = 99)],
  ["wrong scan limit", (value) => (value.scanLimit = 9999)],
  ["missing scanned count", (value) => delete value.scannedMessageCount],
  ["negative scanned count", (value) => (value.scannedMessageCount = -1)],
  ["scan count above bound", (value) => (value.scannedMessageCount = 10001)],
  ["fractional scan count", (value) => (value.scannedMessageCount = 3.5)],
  [
    "returned counts exceed scan count",
    (value) => (value.scannedMessageCount = 2),
  ],
  ["non-boolean hasMore", (value) => (value.hasMore = "false")],
  ["missing messagesLimited", (value) => delete value.messagesLimited],
  ["non-boolean messagesLimited", (value) => (value.messagesLimited = 1)],
  ["hasMore with fewer than 100 rows", (value) => (value.hasMore = true)],
  [
    "limited scan below 10000 messages",
    (value) => (value.messagesLimited = true),
  ],
  [
    "duplicate exact identity",
    (value) => (value.data = [first(value), { ...first(value) }]),
  ],
  [
    "more than 100 groups",
    (value) => {
      const row = first(value);
      value.data = Array.from({ length: 101 }, (_, index) => ({
        ...row,
        serialNumber: String(index),
        rejectionCount: "1",
      }));
      value.scannedMessageCount = 101;
    },
  ],
];

describe("unregistered hub decoder", () => {
  it("normalizes wire decimal strings and browser numbers while stripping unknown fields", () => {
    const wire = mutable();
    wire.limit = "100";
    wire.scanLimit = "10000";
    wire.scannedMessageCount = "3";
    wire.privateDetail = privateDetail;
    first(wire).rawPayload = privateDetail;
    expect(decodeUnregisteredHubs(wire)).toEqual(sample());
    const browser = mutable();
    first(browser).rejectionCount = 3;
    expect(decodeUnregisteredHubs(browser)).toEqual(sample());
  });

  it("preserves exact case, spaces and bounded Unicode identity components", () => {
    const value = mutable();
    const row = first(value);
    row.hubKind = " SYNTHETIC-KIND ";
    row.serialNumber = "🛰".repeat(128);
    value.data = [row, { ...row, hubKind: " synthetic-kind " }];
    value.scannedMessageCount = 6;
    const result = decodeUnregisteredHubs(value);
    expect(result.data.map((entry) => entry.hubKind)).toEqual([
      " SYNTHETIC-KIND ",
      " synthetic-kind ",
    ]);
    expect(result.data[0].serialNumber).toBe("🛰".repeat(128));
  });

  it.each(["registered", "unregistered", "ambiguous"] as const)(
    "preserves HubType state %s independently of hub registration",
    (state) => {
      const value = mutable();
      first(value).hubTypeStatus = state;
      expect(decodeUnregisteredHubs(value).data[0].hubTypeStatus).toBe(state);
    },
  );

  it("accepts a complete empty response and an empty bounded scan with exclusions", () => {
    const empty = { ...sample(), data: [], scannedMessageCount: 0 };
    expect(decodeUnregisteredHubs(empty)).toEqual(empty);
    const excluded = {
      ...empty,
      scannedMessageCount: 10000,
      messagesLimited: true,
    };
    expect(decodeUnregisteredHubs(excluded)).toEqual(excluded);
  });

  it("accepts the maximum scan count and explicit group truncation", () => {
    const maximum = sample();
    maximum.data[0].rejectionCount = "10000";
    maximum.scannedMessageCount = 10000;
    expect(decodeUnregisteredHubs(maximum)).toEqual(maximum);
    const bounded = {
      ...sample(),
      data: Array.from({ length: 100 }, (_, index) => ({
        ...sample().data[0],
        serialNumber: String(index),
        rejectionCount: "1",
      })),
      scannedMessageCount: 10000,
      hasMore: true,
      messagesLimited: true,
    };
    expect(decodeUnregisteredHubs(bounded)).toEqual(bounded);
  });

  it("rejects sparse rows rather than returning a partial result", () => {
    expect(() =>
      decodeUnregisteredHubs({ ...sample(), data: Array(1) }),
    ).toThrow("Unregistered hub data is unavailable.");
  });

  it.each(invalid)("rejects %s with a value-free error", (_name, mutate) => {
    const value = mutable();
    mutate(value);
    expect(() => decodeUnregisteredHubs(value)).toThrow(
      "Unregistered hub data is unavailable.",
    );
  });
});

describe("unregistered hub BFF", () => {
  it("requires a session without contacting Core", async () => {
    const fixture = fixtureTransport();
    const api = supertest(
      createApp(testConfig, new MemorySessions(), fixture.transport),
    );
    expect((await api.get(route)).status).toBe(401);
    expect(fixture.calls).toHaveLength(0);
  });

  it.each([30, 89])("denies level %s before contacting Core", async (level) => {
    const { api, fixture } = await setup(level);
    const before = fixture.calls.length;
    expect((await api.get(route)).status).toBe(403);
    expect(fixture.calls).toHaveLength(before);
  });

  it("denies restrictive caregiver classification even at platform level", async () => {
    const { api, fixture } = await setup(90, {
      config: { ...testConfig, caregiverUserTypeIds: new Set(["90"]) },
    });
    const before = fixture.calls.length;
    const response = await api.get(route);
    expect(response.status).toBe(403);
    expect(response.body.message).toBe(
      "This account has read-only caregiver access.",
    );
    expect(fixture.calls).toHaveLength(before);
  });

  it("requires password-change completion before contacting Core", async () => {
    const { api, fixture } = await setup(90, { mustChangePassword: true });
    const before = fixture.calls.length;
    expect((await api.get(route)).status).toBe(403);
    expect(fixture.calls).toHaveLength(before);
  });

  it.each([90, 95])(
    "forwards only the fixed authenticated GET for platform level %s",
    async (level) => {
      const { api, fixture } = await setup(level);
      const upstream = mutable();
      upstream.privateDetail = privateDetail;
      first(upstream).rawPayload = privateDetail;
      fixture.respondNext(Response.json(upstream));
      const response = await api.get(route);
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toEqual(sample());
      const call = fixture.calls.at(-1)!;
      expect(call.url.origin).toBe(testConfig.origins.core);
      expect(call.url.pathname).toBe(coreRoute);
      expect(call.url.search).toBe("");
      expect(call.method).toBe("GET");
      expect(call.body).toBeUndefined();
      expect(call.headers.get("Token")).toBe("synthetic-session-token");
    },
  );

  it("normalizes upstream numeric counts through lossless wire decoding", async () => {
    const { api, fixture } = await setup();
    const value = mutable();
    first(value).rejectionCount = 3;
    fixture.respondNext(Response.json(value));
    expect((await api.get(route)).body).toEqual(sample());
  });

  it.each(["?limit=100", "?_organization=7", "?hubKind=example", "?x[y]=1"])(
    "rejects query %s before contacting Core",
    async (query) => {
      const { api, fixture } = await setup();
      const before = fixture.calls.length;
      expect((await api.get(`${route}${query}`)).status).toBe(400);
      expect(fixture.calls).toHaveLength(before);
    },
  );

  it("rejects an obsolete organization CSRF revision before contacting Core", async () => {
    const { api, fixture } = await setup();
    const before = fixture.calls.length;
    const response = await api
      .get(route)
      .set("X-CSRF-Token", "synthetic-obsolete-revision");
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("organization_context_changed");
    expect(fixture.calls).toHaveLength(before);
  });

  it("does not expose a mutation route", async () => {
    const { api, fixture, csrf } = await setup();
    const before = fixture.calls.length;
    const response = await api
      .post(route)
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(response.status).toBe(404);
    expect(fixture.calls).toHaveLength(before);
  });

  it("uses the explicit empty synthetic Core fixture", async () => {
    const { api } = await setup();
    expect((await api.get(route)).body).toEqual({
      data: [],
      limit: 100,
      hasMore: false,
      scanLimit: 10000,
      scannedMessageCount: 0,
      messagesLimited: false,
      observedAt: "2026-11-05T12:00:00.000Z",
    });
  });

  it.each(invalid)(
    "rejects %s without leaking a raw response",
    async (_name, mutate) => {
      const { api, fixture } = await setup();
      const value = mutable();
      mutate(value);
      value.privateDetail = privateDetail;
      fixture.respondNext(Response.json(value));
      const response = await api.get(route);
      expect(response.status).toBe(502);
      expect(response.body.data).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain(privateDetail);
    },
  );

  it.each([401, 403, 404, 503])(
    "preserves sanitized upstream HTTP %s errors",
    async (status) => {
      const { api, fixture } = await setup();
      fixture.respondNext(new Response(privateDetail, { status }));
      const response = await api.get(route);
      expect(response.status).toBe(status);
      expect(response.body.code).toBe(`upstream_${status}`);
      expect(response.body.data).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain(privateDetail);
    },
  );

  it("reports an unconfigured Core without forwarding the request", async () => {
    const origins = { ...testConfig.origins };
    delete origins.core;
    const { api, fixture } = await setup(90, {
      config: { ...testConfig, origins },
    });
    const before = fixture.calls.length;
    const response = await api.get(route);
    expect(response.status).toBe(503);
    expect(response.body.code).toBe("service_unconfigured");
    expect(fixture.calls).toHaveLength(before);
  });
});
