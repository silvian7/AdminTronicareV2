import { valueOf, type RecordData } from "../shared/resources";
import { createAuthorization } from "./authorization";
import type { Session } from "./sessions";
import type { createUpstream } from "./upstream";
import { ApiError, idValue } from "./wire";

const maxParents = 100;

function nonnegativeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(0|[1-9]\d{0,18})$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
  );
}

// Sensors have no organization field. A platform administrator can establish an
// unassigned sensor's Workspace through its exact, readable unassigned Device.
// Caller authorization has already scoped these records before this projection.
export async function sensorsInWorkspace(
  records: RecordData[],
  assetIds: ReadonlySet<unknown>,
  organization: string,
  session: Session,
  upstream: ReturnType<typeof createUpstream>,
) {
  const assigned = new Set(
    records.filter(
      (row) =>
        valueOf(row, "IDAsset") !== "0" &&
        assetIds.has(valueOf(row, "IDAsset")),
    ),
  );
  const result = () => ({
    records: records.filter((row) => assigned.has(row)),
    limited: false,
  });
  if (!(session.identity.level >= 90)) return result();
  const unassigned = records.filter((row) => valueOf(row, "IDAsset") === "0");
  if (!unassigned.length) return result();
  let limited = false;
  const parentIds = new Set<string>();
  for (const sensor of unassigned) {
    try {
      parentIds.add(idValue(valueOf(sensor, "IDDevice")));
    } catch {
      limited = true;
    }
  }
  const requested = [...parentIds]
    .sort((a, b) =>
      BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
    )
    .slice(0, maxParents);
  limited ||= parentIds.size > maxParents;
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(12000),
  ]);
  const authorization = createAuthorization((service, path, token, options) =>
    upstream(service, path, token, { ...options, signal }),
  );
  const allowed = new Set<string>();
  let next = 0;
  try {
    await Promise.all(
      Array.from({ length: Math.min(4, requested.length) }, async () => {
        while (next < requested.length) {
          const id = requested[next++];
          let device: RecordData;
          try {
            device = await authorization.read(session, "devices", id);
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
          const deviceAsset = valueOf(device, "IDAsset");
          const deviceOrganization = valueOf(device, "IDOrganization");
          if (
            !nonnegativeId(deviceAsset) ||
            !nonnegativeId(deviceOrganization)
          ) {
            limited = true;
            continue;
          }
          if (deviceAsset === "0" && deviceOrganization === organization)
            allowed.add(id);
        }
      }),
    );
    return {
      records: records.filter(
        (row) =>
          assigned.has(row) ||
          (valueOf(row, "IDAsset") === "0" &&
            allowed.has(String(valueOf(row, "IDDevice")))),
      ),
      limited,
    };
  } finally {
    controller.abort();
  }
}
