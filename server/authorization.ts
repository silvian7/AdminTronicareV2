import {
  canonical,
  resourceMap,
  valueOf,
  type RecordData,
  type Resource,
} from "../shared/resources";
import type { Session } from "./sessions";
import type { createUpstream } from "./upstream";
import { ApiError, idValue, publicRecord } from "./wire";

type Upstream = ReturnType<typeof createUpstream>;
const automation = new Set([
  "rules",
  "actions",
  "rulesforward",
  "actionsforward",
]);
const equipment = new Set(["hubs", "devices", "sensors"]);
const forbidden = () =>
  new ApiError(403, "This record or relationship is outside your access.");

export function parseRoleLevel(value: unknown): number | null {
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return null;
  const level = Number(value);
  return Number.isInteger(level) && level >= -2147483648 && level <= 2147483647
    ? level
    : null;
}

// Authorization uses authoritative records, including values omitted from a partial PUT.
// Submitted asset/organization labels alone never establish ownership of a relationship.
export function createAuthorization(upstream: Upstream) {
  async function read(session: Session, name: string, rawId: unknown) {
    let id: string;
    try {
      id = idValue(String(rawId ?? ""));
    } catch {
      throw forbidden();
    }
    const resource = resourceMap[name];
    let data: unknown;
    try {
      ({ data } = await upstream(
        resource.service,
        resource.routes.show!.replace(/\{[^}]+\}/, id),
        session.token,
      ));
    } catch (error) {
      if (error instanceof ApiError && [403, 404].includes(error.status))
        throw forbidden();
      throw error;
    }
    const row = publicRecord(resource, data);
    if (row.id !== id) throw forbidden();
    return row;
  }

  async function visibleAssets(session: Session): Promise<Set<string>> {
    const { data } = await upstream(
      "assets",
      "/v1/assets/scope",
      session.token,
    );
    if (!Array.isArray(data))
      throw new ApiError(502, "Asset permissions could not be checked.");
    const ids = new Set<string>();
    for (const row of data) {
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new ApiError(502, "Asset permissions could not be checked.");
      let id: string;
      try {
        id = idValue(String(valueOf(row, "IDAsset") ?? ""));
      } catch {
        throw new ApiError(502, "Asset permissions could not be checked.");
      }
      if (
        String(valueOf(row, "IDOrganization")) ===
        session.identity.organizationId
      )
        ids.add(id);
    }
    return ids;
  }

  async function scopeRecords(
    session: Session,
    resource: Resource,
    records: RecordData[],
  ) {
    if (session.identity.level >= 90) return records;
    const organization = session.identity.organizationId;
    if (["organizations", "users", "usergroups"].includes(resource.name))
      return records.filter(
        (row) => String(valueOf(row, "IDOrganization")) === organization,
      );
    if (
      resource.name === "assets" ||
      equipment.has(resource.name) ||
      automation.has(resource.name)
    ) {
      const assets = await visibleAssets(session);
      return records.filter((row) => {
        if (
          automation.has(resource.name) &&
          valueOf(row, "IsTemplate") === true
        )
          return true;
        const rowOrganization = valueOf(row, "IDOrganization");
        return (
          assets.has(String(valueOf(row, "IDAsset"))) &&
          (rowOrganization === undefined ||
            String(rowOrganization) === organization)
        );
      });
    }
    if (resource.name === "userlog") {
      const owners = new Map<string, Promise<boolean>>();
      const permitted = records.map((row) => {
        const id = String(valueOf(row, "IDuser") ?? "");
        if (!owners.has(id))
          owners.set(
            id,
            read(session, "users", id)
              .then(
                (user) =>
                  String(valueOf(user, "IDOrganization")) === organization,
              )
              .catch((error: unknown) => {
                if (error instanceof ApiError && error.status === 403)
                  return false;
                throw error;
              }),
          );
        return owners.get(id)!;
      });
      const allowed = await Promise.all(permitted);
      return records.filter((_row, index) => allowed[index]);
    }
    return records;
  }

  async function assertLowerRole(session: Session, id: unknown) {
    let userType: RecordData;
    try {
      userType = await read(session, "usertypes", id);
    } catch {
      throw forbidden();
    }
    const level = parseRoleLevel(valueOf(userType, "Level"));
    if (
      level === null ||
      !Number.isFinite(session.identity.level) ||
      level >= session.identity.level
    )
      throw forbidden();
  }

  async function protectUser(session: Session, user: RecordData) {
    if (session.identity.level >= 90) return;
    if (valueOf(user, "Admin") !== false) throw forbidden();
    await assertLowerRole(session, valueOf(user, "IDUserType"));
  }

  async function checkWriteScope(
    session: Session,
    resource: Resource,
    body: RecordData,
    previous?: RecordData,
  ) {
    if (session.identity.level >= 90) return;
    if (["authz", "usertypes"].includes(resource.name))
      throw new ApiError(403, "An administrator must change access settings.");
    if (resource.name === "users") {
      if (previous) await protectUser(session, previous);
      const role = valueOf(body, "IDUserType");
      // An omitted create role relies on an unknown upstream privilege default.
      if (!previous || role !== undefined) await assertLowerRole(session, role);
      if (!previous && valueOf(body, "Admin") === undefined)
        body.m_bAdmin = false;
    }
    if (
      automation.has(resource.name) &&
      (valueOf(previous ?? {}, "IsTemplate") === true ||
        valueOf(body, "IsTemplate") === true)
    )
      throw new ApiError(
        403,
        "Only platform administrators may change templates.",
      );
    for (const [key, value] of Object.entries(body)) {
      const field = canonical(key);
      if (
        field === "IDOrganization" &&
        String(value) !== session.identity.organizationId
      )
        throw new ApiError(403, "Choose your organization.");
      if (
        (field === "Admin" && (resource.name !== "users" || value !== false)) ||
        (field === "IDUserType" && resource.name !== "users")
      )
        throw new ApiError(
          403,
          "An administrator must change access settings.",
        );
    }
    if (
      !previous &&
      ["assets", "users", "usergroups"].includes(resource.name) &&
      valueOf(body, "IDOrganization") === undefined
    )
      body.m_nIDOrganization = session.identity.organizationId;

    const effective: RecordData = Object.fromEntries(
      Object.entries(previous ?? {}).map(([key, value]) => [
        canonical(key),
        value,
      ]),
    );
    for (const [key, value] of Object.entries(body))
      effective[canonical(key)] = value;
    const assetId = String(valueOf(effective, "IDAsset") ?? "");
    if (equipment.has(resource.name) || automation.has(resource.name)) {
      const assets = await visibleAssets(session);
      if (!assets.has(assetId)) throw forbidden();
      const organization = valueOf(effective, "IDOrganization");
      if (
        organization !== undefined &&
        String(organization) !== session.identity.organizationId
      )
        throw forbidden();
      // Forward records are immutable ownership snapshots. Their editable flags
      // remain available after the original rule/action/sensor is moved or deleted.
      // writeBody independently rejects attempts to change snapshot relationships.
      if (resource.name.endsWith("forward")) return;
      const referenceCache = new Map<string, Promise<RecordData>>();
      const reference = (name: string, rawId: unknown) => {
        const key = `${name}:${String(rawId)}`;
        if (!referenceCache.has(key))
          referenceCache.set(key, read(session, name, rawId));
        return referenceCache.get(key)!;
      };
      const sameAsset = async (name: string, rawId: unknown) => {
        const row = await reference(name, rawId);
        const owner = String(valueOf(row, "IDAsset") ?? "");
        const rowOrganization = valueOf(row, "IDOrganization");
        if (
          !assets.has(owner) ||
          owner !== assetId ||
          valueOf(row, "IsTemplate") === true ||
          (rowOrganization !== undefined &&
            String(rowOrganization) !== session.identity.organizationId)
        )
          throw forbidden();
        return row;
      };
      const checkRule = async (rawId: unknown) => {
        const rule = await sameAsset("rules", rawId);
        await sameAsset("sensors", valueOf(rule, "IDSensor"));
        return rule;
      };
      if (resource.name === "devices")
        await sameAsset("hubs", valueOf(effective, "IDHub"));
      if (resource.name === "sensors")
        await sameAsset("devices", valueOf(effective, "IDDevice"));
      if (resource.name === "rules")
        await sameAsset("sensors", valueOf(effective, "IDSensor"));
      if (resource.name === "actions")
        await checkRule(valueOf(effective, "IDRule"));
    }
  }

  return { scopeRecords, checkWriteScope, protectUser, visibleAssets, read };
}
