import { describe, expect, it } from "vitest";
import supertest from "supertest";
import { createApp } from "../server/app";
import type { Config } from "../server/config";
import { MemorySessions } from "../server/sessions";
import type { Transport } from "../server/upstream";
import { fixtureTransport, testConfig, testIdentity } from "./fixtures";

const destinations = {
  rules: ["rules_forward"],
  actions: ["actions_forward"],
  push: ["delivery", "results"],
  email: ["delivery", "results"],
  sms: ["delivery", "results"],
  mqtt: ["delivery", "results", "sensor_information"],
  mqttbridge: ["mqtt", "core_primary", "core_mirror"],
} as const;
type OutboxService = keyof typeof destinations;
const serviceOrder = Object.keys(destinations) as OutboxService[];

function serviceInfo(service: OutboxService) {
  return {
    Status: true,
    privateDetail: "synthetic-private-upstream-detail",
    Outboxes: Object.fromEntries(
      destinations[service].map((destination, index) => [
        destination,
        { Size: index + 3, Latency_Seconds: index + 7 },
      ]),
    ),
  };
}

function makeApi(level = 90, config: Config = testConfig) {
  const fixture = fixtureTransport({ ...testIdentity, level });
  const replies = new Map<OutboxService, () => Response>(
    serviceOrder.map((service) => [
      service,
      () => Response.json(serviceInfo(service)),
    ]),
  );
  const calls: { url: URL; headers: Headers; method: string }[] = [];
  const transport: Transport = async (input, init) => {
    const url = new URL(String(input));
    const service = serviceOrder.find(
      (candidate) => url.pathname === `/v1/${candidate}admin/info`,
    );
    if (!service) return fixture.transport(input, init);
    calls.push({
      url,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
    });
    return replies.get(service)!();
  };
  const api = supertest.agent(
    createApp(config, new MemorySessions(), transport),
  );
  return { api, replies, calls };
}

async function setup(level = 90, config: Config = testConfig) {
  const setup = makeApi(level, config);
  const login = await setup.api
    .post("/api/session/login")
    .set("Origin", testConfig.publicOrigin)
    .send({ login: "fixture-admin", password: "fixture-password" });
  expect(login.status).toBe(200);
  return setup;
}

function expectedAvailable(service: OutboxService) {
  return {
    service,
    state: "available",
    outboxes: destinations[service].map((destination, index) => ({
      destination,
      size: String(index + 3),
      latencySeconds: String(index + 7),
    })),
  };
}

describe("service outbox aggregate", () => {
  it("requires a local session without contacting any outbox service", async () => {
    const { api, calls } = makeApi();
    expect((await api.get("/api/outboxes")).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it.each([30, 89])(
    "denies local role level %s without contacting services",
    async (level) => {
      const { api, calls } = await setup(level);
      expect((await api.get("/api/outboxes")).status).toBe(403);
      expect(calls).toHaveLength(0);
    },
  );

  it.each([90, 95])(
    "fetches all seven configured services for platform level %s",
    async (level) => {
      const { api, calls } = await setup(level);
      const response = await api.get("/api/outboxes");
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toEqual({
        data: serviceOrder.map(expectedAvailable),
      });
      expect(calls).toHaveLength(7);
      for (const service of serviceOrder) {
        const call = calls.find(
          (call) => call.url.pathname === `/v1/${service}admin/info`,
        )!;
        expect(call.url.origin).toBe(testConfig.origins[service]);
        expect(call.headers.get("Token")).toBe("synthetic-session-token");
        expect(call.method).toBe("GET");
      }
      expect(JSON.stringify(response.body)).not.toContain(
        "synthetic-private-upstream-detail",
      );
    },
  );

  it("preserves exact large integer queue sizes and latency values", async () => {
    const { api, replies } = await setup();
    replies.set(
      "mqttbridge",
      () =>
        new Response(
          JSON.stringify(serviceInfo("mqttbridge"))
            .replace('"Size":3', '"Size":9223372036854775807')
            .replace(
              '"Latency_Seconds":7',
              '"Latency_Seconds":9007199254740993',
            ),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    const response = await api.get("/api/outboxes");
    expect(response.status).toBe(200);
    expect(response.body.data[6].outboxes[0]).toEqual({
      destination: "mqtt",
      size: "9223372036854775807",
      latencySeconds: "9007199254740993",
    });
  });

  it("reports empty queues as zero for every service", async () => {
    const { api, replies } = await setup();
    for (const service of serviceOrder)
      replies.set(service, () => {
        const info = serviceInfo(service);
        for (const queue of Object.values(info.Outboxes)) {
          queue.Size = 0;
          queue.Latency_Seconds = 0;
        }
        return Response.json(info);
      });
    const response = await api.get("/api/outboxes");
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(7);
    for (const row of response.body.data) {
      expect(row.state).toBe("available");
      expect(row.outboxes.length).toBeGreaterThan(0);
      for (const queue of row.outboxes) {
        expect(queue.size).toBe("0");
        expect(queue.latencySeconds).toBe("0");
      }
    }
  });

  it("marks an unconfigured service without contacting it or losing other metrics", async () => {
    const config = { ...testConfig, origins: { ...testConfig.origins } };
    delete config.origins.sms;
    const { api, calls } = await setup(90, config);
    const response = await api.get("/api/outboxes");
    expect(response.status).toBe(200);
    expect(
      response.body.data.map((row: { service: string }) => row.service),
    ).toEqual(serviceOrder);
    expect(response.body.data[4]).toEqual({
      service: "sms",
      state: "unconfigured",
      outboxes: [],
      message: expect.any(String),
    });
    expect(calls).toHaveLength(6);
    expect(
      calls.some((call) => call.url.pathname === "/v1/smsadmin/info"),
    ).toBe(false);
    expect(response.body.data[0]).toEqual(expectedAvailable("rules"));
  });

  it.each([401, 403, 503])(
    "isolates upstream HTTP %s failures from other services and the local session",
    async (status) => {
      const { api, replies } = await setup();
      replies.set(
        "email",
        () => new Response("synthetic-private-upstream-detail", { status }),
      );
      const response = await api.get("/api/outboxes");
      expect(response.status).toBe(200);
      expect(response.body.data[3]).toEqual({
        service: "email",
        state: "unavailable",
        outboxes: [],
        message: expect.any(String),
      });
      for (const [index, service] of serviceOrder.entries()) {
        if (service !== "email")
          expect(response.body.data[index]).toEqual(expectedAvailable(service));
      }
      expect(JSON.stringify(response.body)).not.toContain(
        "synthetic-private-upstream-detail",
      );
      expect((await api.get("/api/session")).status).toBe(200);
    },
  );

  it("isolates unreachable services without exposing transport errors", async () => {
    const { api, replies } = await setup();
    replies.set("push", () => {
      throw new Error("synthetic-secret-transport-error");
    });
    const response = await api.get("/api/outboxes");
    expect(response.status).toBe(200);
    expect(response.body.data[2]).toEqual({
      service: "push",
      state: "unavailable",
      outboxes: [],
      message: expect.any(String),
    });
    expect(response.body.data[6]).toEqual(expectedAvailable("mqttbridge"));
    expect(JSON.stringify(response.body)).not.toContain(
      "synthetic-secret-transport-error",
    );
  });

  it.each(serviceOrder)(
    "rejects missing required %s queues without exposing partial service metrics",
    async (service) => {
      const { api, replies } = await setup();
      replies.set(service, () => {
        const info = serviceInfo(service);
        delete info.Outboxes[destinations[service].at(-1)!];
        return Response.json(info);
      });
      const response = await api.get("/api/outboxes");
      expect(response.status).toBe(200);
      expect(response.body.data[serviceOrder.indexOf(service)]).toEqual({
        service,
        state: "unavailable",
        outboxes: [],
        message: expect.any(String),
      });
      expect(
        response.body.data.filter(
          (row: { state: string }) => row.state === "available",
        ),
      ).toHaveLength(6);
    },
  );

  it.each([
    ["negative size", { Size: -1, Latency_Seconds: 0 }],
    ["fractional size", { Size: 1.5, Latency_Seconds: 0 }],
    ["missing size", { Latency_Seconds: 0 }],
    ["negative latency", { Size: 1, Latency_Seconds: -1 }],
    ["fractional latency", { Size: 1, Latency_Seconds: 0.5 }],
    ["invalid latency", { Size: 1, Latency_Seconds: "unknown" }],
    ["missing latency", { Size: 1 }],
  ])("rejects %s without dropping healthy services", async (_name, queue) => {
    const { api, replies } = await setup();
    replies.set("sms", () =>
      Response.json({
        Outboxes: { delivery: queue, results: { Size: 0, Latency_Seconds: 0 } },
      }),
    );
    const response = await api.get("/api/outboxes");
    expect(response.status).toBe(200);
    expect(response.body.data[4]).toEqual({
      service: "sms",
      state: "unavailable",
      outboxes: [],
      message: expect.any(String),
    });
    expect(response.body.data[5]).toEqual(expectedAvailable("mqtt"));
  });
});
