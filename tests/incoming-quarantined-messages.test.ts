import { describe, expect, it } from "vitest";
import supertest from "supertest";
import { createApp } from "../server/app";
import { MemorySessions } from "../server/sessions";
import {
  decodeIncomingQuarantinedMessage,
  decodeIncomingQuarantinedMessages,
  incomingQuarantineSources,
  type IncomingQuarantinedMessage,
  type IncomingQuarantinedMessageDetail,
  type IncomingQuarantinedMessagesResponse,
  type IncomingQuarantineSource,
} from "../shared/incoming-quarantined-messages";
import { fixtureTransport, testConfig, testIdentity } from "./fixtures";

const route = "/api/quarantine/incoming";
const privateBody = "synthetic-private-mqtt-body";
function row(
  source: IncomingQuarantineSource = "CORE_TELEMETRY",
): IncomingQuarantinedMessage {
  return {
    id: "9223372036854775807",
    source,
    state: source === "CORE_TELEMETRY" ? "REJECTED" : "PERMANENT_FAILURE",
    createdAt: "2026-11-06T09:00:00.000Z",
    quarantinedAt: "2026-11-06T10:00:00.000Z",
    updatedAt: "2026-11-06T10:00:00.000Z",
    attemptCount: 1,
    outcomeCode: "INVALID_SHAPE",
    errorCode: null,
    parentId: null,
    itemCount: null,
    parserFamily: null,
    route: null,
    disposition: null,
  };
}
function sample(
  source: IncomingQuarantineSource = "CORE_TELEMETRY",
): IncomingQuarantinedMessagesResponse {
  return {
    source,
    data: [row(source)],
    limit: 50,
    hasMore: false,
    nextCursor: null,
    observedAt: "2026-11-07T11:00:00.000Z",
    payloadAvailable: false,
    scanLimit: 100000,
    scannedRowCount: 1,
    scanLimited: false,
  };
}
function detail(
  source: IncomingQuarantineSource = "CORE_TELEMETRY",
): IncomingQuarantinedMessageDetail {
  return {
    source,
    message: { ...row(source), version: 2 },
    attempts: [
      {
        attemptNumber: 1,
        startedAt: "2026-11-06T09:59:00.000Z",
        completedAt: "2026-11-06T10:00:00.000Z",
        outcome: "PERMANENT_FAILURE",
        outcomeCode: "INVALID_SHAPE",
        errorCode: null,
        protocolStatus: null,
        durationMs: null,
        component:
          source === "CORE_TELEMETRY"
            ? "CORE_PROCESSING"
            : source === "MQTT_INGRESS"
              ? "PARSER"
              : "CORE_PRIMARY",
      },
    ],
    attemptLimit: 100,
    attemptsHasMore: false,
    observedAt: sample().observedAt,
    payloadAvailable: false,
  };
}
async function setup(
  options: {
    level?: number;
    mustChangePassword?: boolean;
    caregiver?: boolean;
  } = {},
) {
  const fixture = fixtureTransport({
    ...testIdentity,
    level: options.level ?? 90,
    mustChangePassword: options.mustChangePassword ?? false,
  });
  const config = options.caregiver
    ? { ...testConfig, caregiverUserTypeIds: new Set(["90"]) }
    : testConfig;
  const api = supertest.agent(
    createApp(config, new MemorySessions(), fixture.transport),
  );
  expect(
    (
      await api
        .post("/api/session/login")
        .set("Origin", config.publicOrigin)
        .send({ login: "synthetic", password: "synthetic" })
    ).status,
  ).toBe(200);
  return { api, fixture };
}

describe("incoming quarantine decoders", () => {
  it.each(incomingQuarantineSources)(
    "decodes %s while stripping protected properties",
    (source) => {
      const value = sample(source);
      expect(
        decodeIncomingQuarantinedMessages(
          {
            ...value,
            payload: privateBody,
            data: [
              {
                ...row(source),
                topic: privateBody,
                item: { secret: privateBody },
              },
            ],
          },
          source,
        ),
      ).toEqual(value);
      expect(
        decodeIncomingQuarantinedMessage(
          { ...detail(source), payload: privateBody },
          source,
          row().id,
        ),
      ).toEqual(detail(source));
    },
  );
  it("preserves shadow context independently of permanent-failure status", () => {
    const value = sample("MQTT_INGRESS");
    value.data[0].disposition = "SHADOW";
    expect(decodeIncomingQuarantinedMessages(value).data[0].disposition).toBe(
      "SHADOW",
    );
  });
  it("allows continuation through a capped empty or short checked range", () => {
    for (const data of [[], sample().data]) {
      const value = {
        ...sample(),
        data,
        hasMore: true,
        nextCursor: "bounded_next_range",
        scanLimited: true,
        scannedRowCount: 100000,
      };
      expect(decodeIncomingQuarantinedMessages(value)).toEqual(value);
    }
  });
  it("allows same attempt numbers on independent primary/mirror routes", () => {
    const value = detail("BRIDGE_CORE_DELIVERY");
    value.attempts.push({ ...value.attempts[0], component: "CORE_MIRROR" });
    expect(decodeIncomingQuarantinedMessage(value).attempts).toHaveLength(2);
  });
  it.each([
    [
      "numeric ID",
      (v: any) => {
        v.data[0].id = 1;
      },
    ],
    [
      "overflow ID",
      (v: any) => {
        v.data[0].id = "9223372036854775808";
      },
    ],
    [
      "cross-source row",
      (v: any) => {
        v.data[0].source = "MQTT_INGRESS";
      },
    ],
    [
      "nonquarantine state",
      (v: any) => {
        v.data[0].state = "PROCESSED";
      },
    ],
    [
      "duplicate ID",
      (v: any) => {
        v.data.push(v.data[0]);
        v.scannedRowCount = 2;
      },
    ],
    [
      "wrong ordering",
      (v: any) => {
        v.data.unshift({ ...v.data[0], id: "1" });
        v.scannedRowCount = 2;
      },
    ],
    [
      "sparse data",
      (v: any) => {
        v.data = Array(1);
      },
    ],
    [
      "future date",
      (v: any) => {
        v.data[0].updatedAt = "2026-11-08T00:00:00.000Z";
      },
    ],
    [
      "invalid date",
      (v: any) => {
        v.data[0].createdAt = "2026-02-30T00:00:00.000Z";
      },
    ],
    [
      "raw code text",
      (v: any) => {
        v.data[0].errorCode = privateBody + " with text";
      },
    ],
    [
      "unknown mode",
      (v: any) => {
        v.data[0].disposition = "LIVE";
      },
    ],
    [
      "payload exposure flag",
      (v: any) => {
        v.payloadAvailable = true;
      },
    ],
    [
      "missing scan coverage",
      (v: any) => {
        delete v.scanLimited;
      },
    ],
    [
      "invalid scan count",
      (v: any) => {
        v.scannedRowCount = 100001;
      },
    ],
    [
      "false complete capped scan",
      (v: any) => {
        v.scanLimited = true;
        v.scannedRowCount = 100000;
      },
    ],
    [
      "uncapped short-page continuation",
      (v: any) => {
        v.hasMore = true;
        v.nextCursor = "next";
      },
    ],
  ] as const)("rejects %s", (_name, mutate) => {
    const value = structuredClone(sample());
    mutate(value);
    expect(() => decodeIncomingQuarantinedMessages(value)).toThrow(
      "Incoming quarantined messages are unavailable.",
    );
  });
  it("rejects cross-source and cross-state filters and detail identity mismatches", () => {
    expect(() =>
      decodeIncomingQuarantinedMessages(sample(), "MQTT_INGRESS"),
    ).toThrow();
    expect(() =>
      decodeIncomingQuarantinedMessages(sample(), "CORE_TELEMETRY", "BLOCKED"),
    ).toThrow();
    expect(() =>
      decodeIncomingQuarantinedMessage(detail(), "CORE_TELEMETRY", "1"),
    ).toThrow();
    const invalidBridge = sample("MQTT_INGRESS");
    invalidBridge.data[0].state = "REJECTED";
    expect(() => decodeIncomingQuarantinedMessages(invalidBridge)).toThrow();
  });
  it.each([
    [
      "sparse attempts",
      (v: any) => {
        v.attempts = Array(1);
      },
    ],
    [
      "duplicate route attempts",
      (v: any) => {
        v.attempts.push(v.attempts[0]);
      },
    ],
    [
      "incomplete terminal attempt",
      (v: any) => {
        v.attempts[0].completedAt = null;
      },
    ],
    [
      "unknown outcome",
      (v: any) => {
        v.attempts[0].outcome = "OK";
      },
    ],
    [
      "invalid status",
      (v: any) => {
        v.attempts[0].protocolStatus = 600;
      },
    ],
    [
      "untruthful truncation",
      (v: any) => {
        v.attemptsHasMore = true;
      },
    ],
  ] as const)("rejects detail %s", (_name, mutate) => {
    const value = structuredClone(detail());
    mutate(value);
    expect(() => decodeIncomingQuarantinedMessage(value)).toThrow(
      "Incoming quarantined messages are unavailable.",
    );
  });
});

describe("incoming quarantine BFF", () => {
  it("requires a session without contacting either service", async () => {
    const fixture = fixtureTransport(),
      api = supertest(
        createApp(testConfig, new MemorySessions(), fixture.transport),
      );
    expect(
      (await api.get(route).query({ source: "CORE_TELEMETRY" })).status,
    ).toBe(401);
    expect(
      (await api.get(`${route}/1`).query({ source: "MQTT_INGRESS" })).status,
    ).toBe(401);
    expect(fixture.calls).toHaveLength(0);
  });
  it.each([{ level: 89 }, { caregiver: true }, { mustChangePassword: true }])(
    "denies restricted session %j",
    async (options) => {
      const { api, fixture } = await setup(options),
        before = fixture.calls.length;
      expect(
        (await api.get(route).query({ source: "CORE_TELEMETRY" })).status,
      ).toBe(403);
      expect(
        (await api.get(`${route}/1`).query({ source: "MQTT_INGRESS" })).status,
      ).toBe(403);
      expect(fixture.calls).toHaveLength(before);
    },
  );
  it.each(incomingQuarantineSources)(
    "uses the exact source service for %s list and detail",
    async (source) => {
      const { api, fixture } = await setup();
      fixture.respondNext(Response.json(sample(source)));
      const response = await api.get(route).query({
        source,
        state: source === "CORE_TELEMETRY" ? "REJECTED" : "PERMANENT_FAILURE",
        cursor: "opaque_cursor",
      });
      expect(response.status).toBe(200);
      expect(response.body).toEqual(sample(source));
      expect(response.headers["cache-control"]).toBe("no-store");
      const service = source === "CORE_TELEMETRY" ? "core" : "mqttbridge";
      const upstream =
        source === "CORE_TELEMETRY"
          ? "/v1/coreadmin/incoming-quarantined-messages"
          : "/v1/mqttbridgeadmin/incoming-quarantined-messages";
      const call = fixture.calls.at(-1)!;
      expect(call.url.origin).toBe(testConfig.origins[service]);
      expect(call.url.pathname).toBe(upstream);
      expect(call.url.searchParams.get("source")).toBe(source);
      expect(call.headers.get("Token")).toBe("synthetic-session-token");
      expect(call.method).toBe("GET");
      fixture.respondNext(Response.json(detail(source)));
      expect(
        (await api.get(`${route}/${row().id}`).query({ source })).body,
      ).toEqual(detail(source));
      expect(fixture.calls.at(-1)!.url.pathname).toBe(
        `${upstream}/${row().id}`,
      );
    },
  );
  it.each([
    "",
    "?source=OTHER",
    "?source=MQTT_INGRESS&state=BLOCKED",
    "?source=CORE_TELEMETRY&source=MQTT_INGRESS",
    "?source=CORE_TELEMETRY&limit=500",
    "?source=CORE_TELEMETRY&cursor=with%3Dpadding",
  ])("rejects invalid filter %s before upstream", async (query) => {
    const { api, fixture } = await setup(),
      before = fixture.calls.length;
    expect((await api.get(route + query)).status).toBe(400);
    expect(fixture.calls).toHaveLength(before);
  });
  it("rejects unknown detail filters and identifiers before upstream", async () => {
    const { api, fixture } = await setup(),
      before = fixture.calls.length;
    for (const path of [
      `${route}/01?source=CORE_TELEMETRY`,
      `${route}/1?source=CORE_TELEMETRY&cursor=x`,
    ])
      expect((await api.get(path)).status).toBe(400);
    expect(fixture.calls).toHaveLength(before);
  });
  it("does not expose protected upstream errors or malformed records", async () => {
    const { api, fixture } = await setup();
    fixture.respondNext(new Response(privateBody, { status: 500 }));
    const response = await api.get(route).query({ source: "CORE_TELEMETRY" });
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain(privateBody);
    fixture.respondNext(
      Response.json({ ...sample("MQTT_INGRESS"), topic: privateBody }),
    );
    expect(
      (await api.get(route).query({ source: "CORE_TELEMETRY" })).status,
    ).toBe(502);
  });
  it("reports unsupported service endpoints as unavailable rather than empty", async () => {
    const { api, fixture } = await setup();
    fixture.respondNext(new Response(null, { status: 404 }));
    expect(
      (await api.get(route).query({ source: "MQTT_INGRESS" })).status,
    ).toBe(503);
  });
});
