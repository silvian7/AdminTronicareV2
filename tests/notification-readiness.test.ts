import { afterEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { createApp } from "../server/app";
import { notificationReadiness } from "../server/notification-readiness";
import { MemorySessions } from "../server/sessions";
import { createUpstream, type Transport } from "../server/upstream";
import {
  decodeNotificationReadinessBatch,
  normalizeNotificationReadiness,
} from "../shared/notification-readiness";
import { fixtureTransport, testConfig, testIdentity } from "./fixtures";

const id = "9223372036854775807";
const wire = (userId = id, count = 1) => ({
  Status: true,
  Error: "",
  user_id: userId,
  registered_device_count: count,
  notification_readiness:
    count === 0
      ? "no_registered_device"
      : count > 32
        ? "device_limit_exceeded"
        : "registered",
  last_registration_at: count ? "2026-10-20T09:00:00+00:00" : null,
  private_token: "synthetic-private-token-never-returned",
});

async function setup(permission = true, mustChangePassword = false) {
  const fixture = fixtureTransport({
    ...testIdentity,
    level: 30,
    mustChangePassword,
    permissions: permission ? [{ entity: "users", rights: "r" }] : [],
  });
  const calls: { url: URL; method: string; headers: Headers }[] = [];
  let reply = (_userId: string): Response => Response.json(wire(_userId));
  const transport: Transport = async (input, init) => {
    const url = new URL(String(input));
    if (!url.pathname.startsWith("/v1/pushadmin/devices/readiness/"))
      return fixture.transport(input, init);
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
    });
    return reply(url.pathname.split("/").at(-1)!);
  };
  const api = supertest.agent(
    createApp(testConfig, new MemorySessions(), transport),
  );
  const login = await api
    .post("/api/session/login")
    .set("Origin", testConfig.publicOrigin)
    .send({ login: "synthetic-reader", password: "synthetic-password" });
  expect(login.status).toBe(200);
  return {
    api,
    calls,
    reply: (next: typeof reply) => {
      reply = next;
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("scoped notification registration readiness", () => {
  it("requires a local session", async () => {
    const fixture = fixtureTransport();
    const api = supertest(
      createApp(testConfig, new MemorySessions(), fixture.transport),
    );
    expect(
      (await api.get(`/api/users/notification-readiness?ids=${id}`)).status,
    ).toBe(401);
    expect(fixture.calls).toHaveLength(0);
  });

  it.each([
    [false, false],
    [true, true],
  ])(
    "rejects unauthorized or password-reset callers before Push reads",
    async (permission, reset) => {
      const { api, calls } = await setup(permission, reset);
      expect(
        (await api.get(`/api/users/notification-readiness?ids=${id}`)).status,
      ).toBe(403);
      expect(calls).toHaveLength(0);
    },
  );

  it("uses the configured Push owner and caller token, retains exact IDs, and projects no device secrets", async () => {
    const { api, calls } = await setup();
    const response = await api.get(
      `/api/users/notification-readiness?ids=${id},41,${id}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(
      response.body.data.map((row: { userId: string }) => row.userId),
    ).toEqual([id, "41"]);
    expect(response.body.data[0]).toEqual({
      userId: id,
      state: "available",
      registeredDeviceCount: 1,
      notificationReadiness: "registered",
      lastRegistrationAt: "2026-10-20T09:00:00+00:00",
    });
    expect(JSON.stringify(response.body)).not.toContain(
      "synthetic-private-token",
    );
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.url.origin).toBe(testConfig.origins.push);
      expect(call.url.search).toBe("");
      expect(call.method).toBe("GET");
      expect(call.headers.get("Token")).toBe("synthetic-session-token");
    }
  });

  it.each([
    "",
    "0",
    "-1",
    "01",
    "1.0",
    "1e2",
    "9223372036854775808",
    "1,,2",
    Array.from({ length: 51 }, (_, n) => n + 1).join(","),
  ])("rejects invalid or unbounded input %s", async (ids) => {
    const { api, calls } = await setup();
    expect(
      (
        await api.get(
          `/api/users/notification-readiness?${new URLSearchParams({ ids })}`,
        )
      ).status,
    ).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it.each(["ids=1&ids=2", "ids=1&idorganization=8"])(
    "rejects duplicate query keys or supplied tenant selectors",
    async (query) => {
      const { api, calls } = await setup();
      expect(
        (await api.get(`/api/users/notification-readiness?${query}`)).status,
      ).toBe(400);
      expect(calls).toHaveLength(0);
    },
  );

  it.each([401, 403, 404, 503])(
    "keeps dependency HTTP %s unavailable and leaves the valid BFF session intact",
    async (status) => {
      const fixture = await setup();
      fixture.reply(() =>
        Response.json({ secret: "synthetic-upstream-secret" }, { status }),
      );
      const response = await fixture.api.get(
        `/api/users/notification-readiness?ids=${id}`,
      );
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        data: [{ userId: id, state: "unavailable" }],
      });
      expect((await fixture.api.get("/api/session")).status).toBe(200);
      expect(fixture.calls).toHaveLength(1);
    },
  );

  it("isolates per-user failures and distinguishes missing and excessive registrations", async () => {
    const fixture = await setup();
    fixture.reply((userId) =>
      userId === "3"
        ? Response.json({}, { status: 403 })
        : Response.json(wire(userId, userId === "1" ? 0 : 33)),
    );
    const response = await fixture.api.get(
      "/api/users/notification-readiness?ids=1,2,3",
    );
    expect(response.body.data).toEqual([
      {
        userId: "1",
        state: "available",
        registeredDeviceCount: 0,
        notificationReadiness: "no_registered_device",
        lastRegistrationAt: null,
      },
      {
        userId: "2",
        state: "available",
        registeredDeviceCount: 33,
        notificationReadiness: "device_limit_exceeded",
        lastRegistrationAt: "2026-10-20T09:00:00+00:00",
      },
      { userId: "3", state: "unavailable" },
    ]);
  });

  it.each([
    { user_id: "41" },
    { Status: false },
    { registered_device_count: -1 },
    { registered_device_count: "1.2" },
    { notification_readiness: "no_registered_device" },
    { registered_device_count: 33, notification_readiness: "registered" },
    { last_registration_at: "invalid-date" },
  ])(
    "treats malformed/mismatched upstream values as unknown, never zero",
    async (delta) => {
      const fixture = await setup();
      fixture.reply(() => Response.json({ ...wire(), ...delta }));
      expect(
        (await fixture.api.get(`/api/users/notification-readiness?ids=${id}`))
          .body,
      ).toEqual({ data: [{ userId: id, state: "unavailable" }] });
    },
  );

  it("bounds concurrency at four and overall latency at ten seconds without late row publication", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const release: (() => void)[] = [];
    const upstream = vi.fn(async (_service, path: string, _token, options) => {
      signals.push(options.signal);
      await new Promise<void>((resolve) => release.push(resolve));
      return {
        data: wire(path.split("/").at(-1)),
        status: 200,
        headers: new Headers(),
      };
    }) as unknown as ReturnType<typeof createUpstream>;
    const result = notificationReadiness(
      Array.from({ length: 50 }, (_, n) => String(n + 1)),
      "synthetic",
      upstream,
    );
    expect(signals).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(10_000);
    const rows = await result;
    expect(rows).toHaveLength(50);
    expect(rows.every((row) => row.state === "unavailable")).toBe(true);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    release.forEach((done) => done());
    await Promise.resolve();
    expect(signals).toHaveLength(4);
    expect(rows.every((row) => row.state === "unavailable")).toBe(true);
  });

  it("browser decoding rejects missing/duplicate/foreign rows and strips unknown fields", () => {
    const good = normalizeNotificationReadiness(wire(), id);
    expect(decodeNotificationReadinessBatch({ data: [good] }, [id])).toEqual([
      good,
    ]);
    for (const rows of [[], [good, good], [{ ...good, userId: "42" }]])
      expect(() =>
        decodeNotificationReadinessBatch({ data: rows }, [id]),
      ).toThrow();
    expect(
      decodeNotificationReadinessBatch(
        {
          data: [
            {
              userId: id,
              state: "unavailable",
              registeredDeviceCount: 0,
              token: "hidden",
            },
          ],
        },
        [id],
      ),
    ).toEqual([{ userId: id, state: "unavailable" }]);
  });
});
