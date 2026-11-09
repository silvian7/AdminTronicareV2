import { describe, expect, it } from "vitest";
import supertest from "supertest";
import { createApp } from "../server/app";
import { MemorySessions } from "../server/sessions";
import {
  decodeQuarantinedMessage,
  decodeQuarantinedMessages,
  type QuarantinedMessage,
  type QuarantinedMessageDetail,
  type QuarantinedMessagesResponse,
} from "../shared/quarantined-messages";
import { fixtureTransport, testConfig, testIdentity } from "./fixtures";

const route = "/api/core/quarantined-messages";
const coreRoute = "/v1/coreadmin/quarantined-messages";
const privateBody = "synthetic-private-body-not-for-browser";
const row = (): QuarantinedMessage => ({
  id: "9223372036854775807",
  originItemId: "9007199254740993",
  messageUuid: "00000000-0000-4000-8000-000000000001",
  destination: "EXTERNAL_HISTORY",
  state: "AMBIGUOUS",
  createdAt: "2026-11-06T09:00:00.000Z",
  quarantinedAt: "2026-11-06T10:00:00.000Z",
  updatedAt: "2026-11-06T10:00:00.000Z",
  attemptCount: 1,
  errorCode: "AMBIGUOUS_RESPONSE",
  acknowledgedAt: null,
  deferredDelivery: null,
});
const sample = (): QuarantinedMessagesResponse => ({
  data: [row()],
  limit: 50,
  hasMore: false,
  nextCursor: null,
  observedAt: "2026-11-07T11:00:00.000Z",
  recoveryDetailsAvailable: false,
});
const detail = (): QuarantinedMessageDetail => ({
  message: {
    ...row(),
    contractVersion: "synthetic.v1",
    payloadSha256: "a".repeat(64),
    version: 3,
  },
  attempts: [
    {
      attemptNumber: 1,
      startedAt: "2026-11-06T09:59:00.000Z",
      completedAt: "2026-11-06T10:00:00.000Z",
      outcome: "AMBIGUOUS",
      protocolStatus: 500,
      durationMs: 50,
      errorCode: "AMBIGUOUS_RESPONSE",
    },
  ],
  attemptLimit: 100,
  attemptsHasMore: false,
  observedAt: sample().observedAt,
  recoveryDetailsAvailable: false,
});

async function setup(
  options: {
    level?: number;
    mustChangePassword?: boolean;
    caregiver?: boolean;
  } = {},
) {
  const config = options.caregiver
    ? { ...testConfig, caregiverUserTypeIds: new Set(["90"]) }
    : testConfig;
  const fixture = fixtureTransport({
    ...testIdentity,
    level: options.level ?? 90,
    userTypeId: String(options.level ?? 90),
    mustChangePassword: options.mustChangePassword ?? false,
  });
  const api = supertest.agent(
    createApp(config, new MemorySessions(), fixture.transport),
  );
  const login = await api
    .post("/api/session/login")
    .set("Origin", config.publicOrigin)
    .send({ login: "synthetic-admin", password: "synthetic-password" });
  expect(login.status).toBe(200);
  return { api, fixture, csrf: login.body.csrf as string };
}

describe("quarantine decoders", () => {
  it("preserves bigint identities and strips private/unrecognized properties", () => {
    const value = {
      ...sample(),
      raw: privateBody,
      data: [{ ...row(), payload: privateBody, error_detail: privateBody }],
    };
    expect(decodeQuarantinedMessages(value)).toEqual(sample());
    expect(
      decodeQuarantinedMessage(
        {
          ...detail(),
          privateBody,
          message: { ...detail().message, payload: privateBody },
        },
        row().id,
      ),
    ).toEqual(detail());
  });
  it("normalizes bounded lossless integer strings", () => {
    expect(
      decodeQuarantinedMessages({
        ...sample(),
        limit: "50",
        data: [{ ...row(), attemptCount: "1" }],
      }),
    ).toEqual(sample());
  });
  it("accepts an empty retained collection without claiming a total", () => {
    expect(decodeQuarantinedMessages({ ...sample(), data: [] }).data).toEqual(
      [],
    );
  });
  it.each([
    [
      "numeric identity",
      (v: any) => {
        v.data[0].id = 1;
      },
    ],
    [
      "noncanonical identity",
      (v: any) => {
        v.data[0].id = "01";
      },
    ],
    [
      "overflow identity",
      (v: any) => {
        v.data[0].id = "9223372036854775808";
      },
    ],
    [
      "unknown destination",
      (v: any) => {
        v.data[0].destination = "OTHER";
      },
    ],
    [
      "active queue state",
      (v: any) => {
        v.data[0].state = "PENDING";
      },
    ],
    [
      "free-form error",
      (v: any) => {
        v.data[0].errorCode = privateBody + " https://example.invalid";
      },
    ],
    [
      "invalid date",
      (v: any) => {
        v.data[0].createdAt = "2026-02-30T09:00:00.000Z";
      },
    ],
    [
      "future row",
      (v: any) => {
        v.data[0].updatedAt = "2026-11-08T00:00:00.000Z";
      },
    ],
    [
      "reversed row times",
      (v: any) => {
        v.data[0].quarantinedAt = "2026-11-05T00:00:00.000Z";
      },
    ],
    [
      "fractional count",
      (v: any) => {
        v.data[0].attemptCount = 1.5;
      },
    ],
    [
      "duplicate rows",
      (v: any) => {
        v.data.push(v.data[0]);
      },
    ],
    [
      "too many rows",
      (v: any) => {
        v.data = Array.from({ length: 51 }, (_, i) => ({
          ...row(),
          id: String(i + 1),
        }));
      },
    ],
    [
      "sparse rows",
      (v: any) => {
        v.data = Array(1);
      },
    ],
    [
      "untruthful hasMore",
      (v: any) => {
        v.hasMore = true;
        v.nextCursor = "cursor";
      },
    ],
    [
      "unneeded cursor",
      (v: any) => {
        v.nextCursor = "cursor";
      },
    ],
    [
      "missing coverage",
      (v: any) => {
        delete v.recoveryDetailsAvailable;
      },
    ],
    [
      "false recovery coverage",
      (v: any) => {
        v.data[0].deferredDelivery = {};
      },
    ],
  ] as const)("rejects %s with a value-free error", (_name, mutate) => {
    const value = structuredClone(sample());
    mutate(value);
    expect(() => decodeQuarantinedMessages(value)).toThrow(
      "Quarantined messages are unavailable.",
    );
  });
  it("checks filters and detail identity", () => {
    expect(() =>
      decodeQuarantinedMessages(sample(), { destination: "RULES" }),
    ).toThrow();
    expect(() =>
      decodeQuarantinedMessages(sample(), { state: "PERMANENT_FAILURE" }),
    ).toThrow();
    expect(() => decodeQuarantinedMessage(detail(), "1")).toThrow();
  });
  it.each([
    [
      "sparse attempts",
      (v: any) => {
        v.attempts = Array(1);
      },
    ],
    [
      "duplicate attempts",
      (v: any) => {
        v.attempts.push(v.attempts[0]);
      },
    ],
    [
      "unknown outcome",
      (v: any) => {
        v.attempts[0].outcome = "SUCCESS";
      },
    ],
    [
      "incomplete terminal attempt",
      (v: any) => {
        v.attempts[0].completedAt = null;
      },
    ],
    [
      "invalid protocol status",
      (v: any) => {
        v.attempts[0].protocolStatus = 99;
      },
    ],
    [
      "negative duration",
      (v: any) => {
        v.attempts[0].durationMs = -1;
      },
    ],
    [
      "invalid digest",
      (v: any) => {
        v.message.payloadSha256 = "x".repeat(64);
      },
    ],
    [
      "untruthful attempt limit",
      (v: any) => {
        v.attemptsHasMore = true;
      },
    ],
  ] as const)("rejects detail %s", (_name, mutate) => {
    const value = structuredClone(detail());
    mutate(value);
    expect(() => decodeQuarantinedMessage(value)).toThrow(
      "Quarantined messages are unavailable.",
    );
  });
});

describe("quarantine BFF", () => {
  it("requires authentication for list and detail before contacting Core", async () => {
    const fixture = fixtureTransport();
    const api = supertest(
      createApp(testConfig, new MemorySessions(), fixture.transport),
    );
    for (const path of [route, `${route}/1`])
      expect((await api.get(path)).status).toBe(401);
    expect(fixture.calls).toHaveLength(0);
  });
  it.each([{ level: 89 }, { caregiver: true }, { mustChangePassword: true }])(
    "denies restricted session %j before upstream",
    async (options) => {
      const { api, fixture } = await setup(options);
      const before = fixture.calls.length;
      for (const path of [route, `${route}/1`])
        expect((await api.get(path)).status).toBe(403);
      expect(fixture.calls).toHaveLength(before);
    },
  );
  it("forwards exact authenticated filters and strips private fields", async () => {
    const { api, fixture } = await setup();
    fixture.respondNext(
      Response.json({
        ...sample(),
        privateBody,
        data: [{ ...row(), payload: privateBody }],
      }),
    );
    const response = await api.get(route).query({
      destination: "EXTERNAL_HISTORY",
      state: "AMBIGUOUS",
      cursor: "opaque_cursor",
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(sample());
    expect(response.headers["cache-control"]).toBe("no-store");
    const call = fixture.calls.at(-1)!;
    expect(call.url.origin).toBe(testConfig.origins.core);
    expect(call.url.pathname).toBe(coreRoute);
    expect(Object.fromEntries(call.url.searchParams)).toEqual({
      destination: "EXTERNAL_HISTORY",
      state: "AMBIGUOUS",
      cursor: "opaque_cursor",
    });
    expect(call.method).toBe("GET");
    expect(call.headers.get("Token")).toBe("synthetic-session-token");
    expect(call.body).toBeUndefined();
  });
  it("reads detail using the exact bigint identity", async () => {
    const { api, fixture } = await setup();
    fixture.respondNext(Response.json(detail()));
    const response = await api.get(`${route}/${row().id}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(detail());
    expect(fixture.calls.at(-1)!.url.pathname).toBe(`${coreRoute}/${row().id}`);
  });
  it.each([
    "?limit=500",
    "?_organization=7",
    "?state=LEASED",
    "?destination=rules",
    "?cursor=a%3Db",
    "?cursor=a&cursor=b",
    "?destination=RULES&destination=ASSETS",
  ])("rejects query %s before upstream", async (query) => {
    const { api, fixture } = await setup();
    const before = fixture.calls.length;
    expect((await api.get(route + query)).status).toBe(400);
    expect(fixture.calls).toHaveLength(before);
  });
  it.each(["/0", "/01", "/9223372036854775808", "/1?cursor=a"])(
    "rejects detail path %s before upstream",
    async (suffix) => {
      const { api, fixture } = await setup();
      const before = fixture.calls.length;
      expect((await api.get(route + suffix)).status).toBe(400);
      expect(fixture.calls).toHaveLength(before);
    },
  );
  it.each([404, 405, 500, 503])(
    "reports upstream %s as unavailable without body leakage",
    async (status) => {
      const { api, fixture } = await setup();
      fixture.respondNext(new Response(privateBody, { status }));
      const response = await api.get(route);
      expect(response.status).toBe(503);
      expect(JSON.stringify(response.body)).not.toContain(privateBody);
    },
  );
  it("rejects malformed or mismatched upstream records without leakage", async () => {
    const { api, fixture } = await setup();
    fixture.respondNext(
      Response.json({
        ...sample(),
        data: [{ ...row(), id: 123, error_detail: privateBody }],
      }),
    );
    expect((await api.get(route)).status).toBe(502);
    fixture.respondNext(
      Response.json({ ...detail(), message: { ...detail().message, id: "1" } }),
    );
    const response = await api.get(`${route}/${row().id}`);
    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).not.toContain(privateBody);
  });
  it("preserves honest detail not-found status", async () => {
    const { api, fixture } = await setup();
    fixture.respondNext(new Response(privateBody, { status: 404 }));
    const response = await api.get(`${route}/1`);
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain(privateBody);
  });
  it("provides no replay or acknowledgement mutation route", async () => {
    const { api, fixture, csrf } = await setup();
    const before = fixture.calls.length;
    for (const method of ["post", "put", "delete"] as const) {
      expect(
        (
          await api[method](`${route}/1`)
            .set("Origin", testConfig.publicOrigin)
            .set("X-CSRF-Token", csrf)
            .send({})
        ).status,
      ).toBe(404);
    }
    expect(fixture.calls).toHaveLength(before);
  });
});
