import type { AuthProvider, DataProvider, HttpError } from "@refinedev/core";
import type {
  Identity,
  OrganizationMembership,
  Service,
} from "../shared/resources";

export interface SessionInfo {
  identity: Identity;
  csrf: string;
  expiresAt: number;
  organizationMemberships?: OrganizationMembership[];
  activeOrganizationId?: string | null;
  services?: Partial<
    Record<Service, { configured: boolean; writable: boolean }>
  >;
}
export function sessionLanding(value: SessionInfo, preferCare = false) {
  const care = value.identity.caregiverReadOnly || preferCare;
  if (value.identity.mustChangePassword)
    return care ? "/care/account" : "/account";
  return care ? "/care" : value.identity.level >= 90 ? "/services" : "/";
}
let session: SessionInfo | null = null;
let sessionEpoch = 0;
let sessionRevision = 0;
let signedOut = false;
const pendingRequests = new Set<AbortController>();
const sessionListeners = new Set<() => void>();
const sessionRevisionKey = "tronicare-admin-session-revision";
const organizationRevisionKey = "tronicare-admin-organization-revision";
let organizationSwitch: {
  organizationId: string;
  promise: Promise<SessionInfo>;
} | null = null;
let contextReload: Promise<SessionInfo> | null = null;
let discovery: { epoch: number; promise: Promise<SessionInfo> } | null = null;
let membershipSnapshot: {
  epoch: number;
  data: OrganizationMembership[];
} | null = null;
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
    organizationMemberships: value.organizationMemberships,
    activeOrganizationId: value.activeOrganizationId,
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
  organizationSwitch = null;
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
    if (event.key === organizationRevisionKey && event.newValue !== null)
      void refreshOrganizationSession().catch(() => {});
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
  if (
    organizationSwitch &&
    ![
      "/api/session/organization",
      "/api/session",
      "/api/session/logout",
    ].includes(path)
  )
    throw new DOMException("The organization is changing.", "AbortError");
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
      if (
        [403, 409].includes(response.status) &&
        [
          "organization_context_changed",
          "organization_switch_pending",
        ].includes(body.code) &&
        path !== "/api/session" &&
        path !== "/api/session/organization"
      ) {
        void refreshOrganizationSession().catch(() => {});
        throw new DOMException(
          "The organization context changed.",
          "AbortError",
        );
      }
      if (response.status === 401 && path !== "/api/session/organization") {
        changeSession(null, true);
        if (typeof window !== "undefined")
          window.dispatchEvent(new Event("session-expired"));
      }
      throw {
        message: body.message ?? "The request failed.",
        statusCode: response.status,
        errors: body.errors,
        code: body.code,
        sessionEpoch,
      } satisfies HttpError & { sessionEpoch: number; code?: string };
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
  if (organizationSwitch && session) return session;
  if (discovery?.epoch === sessionEpoch) return discovery.promise;
  const epoch = sessionEpoch;
  const initialDiscovery = !session && !signedOut;
  const promise = (async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const next = await request<SessionInfo>("/api/session");
        assertSessionEpoch(epoch);
        changeSession(next, false, !initialDiscovery);
        return next;
      } catch (error) {
        assertSessionEpoch(epoch);
        if (
          (error as { code?: string }).code !== "organization_switch_pending" ||
          attempt >= 119
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
        assertSessionEpoch(epoch);
      }
    }
  })();
  discovery = { epoch, promise };
  try {
    return await promise;
  } finally {
    if (discovery?.promise === promise) discovery = null;
  }
}

export async function refreshOrganizationSession(): Promise<SessionInfo> {
  if (contextReload) return contextReload;
  changeSession(null, true, false);
  signedOut = false;
  const epoch = sessionEpoch;
  const promise = loadSession();
  contextReload = promise;
  try {
    return await promise;
  } catch (error) {
    if (sessionEpoch === epoch) {
      changeSession(null, true, false);
      if (typeof window !== "undefined")
        window.dispatchEvent(new Event("session-expired"));
    }
    throw error;
  } finally {
    if (contextReload === promise) contextReload = null;
  }
}

export async function loadOrganizationMemberships(): Promise<
  OrganizationMembership[]
> {
  const epoch = sessionEpoch;
  const response = await request<{ data: OrganizationMembership[] }>(
    "/api/session/organizations",
  );
  assertSessionEpoch(epoch);
  const validId = (value: unknown): value is string =>
    typeof value === "string" &&
    /^[1-9]\d{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n;
  if (
    !Array.isArray(response.data) ||
    response.data.length > 256 ||
    response.data.some(
      (membership) =>
        !membership ||
        !validId(membership.organizationId) ||
        !validId(membership.userTypeId) ||
        typeof membership.active !== "boolean",
    ) ||
    new Set(response.data.map((membership) => membership.organizationId))
      .size !== response.data.length
  )
    throw new Error("Organization memberships could not be verified.");
  membershipSnapshot = { epoch, data: response.data };
  return response.data;
}

export function switchOrganization(
  organizationId: string,
): Promise<SessionInfo> {
  if (
    !/^[1-9]\d{0,18}$/.test(organizationId) ||
    BigInt(organizationId) > 9223372036854775807n
  )
    return Promise.reject({
      message: "Choose an organization.",
      statusCode: 400,
    });
  const current = session;
  if (!current)
    return Promise.reject({ message: "Sign in to continue.", statusCode: 401 });
  if (organizationSwitch)
    return organizationSwitch.organizationId === organizationId
      ? organizationSwitch.promise
      : Promise.reject({
          message: "An organization switch is already in progress.",
          statusCode: 409,
        });
  if (current.activeOrganizationId === organizationId)
    return Promise.resolve(current);
  if (
    !(
      membershipSnapshot?.epoch === sessionEpoch
        ? membershipSnapshot.data
        : current.organizationMemberships
    )?.some(
      (membership) =>
        membership.active && membership.organizationId === organizationId,
    )
  )
    return Promise.reject({
      message: "You do not have an active membership in this organization.",
      statusCode: 403,
    });

  // Fence old responses before the backend can revoke the current token. Keep
  // the mounted cache intact until the switch succeeds or the caller retries.
  sessionEpoch += 1;
  for (const controller of pendingRequests) controller.abort();
  pendingRequests.clear();
  const epoch = sessionEpoch;
  const operation = {
    organizationId,
    promise: null as unknown as Promise<SessionInfo>,
  };
  organizationSwitch = operation;
  operation.promise = (async () => {
    try {
      const next = await request<SessionInfo>("/api/session/organization", {
        method: "POST",
        body: JSON.stringify({ organizationId }),
      });
      assertSessionEpoch(epoch);
      if (
        !next?.identity ||
        next.identity.id !== current.identity.id ||
        next.identity.organizationId !== organizationId ||
        next.activeOrganizationId !== organizationId ||
        typeof next.csrf !== "string" ||
        !next.csrf ||
        !Array.isArray(next.identity.permissions) ||
        !Array.isArray(next.organizationMemberships)
      )
        throw new Error("The organization switch could not be confirmed.");
      changeSession(next, false, false);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(
            organizationRevisionKey,
            crypto.randomUUID(),
          );
        } catch {
          // Stale context headers also trigger authoritative rediscovery.
        }
      }
      return next;
    } catch (error) {
      if (sessionEpoch !== epoch) throw error;
      const status = (error as HttpError).statusCode;
      if (
        (error as { code?: string }).code === "organization_context_changed" ||
        ![400, 403, 404, 422].includes(status)
      ) {
        // A rotating operation cannot be replayed safely after a lost response.
        // Discover the authoritative BFF session instead of reusing old rights.
        organizationSwitch = null;
        try {
          const recovered = await refreshOrganizationSession();
          if (recovered.activeOrganizationId === organizationId)
            return recovered;
        } catch {
          // Rediscovery already cleared the uncertain context.
        }
      }
      throw error;
    } finally {
      if (organizationSwitch === operation) organizationSwitch = null;
    }
  })();
  return operation.promise;
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
        redirectTo: sessionLanding(current),
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
    if (resource === "hubs" && typeof meta?.assetEquipmentHubs === "string") {
      const params = new URLSearchParams();
      if (meta.organization) params.set("_organization", meta.organization);
      return request(
        `/api/assets/${encodeURIComponent(meta.assetEquipmentHubs)}/equipment-hubs${params.size ? `?${params}` : ""}`,
      );
    }
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
