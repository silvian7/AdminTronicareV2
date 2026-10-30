import type { CareSubject } from "../shared/care";
import { valueOf, type RecordData } from "../shared/resources";
import { sensorLastReadingTime } from "../shared/sensor-reading";
import type { Session } from "./sessions";
import type { createUpstream } from "./upstream";
import { ApiError, idValue } from "./wire";

type Bed = CareSubject["bed"];
type Upstream = ReturnType<typeof createUpstream>;
const maxRows = 10000;
const invalid = () => new ApiError(502, "Bed observations are unavailable.");
const object = (value: unknown): value is RecordData =>
  !!value && typeof value === "object" && !Array.isArray(value);
function id(value: unknown): string {
  try {
    return idValue(value);
  } catch {
    throw invalid();
  }
}

function subjects(response: unknown): RecordData[] {
  if (!object(response)) throw invalid();
  const data = Array.isArray(response.data) ? response.data : [response.data];
  if (data.length > 100) throw invalid();
  const seen = new Set<string>();
  return data.map((row) => {
    if (!object(row) || !object(row.bed)) throw invalid();
    const identity = id(row.id);
    id(row.organizationId);
    if (seen.has(identity)) throw invalid();
    seen.add(identity);
    return row;
  });
}

function needsObservation(subject: RecordData) {
  const bed = subject.bed as RecordData;
  return (
    bed.availability === undefined &&
    bed.state === "unknown" &&
    bed.lastObservedState === "unknown" &&
    bed.observedAt === null
  );
}

function noObservation(availability: Bed["availability"]): Bed {
  return {
    state: "unknown",
    freshness: "unassessed",
    lastObservedState: "unknown",
    observedAt: null,
    availability,
  };
}

function replaceBeds(response: unknown, beds: Map<string, Bed>): unknown {
  const body = response as RecordData;
  const replace = (row: RecordData) =>
    beds.has(row.id as string) && needsObservation(row)
      ? { ...row, bed: beds.get(row.id as string)! }
      : row;
  return {
    ...body,
    data: Array.isArray(body.data)
      ? (body.data as RecordData[]).map(replace)
      : replace(body.data as RecordData),
  };
}

/**
 * Explicit local source integration, using the same caller-scoped Core reads as
 * Admin. No elevated token, raw technical response, history, or Core SQL fallback.
 */
export async function adminBedObservations(
  initial: unknown,
  session: Session,
  upstream: Upstream,
  revalidate: () => Promise<unknown>,
): Promise<unknown> {
  const selected = subjects(initial).filter(needsObservation);
  if (!selected.length) return initial;
  const allowed =
    (initial as RecordData).reportAccess === "allowed" &&
    (session.identity.level >= 90 ||
      session.identity.permissions.some(
        (permission) =>
          permission.entity.toLowerCase() === "sensors" &&
          permission.rights.toLowerCase().includes("r"),
      ));
  const status = (availability: Bed["availability"]) =>
    replaceBeds(
      initial,
      new Map(selected.map((row) => [id(row.id), noObservation(availability)])),
    );
  if (!allowed) return status("denied");

  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(8000),
  ]);
  try {
    const read = async (name: "sensors" | "sensortypes" | "devices") => {
      const { data } = await upstream("core", `/v1/${name}`, session.token, {
        signal,
        ...(name !== "sensortypes" && selected.length === 1
          ? { query: { idasset: id(selected[0].id) } }
          : {}),
      });
      if (!Array.isArray(data) || !data.every(object)) throw invalid();
      return data as RecordData[];
    };
    const results = await Promise.allSettled([
      read("sensors"),
      read("sensortypes"),
      read("devices"),
    ]);
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason as unknown] : [],
    );
    if (failures.length) {
      const expired = failures.find(
        (error) => error instanceof ApiError && error.status === 401,
      );
      if (expired) throw expired;
      return status(
        failures.some(
          (error) => error instanceof ApiError && error.status === 403,
        )
          ? "denied"
          : "unavailable",
      );
    }
    const [sensors, types, devices] = results.map((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
    if ([sensors, types, devices].some((rows) => rows.length >= maxRows))
      return status("limited");
    const index = (rows: RecordData[], field: string) => {
      const indexed = new Map<string, RecordData>();
      for (const row of rows) {
        const identity = id(valueOf(row, field));
        if (indexed.has(identity)) throw invalid();
        indexed.set(identity, row);
      }
      return indexed;
    };
    const typeIndex = index(types, "IDSensorType");
    const deviceIndex = index(devices, "IDDevice");
    const sensorIndex = index(sensors, "IDSensor");
    const candidates = new Map<string, RecordData[]>();
    const organizations = new Map(
      selected.map((row) => [id(row.id), id(row.organizationId)]),
    );
    for (const sensor of sensorIndex.values()) {
      const asset = valueOf(sensor, "IDAsset");
      if (typeof asset !== "string" || !organizations.has(asset)) continue;
      const type = typeIndex.get(id(valueOf(sensor, "IDSensorType")));
      const hardware = type && valueOf(type, "HardwareType");
      if (
        typeof hardware !== "string" ||
        hardware.trim().toLowerCase() !== "bedoff" ||
        String(valueOf(type!, "ValueType")) !== "1"
      )
        continue;
      const rows = candidates.get(asset) ?? [];
      rows.push(sensor);
      candidates.set(asset, rows);
    }
    const beds = new Map<string, Bed>();
    for (const [asset, rows] of candidates) {
      if (rows.length !== 1) {
        beds.set(asset, noObservation("ambiguous"));
        continue;
      }
      const sensor = rows[0];
      const device = deviceIndex.get(id(valueOf(sensor, "IDDevice")));
      const value = valueOf(sensor, "ValueBool");
      const timestamp = sensorLastReadingTime(valueOf(sensor, "DhLastEvent"));
      if (
        !device ||
        valueOf(device, "IDAsset") !== asset ||
        valueOf(device, "IDOrganization") !== organizations.get(asset) ||
        typeof value !== "boolean" ||
        timestamp === null ||
        timestamp <= 0 ||
        timestamp > Date.now()
      ) {
        beds.set(asset, noObservation("unavailable"));
        continue;
      }
      beds.set(asset, {
        ...noObservation("available"),
        lastObservedState: value ? "out_of_bed" : "in_bed",
        observedAt: new Date(timestamp).toISOString(),
        source: "admin_sensor",
      });
    }

    // Recheck live Users/Assets authority before returning health data. A role,
    // assignment, organization or page change must not attach old observations.
    const current = await revalidate();
    const fresh = subjects(current);
    if ((current as RecordData).reportAccess !== "allowed") return current;
    const applicable = new Map(
      fresh
        .filter(
          (row) =>
            organizations.get(id(row.id)) === row.organizationId &&
            beds.has(id(row.id)),
        )
        .map((row) => [id(row.id), beds.get(id(row.id))!]),
    );
    return replaceBeds(current, applicable);
  } catch (error) {
    if (error instanceof ApiError && [401, 403, 404].includes(error.status))
      throw error;
    return status("unavailable");
  } finally {
    controller.abort();
  }
}
