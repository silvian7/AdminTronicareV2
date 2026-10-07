import { LosslessNumber, stringify } from "lossless-json";
import {
  resources,
  resourceMap,
  canonical,
  responseKey,
  type RecordData,
  type Resource,
  type Identity,
} from "../shared/resources";
import { parseWire } from "../server/wire";
import type { Config } from "../server/config";
import { services } from "../shared/resources";
import type { Transport } from "../server/upstream";

// Entirely synthetic records. Never load application .env files in tests.
export const testIdentity: Identity = {
  id: "1",
  name: "Test Administrator",
  organizationId: "7",
  userTypeId: "90",
  level: 90,
  mustChangePassword: false,
  permissions: resources.map((r) => ({ entity: r.name, rights: "crud" })),
};
export const testConfig: Config = {
  port: 8080,
  production: false,
  publicOrigin: "http://localhost:5173",
  cookieSecure: false,
  sessionKey: new Uint8Array(32).fill(7),
  passwordSalt: "tcare",
  origins: Object.fromEntries(
    services.map((s) => [s, `http://${s}.fixture.invalid`]),
  ),
  enabledWrites: new Set(services),
  requestTimeoutMs: 1000,
  trustProxy: 0,
};
export function fixtureRecord(
  resource: Resource,
  id = "1",
  overrides: RecordData = {},
): RecordData {
  const record: RecordData = {};
  for (const field of resource.fields) {
    record[field.key] =
      field.type === "boolean"
        ? false
        : field.type === "integer" || field.type === "number"
          ? "0"
          : "";
    if (/Label$/.test(field.key))
      record[field.key] = `${resource.singular} fixture`;
  }
  for (const key of Object.keys(record))
    if (/IDOrganization$/.test(key)) record[key] = "7";
  record[resource.primaryKey] = id;
  return { ...record, ...overrides };
}
export function wireRecord(resource: Resource, row: RecordData): string {
  return stringify(
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => {
        const field = resource.fields.find((f) => f.key === key);
        return [
          key,
          field && ["integer", "number"].includes(field.type)
            ? new LosslessNumber(String(value))
            : value,
        ];
      }),
    ),
  )!;
}
export interface CapturedCall {
  url: URL;
  method: string;
  headers: Headers;
  body?: string;
}
export function fixtureTransport(identity = testIdentity) {
  const calls: CapturedCall[] = [];
  const records = new Map(resources.map((r) => [r.name, [fixtureRecord(r)]]));
  const assetAssignments = {
    users: new Map([["1", new Set(["1"])]]),
    usergroups: new Map([["1", new Set(["1"])]]),
  };
  let forced: Response | undefined;
  const transport: Transport = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      headers: new Headers(init?.headers),
      body: init?.body as string | undefined,
    });
    if (forced) {
      const response = forced;
      forced = undefined;
      return response;
    }
    if (url.pathname === "/v1/usersadmin/connect")
      return Response.json({
        status: true,
        token: "synthetic-session-token",
        iduser: identity.id,
        idorganization: identity.organizationId,
        idusertype: identity.userTypeId,
        usertypelevel: identity.level,
        firstname: "Test",
        lastname: "Administrator",
        onetimepwd: identity.mustChangePassword,
        authorizations: identity.permissions,
      });
    if (url.pathname === "/v1/assets/scope")
      return Response.json([
        { m_nIDAsset: "1", m_nIDOrganization: identity.organizationId },
      ]);
    const assignment = url.pathname.match(
      /^\/v1\/assets\/(\d+)\/(users|usergroups)\/(\d+)$/,
    );
    if (assignment) {
      const [, assetId, target, relatedId] = assignment;
      const related = resourceMap[target];
      if (
        !records.get("assets")!.some((row) => row.m_nIDAsset === assetId) ||
        !records
          .get(target)!
          .some((row) => row[related.primaryKey] === relatedId)
      )
        return new Response(null, { status: 404 });
      const assignments =
        assetAssignments[target as keyof typeof assetAssignments];
      const linked = assignments.get(assetId) ?? new Set<string>();
      if (method === "POST") {
        if (linked.has(relatedId)) return new Response(null, { status: 409 });
        linked.add(relatedId);
        assignments.set(assetId, linked);
      } else if (method === "DELETE") {
        if (!linked.delete(relatedId))
          return new Response(null, { status: 409 });
      } else return new Response(null, { status: 405 });
      return new Response(null, { status: 200 });
    }
    if (
      url.pathname.startsWith("/v1/usersadmin/") ||
      url.pathname.includes("/users2usergroups/")
    )
      return Response.json({ status: true });
    const resource = resources.find((r) =>
      Object.values(r.routes).some(
        (path) =>
          path &&
          new RegExp(`^${path.replace(/\{[^}]+\}/, "[0-9]+")}$`).test(
            url.pathname,
          ),
      ),
    );
    if (!resource)
      return Response.json({
        Status: true,
        Engine_Version: "test",
        Engine_Lastheartbeat: 0,
      });
    const rows = records.get(resource.name)!;
    const id = url.pathname.match(/\/(\d+)$/)?.[1];
    if (method === "DELETE") {
      records.set(
        resource.name,
        rows.filter((row) => row[resource.primaryKey] !== id),
      );
      return new Response(null, { status: 200 });
    }
    if (method === "GET" && url.pathname === resource.routes.list) {
      const assetId = url.searchParams.get("idasset");
      const linked =
        assetId && resource.name in assetAssignments
          ? assetAssignments[
              resource.name as keyof typeof assetAssignments
            ].get(assetId)
          : undefined;
      const selected =
        assetId && resource.name in assetAssignments
          ? rows.filter((row) => linked?.has(String(row[resource.primaryKey])))
          : rows;
      return new Response(
        `[${selected.map((row) => wireRecord(resource, row)).join(",")}]`,
        { headers: { "Content-Type": "application/json" } },
      );
    }
    let row = rows.find((row) => row[resource.primaryKey] === id);
    if (method === "POST") {
      row = fixtureRecord(resource, String(100 + rows.length));
      rows.push(row);
    }
    if (!row) return new Response(null, { status: 404 });
    if (method === "POST" || method === "PUT") {
      const body = parseWire(String(init?.body ?? "{}")) as RecordData;
      for (const [key, value] of Object.entries(body))
        row[responseKey(resource, key)] = value;
    }
    return new Response(wireRecord(resource, row), {
      headers: { "Content-Type": "application/json" },
    });
  };
  return {
    transport,
    calls,
    records,
    assetAssignments,
    respondNext: (response: Response) => {
      forced = response;
    },
  };
}
