import type { SessionInfo } from "./api";

function preferenceKey(session: SessionInfo) {
  return `tronicare-admin-workspace:${session.identity.id}:${session.activeOrganizationId ?? "global"}`;
}

function validOrganization(value: string) {
  return (
    value === "" ||
    value === "0" ||
    (/^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n)
  );
}

export function loadWorkspaceOrganization(session: SessionInfo): string {
  if (session.identity.level < 90) return session.identity.organizationId;
  const fallback = session.activeOrganizationId ?? "";
  try {
    const saved = window.localStorage.getItem(preferenceKey(session));
    return saved !== null && validOrganization(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

export function saveWorkspaceOrganization(session: SessionInfo, id: string) {
  if (session.identity.level < 90 || !validOrganization(id)) return;
  try {
    window.localStorage.setItem(preferenceKey(session), id);
  } catch {
    // Browser storage restrictions must not prevent changing the filter.
  }
}
