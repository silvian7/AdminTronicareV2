import type { AuthProvider, DataProvider, HttpError } from "@refinedev/core";
import type { Identity, Service } from "../shared/resources";

export interface SessionInfo {
  identity: Identity;
  csrf: string;
  expiresAt: number;
  services?: Partial<
    Record<Service, { configured: boolean; writable: boolean }>
  >;
}
let session: SessionInfo | null = null;
let sessionEpoch = 0;
let sessionRevision = 0;
let signedOut = false;
const pendingRequests = new Set<AbortController>();
const sessionListeners = new Set<() => void>();
const sessionRevisionKey = "tronicare-admin-session-revision";
export const getSession = () => session;
export const getSessionEpoch = () => sessionEpoch;
export const getSessionRevision = () => sessionRevision;
export function subscribeSessionChange(listener: () => void) {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}
const sessionFingerprint = (value: SessionInfo | null) =>
  value &&
  JSON.stringify({
    identity: value.identity,
    csrf: value.csrf,
    services: value.services,
  });
function changeSession(
  next: SessionInfo | null,
  force = false,
  broadcast = true,
) {
  const sessionChanged =
    sessionFingerprint(session) !== sessionFingerprint(next);
  const changed = force || sessionChanged;
  session = next;
  signedOut = !next;
  if (!changed) return;
  sessionEpoch += 1;
  // Retry and overlapping sign-in fences must not discard the login form.
  // Remount protected views only when the visible account boundary changes.
  if (sessionChanged) sessionRevision += 1;
  for (const controller of pendingRequests) controller.abort();
  pendingRequests.clear();
  for (const listener of sessionListeners) listener();
  if (broadcast && typeof window !== "undefined") {
    try {
      // Other tabs only need a revocation signal. Never persist account data.
      window.localStorage.setItem(sessionRevisionKey, crypto.randomUUID());
    } catch {
      // Some browser policies disable storage; local revocation still applies.
    }
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === sessionRevisionKey && event.newValue !== null)
      changeSession(null, true, false);
  });
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) changeSession(null, true, false);
  });
  window.addEventListener("pageshow", (event) => {
    // A frozen document can miss another tab's account changes entirely.
    if (event.persisted) changeSession(null, true, false);
  });
}
function assertSessionEpoch(epoch: number) {
  if (epoch !== sessionEpoch)
    throw new DOMException("The account session changed.", "AbortError");
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const epoch = sessionEpoch;
  const controller = new AbortController();
  pendingRequests.add(controller);
  try {
    const response = await fetch(path, {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(session?.csrf ? { "X-CSRF-Token": session.csrf } : {}),
        ...options.headers,
      },
    });
    const body = await response.json().catch(() => ({
      message: "The server returned an unexpected response.",
    }));
    // A cancelled fetch can still resolve (including after its body was read).
    // Reject it before it can populate a new account's cache or expire its session.
    assertSessionEpoch(epoch);
    if (!response.ok) {
      if (response.status === 401) {
        changeSession(null, true);
        if (typeof window !== "undefined")
          window.dispatchEvent(new Event("session-expired"));
      }
      throw {
        message: body.message ?? "The request failed.",
        statusCode: response.status,
        errors: body.errors,
        sessionEpoch,
      } satisfies HttpError & { sessionEpoch: number };
    }
    return body as T;
  } finally {
    pendingRequests.delete(controller);
  }
}
export async function loadSession(): Promise<SessionInfo> {
  // Do not restore the old cookie while a deliberate sign-out is in flight.
  if (signedOut && !session)
    throw {
      message: "Sign in to continue.",
      statusCode: 401,
    } satisfies HttpError;
  const epoch = sessionEpoch;
  const initialDiscovery = !session && !signedOut;
  const next = await request<SessionInfo>("/api/session");
  assertSessionEpoch(epoch);
  changeSession(next, false, !initialDiscovery);
  return next;
}
export const authProvider: AuthProvider = {
  login: async (values: { login: string; password: string; mode: string }) => {
    changeSession(null, true);
    const epoch = sessionEpoch;
    try {
      const next = await request<SessionInfo>("/api/session/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      assertSessionEpoch(epoch);
      changeSession(next);
      const current = await loadSession();
      if (sessionFingerprint(session) !== sessionFingerprint(current))
        throw new DOMException("The account session changed.", "AbortError");
      return {
        success: true,
        redirectTo: current.identity.mustChangePassword ? "/account" : "/",
      };
    } catch (e) {
      return {
        success: false,
        error: { name: "Sign in failed", message: (e as HttpError).message },
      };
    }
  },
  logout: async () => {
    const csrf = session?.csrf;
    changeSession(null, !!session);
    if (!csrf) return { success: true, redirectTo: "/login" };
    const epoch = sessionEpoch;
    try {
      await request("/api/session/logout", {
        method: "POST",
        body: "{}",
        headers: { "X-CSRF-Token": csrf },
      });
      assertSessionEpoch(epoch);
      return { success: true, redirectTo: "/login" };
    } catch (e) {
      return {
        success: false,
        error: { name: "Sign out failed", message: (e as HttpError).message },
      };
    }
  },
  check: async () => {
    try {
      await loadSession();
      return { authenticated: true };
    } catch {
      return { authenticated: false, redirectTo: "/login" };
    }
  },
  onError: async (error) =>
    error.statusCode === 401 &&
    (!("sessionEpoch" in error) || error.sessionEpoch === sessionEpoch)
      ? { logout: true, redirectTo: "/login" }
      : { error },
  getIdentity: async () => session?.identity ?? (await loadSession()).identity,
  getPermissions: async () => session?.identity.permissions ?? [],
  forgotPassword: async (values: { login: string }) => {
    try {
      await request("/api/session/recover", {
        method: "POST",
        body: JSON.stringify(values),
      });
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: {
          name: "Recovery unavailable",
          message: (e as HttpError).message,
        },
      };
    }
  },
};
export const dataProvider: DataProvider = {
  getApiUrl: () => "/api",
  getList: async ({ resource, pagination, sorters, filters, meta }) => {
    const params = new URLSearchParams({
      _page: String(pagination?.currentPage ?? 1),
      _pageSize: String(
        pagination?.mode === "off" ? 10000 : (pagination?.pageSize ?? 25),
      ),
    });
    if (sorters?.[0]) {
      params.set("_sort", sorters[0].field);
      params.set("_order", sorters[0].order);
    }
    if (meta?.organization) params.set("_organization", meta.organization);
    for (const filter of filters ?? [])
      if (
        "field" in filter &&
        filter.value !== undefined &&
        filter.value !== null &&
        filter.value !== ""
      )
        params.set(filter.field, String(filter.value));
    return request(`/api/resources/${encodeURIComponent(resource)}?${params}`);
  },
  getOne: ({ resource, id }) =>
    request(
      `/api/resources/${encodeURIComponent(resource)}/${encodeURIComponent(String(id))}`,
    ),
  create: ({ resource, variables }) =>
    request(`/api/resources/${encodeURIComponent(resource)}`, {
      method: "POST",
      body: JSON.stringify(variables),
    }),
  update: ({ resource, id, variables }) =>
    request(
      `/api/resources/${encodeURIComponent(resource)}/${encodeURIComponent(String(id))}`,
      { method: "PUT", body: JSON.stringify(variables) },
    ),
  deleteOne: ({ resource, id }) =>
    request(
      `/api/resources/${encodeURIComponent(resource)}/${encodeURIComponent(String(id))}`,
      { method: "DELETE", body: "{}" },
    ),
};
