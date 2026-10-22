import {
  canAccess,
  resourceMap,
  valueOf,
  type RecordData,
} from "../shared/resources";
import type { createAuthorization } from "./authorization";
import type { Session } from "./sessions";
import type { createUpstream } from "./upstream";
import { ApiError, idValue, publicRecord } from "./wire";

const maxRows = 10000;
const maxParents = 100;
const hubFields = [
  "m_nIDHub",
  "m_nIDHubType",
  "m_nIDOrganization",
  "m_nIDAsset",
  "m_sTag",
  "m_sLabel",
  "m_sSerialNr",
  "m_dhDhLastEvent",
];

function nonnegativeId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d{0,18})$/.test(value) ||
    BigInt(value) > 9223372036854775807n
  )
    throw new ApiError(
      502,
      "The service returned an invalid equipment relationship.",
    );
  return value;
}

function positiveId(value: unknown): string {
  try {
    return idValue(value);
  } catch {
    throw new ApiError(
      502,
      "The service returned an invalid equipment identity.",
    );
  }
}

export async function assetEquipmentHubs(
  assetId: string,
  session: Session,
  upstream: ReturnType<typeof createUpstream>,
  authorization: ReturnType<typeof createAuthorization>,
  organization?: string,
) {
  const asset = await authorization.read(session, "assets", assetId);
  if (
    !(await authorization.scopeRecords(session, resourceMap.assets, [asset]))
      .length
  )
    throw new ApiError(403, "This asset is outside your access.");
  const assetOrganization = nonnegativeId(valueOf(asset, "IDOrganization"));
  if (organization !== undefined && organization !== assetOrganization)
    throw new ApiError(403, "This asset is outside the selected organization.");

  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(12000),
  ]);
  let limited = false;
  const readList = async (name: "hubs" | "devices") => {
    const { data } = await upstream("core", `/v1/${name}`, session.token, {
      query: { idasset: assetId },
      signal,
    });
    if (!Array.isArray(data))
      throw new ApiError(502, "The service did not return an equipment list.");
    limited ||= data.length >= maxRows;
    return data.slice(0, maxRows).map((row) => {
      const record = publicRecord(resourceMap[name], row);
      positiveId(record.id);
      return record;
    });
  };
  try {
    const [direct, devices] = await Promise.all([
      readList("hubs"),
      canAccess(session.identity, "devices", "list") ? readList("devices") : [],
    ]);
    const rows = new Map<string, RecordData>();
    for (const hub of direct) {
      const id = idValue(hub.id);
      if (
        nonnegativeId(valueOf(hub, "IDAsset")) === assetId &&
        nonnegativeId(valueOf(hub, "IDOrganization")) === assetOrganization
      )
        rows.set(id, hub);
    }
    const parentIds = new Set<string>();
    for (const device of devices) {
      if (
        nonnegativeId(valueOf(device, "IDAsset")) !== assetId ||
        nonnegativeId(valueOf(device, "IDOrganization")) !== assetOrganization
      )
        continue;
      parentIds.add(positiveId(valueOf(device, "IDHub")));
    }
    const missing = [...parentIds]
      .filter((id) => !rows.has(id))
      .sort(compareIds);
    limited ||= missing.length > maxParents;
    const requested = missing.slice(0, maxParents);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, requested.length) }, async () => {
        while (next < requested.length) {
          const id = requested[next++];
          let data: unknown;
          try {
            ({ data } = await upstream(
              "core",
              `/v1/hubs/${id}`,
              session.token,
              { signal },
            ));
          } catch (error) {
            if (
              error instanceof ApiError &&
              [403, 404].includes(error.status)
            ) {
              limited = true;
              continue;
            }
            throw error;
          }
          const hub = publicRecord(resourceMap.hubs, data);
          if (hub.id !== id)
            throw new ApiError(
              502,
              "The service returned an invalid gateway identity.",
            );
          nonnegativeId(valueOf(hub, "IDAsset"));
          if (
            nonnegativeId(valueOf(hub, "IDOrganization")) !== assetOrganization
          ) {
            limited = true;
            continue;
          }
          rows.set(id, hub);
        }
      }),
    );
    const hubs = [...rows.values()].sort((a, b) => compareIds(a.id!, b.id!));
    const visible = new Set(
      (await authorization.scopeRecords(session, resourceMap.hubs, hubs)).map(
        (hub) => hub.id,
      ),
    );
    if (
      !(await authorization.scopeRecords(session, resourceMap.assets, [asset]))
        .length
    )
      throw new ApiError(403, "This asset is outside your access.");
    limited ||= hubs.length > maxRows;
    const data = hubs.slice(0, maxRows).map((hub) => ({
      ...Object.fromEntries(
        hubFields.filter((key) => key in hub).map((key) => [key, hub[key]]),
      ),
      id: hub.id,
      _sharedGateway: valueOf(hub, "IDAsset") !== assetId,
      _canOpenHub: visible.has(hub.id),
    }));
    return { data, total: data.length, limited };
  } finally {
    controller.abort();
  }
}

function compareIds(a: string, b: string) {
  return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
}
