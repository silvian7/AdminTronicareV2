import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../src/api";

const firstOrganization = "9223372036854775806";
const secondOrganization = "9223372036854775807";
const memberships = [
  { organizationId: firstOrganization, userTypeId: "30", active: true },
  { organizationId: secondOrganization, userTypeId: "40", active: true },
];

function organizationSession(
  organizationId = firstOrganization,
): SessionInfo & {
  activeOrganizationId: string;
  organizationMemberships: typeof memberships;
} {
  const second = organizationId === secondOrganization;
  return {
    csrf: `synthetic-csrf-${organizationId}`,
    expiresAt: Date.now() + 3_600_000,
    activeOrganizationId: organizationId,
    organizationMemberships: structuredClone(memberships),
    identity: {
      id: "100",
      name: "Synthetic multiple-organization account",
      organizationId,
      userTypeId: second ? "40" : "30",
      level: second ? 40 : 30,
      mustChangePassword: false,
      permissions: [{ entity: "assets", rights: second ? "r" : "ru" }],
    },
    services: { assets: { configured: true, writable: !second } },
  };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("organization session transitions", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function setup() {
    const api = await import("../src/api");
    let current: SessionInfo | null = organizationSession();
    const respond = async (
      path: string,
      init?: RequestInit,
    ): Promise<Response> => {
      if (path === "/api/session/organization") {
        current = organizationSession(
          (JSON.parse(String(init?.body)) as { organizationId: string })
            .organizationId,
        );
        return Response.json(current);
      }
      if (path === "/api/session/logout") {
        current = null;
        return Response.json({ success: true });
      }
      if (path === "/api/session")
        return current
          ? Response.json(current)
          : Response.json(
              { message: "Synthetic signed-out session." },
              { status: 401 },
            );
      throw new Error(`Unexpected synthetic request: ${path}`);
    };
    const fetcher = vi.fn(respond);
    vi.stubGlobal("fetch", fetcher);
    await api.loadSession();
    return {
      api,
      fetcher,
      respond,
      setCurrent: (value: SessionInfo | null) => {
        current = value;
      },
    };
  }

  it("adopts the same user's new role, services and CSRF using the exact organization string", async () => {
    const { api, fetcher } = await setup();
    const previous = api.getSession()!;
    const epoch = api.getSessionEpoch();
    const revision = api.getSessionRevision();
    const switched = await api.switchOrganization(secondOrganization);
    expect(switched.identity.id).toBe(previous.identity.id);
    expect(switched).toMatchObject({
      activeOrganizationId: secondOrganization,
      identity: {
        organizationId: secondOrganization,
        userTypeId: "40",
        level: 40,
        permissions: [{ entity: "assets", rights: "r" }],
      },
      services: { assets: { writable: false } },
      csrf: `synthetic-csrf-${secondOrganization}`,
    });
    const switches = fetcher.mock.calls.filter(
      ([path]) => path === "/api/session/organization",
    );
    expect(switches).toHaveLength(1);
    const [, options] = switches[0];
    expect(options?.method).toBe("POST");
    expect(JSON.parse(String(options?.body))).toEqual({
      organizationId: secondOrganization,
    });
    expect(new Headers(options?.headers).get("X-CSRF-Token")).toBe(
      previous.csrf,
    );
    expect(api.getSession()).toEqual(switched);
    expect(api.getSessionEpoch()).toBeGreaterThan(epoch);
    expect(api.getSessionRevision()).toBeGreaterThan(revision);

    fetcher.mockImplementationOnce(async (_path, init) => {
      expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe(
        switched.csrf,
      );
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      return Response.json({ data: [] });
    });
    await api.request("/api/resources/assets");
  });

  it("does not rotate the session or issue a request for its already active organization", async () => {
    const { api, fetcher } = await setup();
    const current = api.getSession();
    const calls = fetcher.mock.calls.length;
    const epoch = api.getSessionEpoch();
    const revision = api.getSessionRevision();
    await expect(api.switchOrganization(firstOrganization)).resolves.toEqual(
      current,
    );
    expect(fetcher).toHaveBeenCalledTimes(calls);
    expect(api.getSessionEpoch()).toBe(epoch);
    expect(api.getSessionRevision()).toBe(revision);
  });

  it.each([200, 401])(
    "fences an old %s response before the organization POST completes",
    async (status) => {
      const { api, fetcher, respond } = await setup();
      const oldRead = deferredResponse();
      const switching = deferredResponse();
      let oldSignal: AbortSignal | null | undefined;
      fetcher.mockImplementation(async (path, init) => {
        if (path === "/api/resources/assets/41") {
          oldSignal = init?.signal;
          return oldRead.promise;
        }
        if (path === "/api/session/organization") return switching.promise;
        return respond(path, init);
      });
      const read = api
        .request("/api/resources/assets/41")
        .catch((error) => error);
      const transition = api.switchOrganization(secondOrganization);
      expect(oldSignal?.aborted).toBe(true);
      oldRead.resolve(
        Response.json(
          status === 200
            ? {
                data: {
                  id: "41",
                  m_sLabel: "Synthetic old organization's private data",
                },
              }
            : { message: "Synthetic old context expired." },
          { status },
        ),
      );
      expect(await read).toMatchObject({ name: "AbortError" });
      switching.resolve(Response.json(organizationSession(secondOrganization)));
      await transition;
      expect(api.getSession()?.identity.organizationId).toBe(
        secondOrganization,
      );
    },
  );

  it.each([400, 403])(
    "keeps the prior session after a definite %s rejection and allows an explicit retry",
    async (status) => {
      const { api, fetcher } = await setup();
      const previous = api.getSession();
      fetcher.mockImplementationOnce(async () =>
        Response.json(
          { message: "Synthetic membership rejected." },
          { status },
        ),
      );
      await expect(
        api.switchOrganization(secondOrganization),
      ).rejects.toMatchObject({
        statusCode: status,
      });
      expect(api.getSession()).toEqual(previous);
      await api.switchOrganization(secondOrganization);
      expect(api.getSession()?.identity.organizationId).toBe(
        secondOrganization,
      );
      expect(
        fetcher.mock.calls.filter(
          ([path]) => path === "/api/session/organization",
        ),
      ).toHaveLength(2);
    },
  );

  it.each([401, 502, 503, "network"] as const)(
    "clears the old credentials after an ambiguous %s switch and never replays its POST",
    async (status) => {
      const { api, fetcher, setCurrent } = await setup();
      // The rotating command may have reached the server, and authoritative
      // rediscovery cannot recover a valid session in this failure scenario.
      setCurrent(null);
      fetcher.mockImplementationOnce(async () => {
        if (status === "network")
          throw new TypeError("Synthetic connection lost.");
        return Response.json(
          { message: "Synthetic switch outcome unavailable." },
          { status },
        );
      });
      await expect(
        api.switchOrganization(secondOrganization),
      ).rejects.toBeDefined();
      expect(api.getSession()).toBeNull();
      expect(
        fetcher.mock.calls.filter(
          ([path]) => path === "/api/session/organization",
        ),
      ).toHaveLength(1);
      const calls = fetcher.mock.calls.length;
      await expect(api.authProvider.check!()).resolves.toMatchObject({
        authenticated: false,
      });
      expect(fetcher).toHaveBeenCalledTimes(calls);
    },
  );

  it("recovers a committed rotation after a lost response without replaying its POST", async () => {
    const { api, fetcher, setCurrent } = await setup();
    const next = organizationSession(secondOrganization);
    fetcher.mockImplementationOnce(async () => {
      setCurrent(next);
      throw new TypeError("Synthetic switch response lost after commit.");
    });
    await expect(api.switchOrganization(secondOrganization)).resolves.toEqual(
      next,
    );
    expect(api.getSession()).toEqual(next);
    expect(
      fetcher.mock.calls.filter(
        ([path]) => path === "/api/session/organization",
      ),
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter(([path]) => path === "/api/session"),
    ).toHaveLength(2);
  });

  it("reconciles a coded context-changed 403 switch response without treating it as a membership denial", async () => {
    const { api, fetcher, setCurrent } = await setup();
    const next = organizationSession(secondOrganization);
    fetcher.mockImplementationOnce(async () => {
      setCurrent(next);
      return Response.json(
        {
          code: "organization_context_changed",
          message: "Synthetic organization context already changed.",
        },
        { status: 403 },
      );
    });
    await expect(api.switchOrganization(secondOrganization)).resolves.toEqual(
      next,
    );
    expect(api.getSession()).toEqual(next);
    expect(
      fetcher.mock.calls.filter(
        ([path]) => path === "/api/session/organization",
      ),
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter(([path]) => path === "/api/session"),
    ).toHaveLength(2);
  });

  it("retains an authoritatively recovered old context when the rotating request never arrived", async () => {
    const { api, fetcher } = await setup();
    const previous = api.getSession();
    fetcher.mockImplementationOnce(async () => {
      throw new TypeError("Synthetic switch request was not delivered.");
    });
    await expect(
      api.switchOrganization(secondOrganization),
    ).rejects.toBeDefined();
    expect(api.getSession()).toEqual(previous);
    expect(
      fetcher.mock.calls.filter(
        ([path]) => path === "/api/session/organization",
      ),
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter(([path]) => path === "/api/session"),
    ).toHaveLength(2);
  });

  it("does not send overlapping switch commands or overwrite the first successful context", async () => {
    const { api, fetcher, respond } = await setup();
    const pending = deferredResponse();
    fetcher.mockImplementation((path, init) =>
      path === "/api/session/organization"
        ? pending.promise
        : respond(path, init),
    );
    const first = api.switchOrganization(secondOrganization);
    const overlapping = api.switchOrganization("1407374883553285").then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error }),
    );
    expect(
      fetcher.mock.calls.filter(
        ([path]) => path === "/api/session/organization",
      ),
    ).toHaveLength(1);
    pending.resolve(Response.json(organizationSession(secondOrganization)));
    await first;
    expect((await overlapping).error).toBeDefined();
    expect(api.getSession()?.identity.organizationId).toBe(secondOrganization);
    expect(
      fetcher.mock.calls.filter(
        ([path]) => path === "/api/session/organization",
      ),
    ).toHaveLength(1);
  });

  it("keeps logout final when an in-flight switch later returns a successful session", async () => {
    const { api, fetcher, respond } = await setup();
    const pending = deferredResponse();
    let switchSignal: AbortSignal | null | undefined;
    fetcher.mockImplementation((path, init) => {
      if (path === "/api/session/organization") {
        switchSignal = init?.signal;
        return pending.promise;
      }
      return respond(path, init);
    });
    const switching = api
      .switchOrganization(secondOrganization)
      .catch((error) => error);
    await api.authProvider.logout!({});
    expect(switchSignal?.aborted).toBe(true);
    pending.resolve(Response.json(organizationSession(secondOrganization)));
    expect(await switching).toMatchObject({ name: "AbortError" });
    expect(api.getSession()).toBeNull();
  });

  it("replaces the session boundary when membership metadata changes without changing the active identity", async () => {
    const { api, setCurrent } = await setup();
    const current = api.getSession()!;
    const epoch = api.getSessionEpoch();
    const revision = api.getSessionRevision();
    setCurrent({
      ...current,
      organizationMemberships: [memberships[0]],
    } as SessionInfo);
    await api.loadSession();
    expect(api.getSessionEpoch()).toBeGreaterThan(epoch);
    expect(api.getSessionRevision()).toBeGreaterThan(revision);
  });

  it.each([
    { status: 409, method: "GET" },
    { status: 403, method: "POST" },
  ])(
    "reconciles a stale-context $method/$status without replaying the request",
    async ({ status, method }) => {
      const { api, fetcher, respond, setCurrent } = await setup();
      const next = organizationSession(secondOrganization);
      setCurrent(next);
      fetcher.mockImplementation(async (path, init) => {
        if (path === "/api/resources/assets")
          return Response.json(
            {
              code: "organization_context_changed",
              message: "Synthetic context changed.",
            },
            { status },
          );
        return respond(path, init);
      });
      await api
        .request("/api/resources/assets", {
          method,
          ...(method === "POST"
            ? {
                body: JSON.stringify({
                  m_sLabel: "Synthetic old-context draft",
                }),
              }
            : {}),
        })
        .catch(() => undefined);
      await vi.waitFor(() => expect(api.getSession()?.csrf).toBe(next.csrf));
      expect(
        fetcher.mock.calls.filter(([path]) => path === "/api/resources/assets"),
      ).toHaveLength(1);
      expect(
        fetcher.mock.calls.filter(
          ([path]) => path === "/api/session/organization",
        ),
      ).toHaveLength(0);
    },
  );

  it("waits for a pending server-side rotation using only bounded session GET retries", async () => {
    const { api, fetcher, respond, setCurrent } = await setup();
    const next = organizationSession(secondOrganization);
    let pendingReads = 0;
    setCurrent(next);
    fetcher.mockImplementation((path, init) => {
      if (path === "/api/session" && pendingReads++ < 2)
        return Promise.resolve(
          Response.json(
            {
              code: "organization_switch_pending",
              message: "Synthetic rotation pending.",
            },
            { status: 409 },
          ),
        );
      return respond(path, init);
    });
    vi.useFakeTimers();
    const refreshed = api.refreshOrganizationSession();
    expect(api.getSession()).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(refreshed).resolves.toEqual(next);
    expect(pendingReads).toBe(3);
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);
  });

  it("fails closed when the pending organization context never settles", async () => {
    const { api, fetcher } = await setup();
    fetcher.mockImplementation(async () =>
      Response.json(
        {
          code: "organization_switch_pending",
          message: "Synthetic rotation remains pending.",
        },
        { status: 409 },
      ),
    );
    vi.useFakeTimers();
    const result = api.refreshOrganizationSession().catch((error) => error);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({
      statusCode: 409,
      code: "organization_switch_pending",
    });
    expect(api.getSession()).toBeNull();
    const reads = fetcher.mock.calls.filter(
      ([path]) => path === "/api/session",
    ).length;
    expect(reads).toBeGreaterThan(1);
    expect(reads).toBeLessThanOrEqual(125);
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);
  });
});
