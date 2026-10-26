import type { Identity, OrganizationMembership } from "../shared/resources";
import { parseRoleLevel } from "./authorization";
import { ApiError, idValue } from "./wire";

const invalid = () =>
  new ApiError(502, "The service returned an invalid organization context.");
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  return value as Record<string, unknown>;
};
const identifier = (value: unknown, zero = false): string => {
  if (zero && value === "0") return "0";
  try {
    return idValue(value);
  } catch {
    throw invalid();
  }
};

export function organizationMemberships(
  value: unknown,
  userId: string,
  options: { includeInactive?: boolean } = {},
): OrganizationMembership[] {
  if (!Array.isArray(value) || value.length > 256) throw invalid();
  const seen = new Set<string>();
  const result: OrganizationMembership[] = [];
  for (const valueEntry of value) {
    const entry = object(valueEntry);
    const organizationId = identifier(entry.idorganization);
    const userTypeId = identifier(entry.idusertype);
    if (
      identifier(entry.iduser) !== userId ||
      typeof entry.active !== "boolean" ||
      seen.has(organizationId)
    )
      throw invalid();
    seen.add(organizationId);
    if (entry.active || options.includeInactive)
      result.push({ organizationId, userTypeId, active: entry.active });
  }
  return result.sort((a, b) =>
    BigInt(a.organizationId) < BigInt(b.organizationId) ? -1 : 1,
  );
}

export function validateSelectedMembership(
  identity: Identity,
  memberships: OrganizationMembership[],
  activeOrganizationId: string | null,
) {
  if (activeOrganizationId === null) {
    if (identity.level < 90) throw invalid();
    return;
  }
  const selected = memberships.find(
    (entry) => entry.organizationId === activeOrganizationId,
  );
  if (
    !selected ||
    identity.organizationId !== activeOrganizationId ||
    (identity.level < 90 && selected.userTypeId !== identity.userTypeId)
  )
    throw invalid();
}

export function connectedSession(
  value: unknown,
  fallbackName: string,
  options: {
    userId?: string;
    organizationId?: string;
    platformLevel?: number;
    platformUserTypeId?: string;
  } = {},
) {
  const data = object(value);
  if (
    data.status !== true ||
    typeof data.token !== "string" ||
    data.token === "null" ||
    !/^[!-~]{1,4096}$/.test(data.token)
  )
    throw invalid();
  const level = parseRoleLevel(data.usertypelevel);
  if (
    level === null ||
    typeof data.onetimepwd !== "boolean" ||
    !Array.isArray(data.authorizations) ||
    data.authorizations.length > 512
  )
    throw invalid();
  const permissions = data.authorizations.map((valueEntry) => {
    const entry = object(valueEntry);
    if (
      typeof entry.entity !== "string" ||
      !entry.entity ||
      entry.entity.length > 128 ||
      typeof entry.rights !== "string" ||
      entry.rights.length > 32
    )
      throw invalid();
    return { entity: entry.entity, rights: entry.rights };
  });
  const identity: Identity = {
    id: identifier(data.iduser),
    name:
      [data.firstname, data.lastname]
        .filter((part): part is string => typeof part === "string" && !!part)
        .join(" ") || fallbackName,
    organizationId: identifier(data.idorganization, true),
    userTypeId: identifier(data.idusertype),
    level,
    permissions,
    mustChangePassword: data.onetimepwd === true,
  };
  if (options.userId && identity.id !== options.userId) throw invalid();
  if (
    options.organizationId &&
    identity.organizationId !== options.organizationId
  )
    throw invalid();
  if (
    options.platformLevel !== undefined &&
    (identity.level !== options.platformLevel ||
      identity.userTypeId !== options.platformUserTypeId)
  )
    throw invalid();
  if (
    options.organizationId &&
    options.platformLevel === undefined &&
    identity.level >= 90
  )
    throw invalid();
  if (!("organizations" in data)) {
    if (options.organizationId) throw invalid();
    return { token: data.token, identity };
  }
  const memberships = organizationMemberships(data.organizations, identity.id);
  const activeOrganizationId =
    options.organizationId ??
    (identity.level >= 90 ? null : identity.organizationId);
  validateSelectedMembership(identity, memberships, activeOrganizationId);
  return {
    token: data.token,
    identity,
    organizationMemberships: memberships,
    activeOrganizationId,
  };
}
