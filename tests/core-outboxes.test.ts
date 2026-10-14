import { describe, expect, it } from "vitest";
import supertest from "supertest";
import { createApp } from "../server/app";
import { MemorySessions } from "../server/sessions";
import { fixtureTransport, testConfig, testIdentity } from "./fixtures";

function coreInfo() {
  return {
    Status: true,
    privateDetail: "synthetic-internal-detail",
    Outboxes: {
      rules: { Size: 3, Latency_Seconds: 7.25 },
      assets: { Size: 5, Latency_Seconds: 0.5 },
      mqtt_information: { Size: 0, Latency_Seconds: 0 },
      external_history: { Size: 11, Latency_Seconds: 123.75 },
    },
  };
}

async function setup(level = 90) {
  const fixture = fixtureTransport({ ...testIdentity, level });
  const api = supertest.agent(
    createApp(testConfig, new MemorySessions(), fixture.transport),
  );
  const login = await api
    .post("/api/session/login")
    .set("Origin", testConfig.publicOrigin)
    .send({ login: "fixture-admin", password: "fixture-password" });
  expect(login.status).toBe(200);
  return { api, fixture };
}

describe("core outbox metrics", () => {
  it("requires a session before contacting core", async () => {
    const fixture = fixtureTransport();
    const api = supertest(
      createApp(testConfig, new MemorySessions(), fixture.transport),
    );
    expect((await api.get("/api/core/outboxes")).status).toBe(401);
    expect(fixture.calls).toHaveLength(0);
  });

  it.each([30, 89])("denies level %s before contacting core", async (level) => {
    const { api, fixture } = await setup(level);
    const callsBefore = fixture.calls.length;
    expect((await api.get("/api/core/outboxes")).status).toBe(403);
    expect(fixture.calls).toHaveLength(callsBefore);
  });

  it.each([90, 95])(
    "returns only the ordered outbox metrics for platform level %s",
    async (level) => {
      const { api, fixture } = await setup(level);
      fixture.respondNext(Response.json(coreInfo()));
      const response = await api.get("/api/core/outboxes");
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toEqual({
        data: [
          { destination: "rules", size: "3", latencySeconds: "7.25" },
          { destination: "assets", size: "5", latencySeconds: "0.5" },
          { destination: "mqtt_information", size: "0", latencySeconds: "0" },
          {
            destination: "external_history",
            size: "11",
            latencySeconds: "123.75",
          },
        ],
      });
      const call = fixture.calls.at(-1)!;
      expect(call.url.origin).toBe(testConfig.origins.core);
      expect(call.url.pathname).toBe("/v1/coreadmin/info");
      expect(call.method).toBe("GET");
      expect(call.headers.get("Token")).toBe("synthetic-session-token");
    },
  );

  it("preserves a JSON integer size above JavaScript's safe integer limit", async () => {
    const { api, fixture } = await setup();
    fixture.respondNext(
      new Response(
        JSON.stringify(coreInfo()).replace(
          '"Size":3',
          '"Size":9223372036854775807',
        ),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    const response = await api.get("/api/core/outboxes");
    expect(response.status).toBe(200);
    expect(response.body.data[0].size).toBe("9223372036854775807");
  });

  it("returns zero sizes and latencies for empty outboxes", async () => {
    const { api, fixture } = await setup();
    const info = coreInfo();
    for (const box of Object.values(info.Outboxes)) {
      box.Size = 0;
      box.Latency_Seconds = 0;
    }
    fixture.respondNext(Response.json(info));
    const response = await api.get("/api/core/outboxes");
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(4);
    for (const box of response.body.data) {
      expect(box.size).toBe("0");
      expect(box.latencySeconds).toBe("0");
    }
  });

  it.each([
    ["missing Outboxes", { Status: true }],
    [
      "missing destination",
      { Outboxes: { ...coreInfo().Outboxes, assets: undefined } },
    ],
    [
      "missing size",
      { Outboxes: { ...coreInfo().Outboxes, rules: { Latency_Seconds: 1 } } },
    ],
    [
      "negative size",
      {
        Outboxes: {
          ...coreInfo().Outboxes,
          rules: { Size: -1, Latency_Seconds: 1 },
        },
      },
    ],
    [
      "fractional size",
      {
        Outboxes: {
          ...coreInfo().Outboxes,
          rules: { Size: 1.5, Latency_Seconds: 1 },
        },
      },
    ],
    [
      "missing latency",
      { Outboxes: { ...coreInfo().Outboxes, rules: { Size: 1 } } },
    ],
    [
      "invalid latency",
      {
        Outboxes: {
          ...coreInfo().Outboxes,
          rules: { Size: 1, Latency_Seconds: "unknown" },
        },
      },
    ],
    [
      "negative latency",
      {
        Outboxes: {
          ...coreInfo().Outboxes,
          rules: { Size: 1, Latency_Seconds: -1 },
        },
      },
    ],
  ])("rejects %s without returning partial metrics", async (_name, info) => {
    const { api, fixture } = await setup();
    fixture.respondNext(
      Response.json({
        ...info,
        privateDetail: "synthetic-private-upstream-detail",
      }),
    );
    const response = await api.get("/api/core/outboxes");
    expect(response.status).toBe(502);
    expect(response.body.data).toBeUndefined();
    expect(response.body.message).toEqual(expect.any(String));
    expect(JSON.stringify(response.body)).not.toContain(
      "synthetic-private-upstream-detail",
    );
  });

  it.each([403, 503])(
    "uses the existing upstream error handling for HTTP %s",
    async (status) => {
      const { api, fixture } = await setup();
      fixture.respondNext(
        new Response("synthetic-private-upstream-detail", { status }),
      );
      const response = await api.get("/api/core/outboxes");
      expect(response.status).toBe(status);
      expect(response.body.data).toBeUndefined();
      expect(response.body.code).toBe(`upstream_${status}`);
      expect(JSON.stringify(response.body)).not.toContain(
        "synthetic-private-upstream-detail",
      );
    },
  );
});
