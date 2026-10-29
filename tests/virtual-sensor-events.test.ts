import { describe, expect, it } from "vitest";
import supertest from "supertest";
import { createApp } from "../server/app";
import { MemorySessions } from "../server/sessions";
import { fixtureTransport, testConfig, testIdentity } from "./fixtures";
import type { Identity } from "../shared/resources";
import type { Config } from "../server/config";

const sensorId = "9223372036854775807";
const operationId = "85ce46f2-9313-4bd5-9518-416054f08ae6";
const endpoint = `/api/sensors/${sensorId}/virtual-events`;
const event = {
  sensorId,
  operationId,
  value: true,
  status: "accepted",
  eventAt: "2026-10-26T13:00:00.123Z",
  acceptedAt: "2026-10-26T13:00:00.456+00:00",
};

async function setup(
  options: {
    identity?: Identity;
    config?: Config;
    reply?: unknown;
    errorStatus?: number;
    unreachable?: boolean;
  } = {},
) {
  const fixture = fixtureTransport(options.identity ?? testIdentity);
  const calls: {
    path: string;
    method: string;
    token: string | null;
    body?: string;
  }[] = [];
  const app = createApp(
    options.config ?? testConfig,
    new MemorySessions(),
    async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/virtual-events")) {
        calls.push({
          path: url.pathname,
          method: init?.method ?? "GET",
          token: new Headers(init?.headers).get("Token"),
          body: init?.body as string | undefined,
        });
        if (options.unreachable) throw new Error("synthetic transport failure");
        if (options.errorStatus)
          return Response.json(
            { internal: "must not be exposed" },
            { status: options.errorStatus },
          );
        return Response.json(
          "reply" in options
            ? options.reply
            : url.pathname.endsWith("/virtual-events") &&
                init?.method !== "POST"
              ? { sensorId, supported: true, value: false }
              : event,
        );
      }
      return fixture.transport(input, init);
    },
  );
  const api = supertest.agent(app);
  const login = await api
    .post("/api/session/login")
    .set("Origin", testConfig.publicOrigin)
    .send({ login: "synthetic", password: "fixture-password" });
  expect(login.status).toBe(200);
  const post = (
    body: unknown = { operationId, value: true },
    path = endpoint,
  ) =>
    api
      .post(path)
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", login.body.csrf)
      .send(body as object);
  return { api, calls, post, csrf: login.body.csrf };
}

describe("virtual bedoff event gateway", () => {
  it("passes only the narrow capability, event, and status contract using the caller token", async () => {
    const { api, calls, post } = await setup();
    expect((await api.get(endpoint)).body).toEqual({
      data: { sensorId, supported: true, value: false },
    });
    expect((await post()).body).toEqual({ data: event });
    expect((await api.get(`${endpoint}/${operationId}`)).body).toEqual({
      data: event,
    });
    expect(calls.map(({ path, method }) => ({ path, method }))).toEqual([
      { path: `/v1/sensors/${sensorId}/virtual-events`, method: "GET" },
      { path: `/v1/sensors/${sensorId}/virtual-events`, method: "POST" },
      {
        path: `/v1/sensors/${sensorId}/virtual-events/${operationId}`,
        method: "GET",
      },
    ]);
    expect(
      calls.every((call) => call.token === "synthetic-session-token"),
    ).toBe(true);
    expect(JSON.parse(calls[1].body!)).toEqual({ operationId, value: true });
  });

  it("keeps false values and queued outcomes intact without exposing extra backend fields", async () => {
    const queued = {
      ...event,
      value: false,
      status: "queued",
      acceptedAt: undefined,
    };
    const { post } = await setup({
      reply: { ...queued, callerRef: "internal", exactBody: "internal" },
    });
    const response = await post({ operationId, value: false });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: queued });
  });

  it("reports a durably rejected event without claiming its reading changed", async () => {
    const rejected = { ...event, status: "rejected", acceptedAt: undefined };
    const { post } = await setup({ reply: rejected });
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: rejected });
  });

  for (const identity of [
    { ...testIdentity, level: 30 },
    { ...testIdentity, mustChangePassword: true },
  ])
    it("denies unauthorized callers before accessing Core", async () => {
      const { api, calls, post } = await setup({ identity });
      expect((await api.get(endpoint)).status).toBe(403);
      expect((await post()).status).toBe(403);
      expect((await api.get(`${endpoint}/${operationId}`)).status).toBe(403);
      expect(calls).toEqual([]);
    });

  it("keeps operation status readable while Core writes are paused", async () => {
    const { api, calls, post } = await setup({
      config: {
        ...testConfig,
        enabledWrites: new Set(
          [...testConfig.enabledWrites].filter((s) => s !== "core"),
        ),
      },
    });
    expect((await api.get(endpoint)).status).toBe(200);
    expect((await api.get(`${endpoint}/${operationId}`)).status).toBe(200);
    calls.length = 0;
    expect((await post()).status).toBe(503);
    expect(calls).toEqual([]);
  });

  it("respects paused Core writes and CSRF protection", async () => {
    const paused = await setup({
      config: {
        ...testConfig,
        enabledWrites: new Set(
          [...testConfig.enabledWrites].filter((s) => s !== "core"),
        ),
      },
    });
    expect((await paused.post()).status).toBe(503);
    expect(paused.calls).toEqual([]);
    const { api, calls } = await setup();
    expect(
      (
        await api
          .post(endpoint)
          .set("Origin", testConfig.publicOrigin)
          .send({ operationId, value: true })
      ).status,
    ).toBe(403);
    expect(calls).toEqual([]);
  });

  for (const body of [
    {},
    null,
    [],
    { operationId, value: "true" },
    { operationId, value: 1 },
    { operationId, value: null },
    { value: true },
    { operationId: "bad", value: true },
    { operationId: operationId.toUpperCase(), value: true },
    { operationId, value: true, sensorId: "1" },
    { operationId, value: true, payload: [{ vb: true }] },
    { operationId, value: true, timestamp: "2026-01-01" },
  ])
    it(`rejects untrusted simulation request shapes: ${JSON.stringify(body)}`, async () => {
      const { calls, post } = await setup();
      expect((await post(body)).status).toBe(400);
      expect(calls).toEqual([]);
    });

  it("rejects query and path injection without upstream calls", async () => {
    const { api, calls, post } = await setup();
    expect(
      (await api.get(`${endpoint}?host=https://untrusted.invalid`)).status,
    ).toBe(400);
    expect(
      (await post({ operationId, value: true }, `${endpoint}?assetId=1`))
        .status,
    ).toBe(400);
    expect((await api.get(`${endpoint}/bad`)).status).toBe(400);
    expect((await api.get("/api/sensors/0/virtual-events")).status).toBe(400);
    expect(calls).toEqual([]);
  });

  for (const errorStatus of [403, 404, 409, 503])
    it(`preserves backend refusal ${errorStatus} without leaking its body`, async () => {
      const { calls, post } = await setup({ errorStatus });
      const response = await post();
      expect(response.status).toBe(errorStatus);
      if (errorStatus === 503)
        expect(response.body).toMatchObject({
          message: "This service is temporarily unavailable. Please try again.",
          code: "upstream_503",
        });
      expect(JSON.stringify(response.body)).not.toContain(
        "must not be exposed",
      );
      expect(calls).toHaveLength(1);
    });

  it("does not replay POST after an uncertain transport outcome", async () => {
    const { calls, post } = await setup({ unreachable: true });
    expect((await post()).status).toBe(502);
    expect(calls).toHaveLength(1);
  });

  for (const reply of [
    { ...event, sensorId: "1" },
    { ...event, operationId: "00000000-0000-0000-0000-000000000000" },
    { ...event, value: false },
    { ...event, value: "true" },
    { ...event, status: "processed" },
    { ...event, status: ["accepted"] },
    { ...event, eventAt: null },
    { ...event, eventAt: "invalid" },
    { ...event, eventAt: "2026-10-26T13:00:00" },
    { ...event, acceptedAt: "invalid" },
  ])
    it("fails closed on malformed or mismatched event results", async () => {
      const { post } = await setup({ reply });
      expect((await post()).status).toBe(502);
    });

  for (const reply of [
    null,
    [],
    { sensorId, supported: "true" },
    { sensorId: "1", supported: true },
    { sensorId, supported: true, value: "false" },
  ])
    it("fails closed on malformed capability metadata", async () => {
      const { api } = await setup({ reply });
      expect((await api.get(endpoint)).status).toBe(502);
    });
});
