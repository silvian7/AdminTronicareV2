import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../src/api";

const account = (id: string): SessionInfo => ({
  csrf: `synthetic-csrf-${id}`,
  expiresAt: Date.now() + 60000,
  identity: {
    id,
    name: `Synthetic ${id}`,
    organizationId: "7",
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [{ entity: "assets", rights: "ru" }],
  },
});

function delayedResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("account request isolation", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function setup() {
    const api = await import("../src/api");
    let current = account("A");
    const fetcher = vi.fn(async (path: string, options?: RequestInit) => {
      if (path === "/api/session/login") {
        current = account(JSON.parse(String(options?.body)).login);
        return Response.json(current);
      }
      if (path === "/api/session/logout")
        return Response.json({ success: true });
      return Response.json(current);
    });
    vi.stubGlobal("fetch", fetcher);
    await api.authProvider.login!({
      login: "A",
      password: "synthetic",
      mode: "password",
    });
    return { api, fetcher };
  }

  it("keeps failed sign-in forms mounted while invalidating pending requests", async () => {
    const api = await import("../src/api");
    const pending = delayedResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => pending.promise),
    );
    const epoch = api.getSessionEpoch();
    const revision = api.getSessionRevision();
    const login = api.authProvider.login!({
      login: "A",
      password: "synthetic-invalid",
      mode: "password",
    });
    expect(api.getSessionEpoch()).toBe(epoch + 1);
    expect(api.getSessionRevision()).toBe(revision);
    pending.resolve(
      Response.json({ message: "Invalid credential." }, { status: 401 }),
    );
    await expect(login).resolves.toMatchObject({
      success: false,
      error: { message: "Invalid credential." },
    });
    expect(api.getSessionEpoch()).toBe(epoch + 2);
    expect(api.getSessionRevision()).toBe(revision);
    expect(api.getSession()).toBeNull();
  });

  it.each([200, 401])(
    "rejects an overlapping login's stale %s response after another account signs in",
    async (status) => {
      const api = await import("../src/api");
      const pending = delayedResponse();
      let olderSignal: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (path: string, options?: RequestInit) => {
          if (
            path === "/api/session/login" &&
            JSON.parse(String(options?.body)).login === "A"
          ) {
            olderSignal = options?.signal ?? undefined;
            return pending.promise;
          }
          return Response.json(account("B"));
        }),
      );
      const older = api.authProvider.login!({
        login: "A",
        password: "synthetic",
        mode: "password",
      });
      await expect(
        api.authProvider.login!({
          login: "B",
          password: "synthetic",
          mode: "password",
        }),
      ).resolves.toMatchObject({ success: true });
      expect(olderSignal?.aborted).toBe(true);
      const revision = api.getSessionRevision();
      pending.resolve(
        Response.json(
          status === 200 ? account("A") : { message: "A expired." },
          { status },
        ),
      );
      await expect(older).resolves.toMatchObject({ success: false });
      expect(api.getSession()?.identity.id).toBe("B");
      expect(api.getSessionRevision()).toBe(revision);
    },
  );

  it("aborts and rejects old successful responses after sign-out", async () => {
    const { api, fetcher } = await setup();
    const pending = delayedResponse();
    let signal: AbortSignal | undefined;
    fetcher.mockImplementationOnce(async (_path, options) => {
      signal = options?.signal ?? undefined;
      return pending.promise;
    });
    const result = api
      .request("/api/resources/assets/1")
      .catch((error) => error);
    await api.authProvider.logout!({});
    expect(signal?.aborted).toBe(true);
    pending.resolve(Response.json({ data: { m_sLabel: "A's private asset" } }));
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(api.getSession()).toBeNull();
  });

  it("does not let an old 401 expire the next account", async () => {
    const { api, fetcher } = await setup();
    const pending = delayedResponse();
    fetcher.mockImplementationOnce(async () => pending.promise);
    const result = api
      .request("/api/resources/assets/1")
      .catch((error) => error);
    await api.authProvider.logout!({});
    await api.authProvider.login!({
      login: "B",
      password: "synthetic",
      mode: "password",
    });
    pending.resolve(Response.json({ message: "A expired" }, { status: 401 }));
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(api.getSession()?.identity.id).toBe("B");
  });

  it("does not restore an old session from an in-flight session check", async () => {
    const { api, fetcher } = await setup();
    const pending = delayedResponse();
    fetcher.mockImplementationOnce(async () => pending.promise);
    const result = api.loadSession().catch((error) => error);
    await api.authProvider.logout!({});
    pending.resolve(Response.json(account("A")));
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(api.getSession()).toBeNull();
  });

  it("blocks cookie-based restoration during sign-out", async () => {
    const { api, fetcher } = await setup();
    const pending = delayedResponse();
    fetcher.mockImplementationOnce(async () => pending.promise);
    const logout = api.authProvider.logout!({});
    const calls = fetcher.mock.calls.length;
    await expect(api.authProvider.check!()).resolves.toMatchObject({
      authenticated: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(calls);
    pending.resolve(Response.json({ success: true }));
    await logout;
  });

  it("keeps repeated checks stable but replaces the boundary for authorization changes", async () => {
    const { api, fetcher } = await setup();
    const changed = vi.fn();
    const unsubscribe = api.subscribeSessionChange(changed);
    const epoch = api.getSessionEpoch();
    const revision = api.getSessionRevision();
    await api.loadSession();
    await api.loadSession();
    expect(api.getSessionEpoch()).toBe(epoch);
    expect(api.getSessionRevision()).toBe(revision);
    expect(changed).not.toHaveBeenCalled();
    fetcher.mockImplementationOnce(async () =>
      Response.json({
        ...account("A"),
        identity: { ...account("A").identity, permissions: [] },
      }),
    );
    await api.loadSession();
    expect(api.getSessionEpoch()).toBe(epoch + 1);
    expect(api.getSessionRevision()).toBe(revision + 1);
    expect(changed).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("clears identity on expiry and ignores delayed auth error handlers after a new login", async () => {
    const { api, fetcher } = await setup();
    fetcher.mockImplementationOnce(async () =>
      Response.json({ message: "Expired" }, { status: 401 }),
    );
    const expired = await api
      .request("/api/resources/assets/1")
      .catch((error) => error);
    expect(api.getSession()).toBeNull();
    await api.authProvider.login!({
      login: "B",
      password: "synthetic",
      mode: "password",
    });
    const handled = await api.authProvider.onError!(expired);
    expect(handled.logout).not.toBe(true);
    expect(api.getSession()?.identity.id).toBe("B");
  });

  it("discovers the shared cookie without evicting other tabs", async () => {
    const storage = { setItem: vi.fn() };
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), { localStorage: storage }),
    );
    const api = await import("../src/api");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(account("A"))),
    );
    await api.loadSession();
    expect(api.getSession()?.identity.id).toBe("A");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("sends opaque cross-tab revisions and revokes incoming changes without broadcast loops", async () => {
    const storage = { setItem: vi.fn() };
    const browserWindow = Object.assign(new EventTarget(), {
      localStorage: storage,
    });
    vi.stubGlobal("window", browserWindow);
    const { api } = await setup();
    for (const [key, value] of storage.setItem.mock.calls) {
      expect(key).toBe("tronicare-admin-session-revision");
      expect(value).toMatch(/^[0-9a-f-]{36}$/);
    }
    const broadcasts = storage.setItem.mock.calls.length;
    const epoch = api.getSessionEpoch();
    browserWindow.dispatchEvent(
      Object.assign(new Event("storage"), {
        key: "tronicare-admin-session-revision",
        newValue: "synthetic-opaque-revision",
      }),
    );
    expect(api.getSession()).toBeNull();
    expect(api.getSessionEpoch()).toBe(epoch + 1);
    expect(storage.setItem).toHaveBeenCalledTimes(broadcasts);
    await expect(api.authProvider.check!()).resolves.toMatchObject({
      authenticated: false,
    });
  });

  it("fences in-flight private responses when a persisted document is restored", async () => {
    const storage = { setItem: vi.fn() };
    const browserWindow = Object.assign(new EventTarget(), {
      localStorage: storage,
    });
    vi.stubGlobal("window", browserWindow);
    const { api, fetcher } = await setup();
    const pending = delayedResponse();
    fetcher.mockImplementationOnce(async () => pending.promise);
    const result = api
      .request("/api/resources/assets/1")
      .catch((error) => error);
    const broadcasts = storage.setItem.mock.calls.length;
    browserWindow.dispatchEvent(
      Object.assign(new Event("pageshow"), { persisted: true }),
    );
    pending.resolve(Response.json({ data: { m_sLabel: "A's private asset" } }));
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(api.getSession()).toBeNull();
    expect(storage.setItem).toHaveBeenCalledTimes(broadcasts);
  });
});
