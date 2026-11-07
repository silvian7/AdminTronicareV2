export const hubOnlineHours = [24, 48, 168] as const;
export type HubOnlineHours = (typeof hubOnlineHours)[number];

export interface HubOnlineBucket {
  start: string;
  end: string;
  receivedCount: string | null;
}

/** Activity is evidence from retained receipts, not a physical connection log. */
export interface HubOnlineResponse {
  hubId: string;
  hours: HubOnlineHours;
  rangeStart: string;
  rangeEnd: string;
  observedAt: string;
  bucketSeconds: 300;
  buckets: HubOnlineBucket[];
  coverage: "retained_only";
  limited: boolean;
  scanLimit: 100000;
  scannedItemCount: number;
}

const invalid = () => new Error("Hub online history is unavailable.");
const object = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw invalid();
  return input as Record<string, unknown>;
};
function integer(value: unknown, maximum: number) {
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value))
    value = Number(value);
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  )
    throw invalid();
  return value;
}
function timestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  )
    throw invalid();
  const at = Date.parse(value);
  if (
    !Number.isFinite(at) ||
    new Date(at).toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    throw invalid();
  return value;
}

export function decodeHubOnline(
  input: unknown,
  expectedHubId?: string,
  expectedHours?: HubOnlineHours,
): HubOnlineResponse {
  const data = object(input);
  const hubId = data.hubId;
  if (
    typeof hubId !== "string" ||
    !/^[1-9]\d{0,18}$/.test(hubId) ||
    BigInt(hubId) > 9223372036854775807n ||
    (expectedHubId !== undefined && hubId !== expectedHubId)
  )
    throw invalid();
  const hours = integer(data.hours, 168) as HubOnlineHours;
  if (
    !hubOnlineHours.includes(hours) ||
    (expectedHours !== undefined && hours !== expectedHours)
  )
    throw invalid();
  const rangeStart = timestamp(data.rangeStart);
  const rangeEnd = timestamp(data.rangeEnd);
  const observedAt = timestamp(data.observedAt);
  const start = Date.parse(rangeStart),
    end = Date.parse(rangeEnd);
  if (
    end - start !== hours * 3_600_000 ||
    Date.parse(observedAt) !== end ||
    integer(data.bucketSeconds, 300) !== 300 ||
    data.coverage !== "retained_only" ||
    typeof data.limited !== "boolean" ||
    integer(data.scanLimit, 100000) !== 100000
  )
    throw invalid();
  const scannedItemCount = integer(data.scannedItemCount, 100000);
  if (!Array.isArray(data.buckets) || data.buckets.length !== hours * 12)
    throw invalid();
  let received = 0;
  let unknown = 0;
  let knownSeen = false;
  const buckets = data.buckets.map((input, index): HubOnlineBucket => {
    const row = object(input);
    const bucketStart = timestamp(row.start),
      bucketEnd = timestamp(row.end);
    if (
      Date.parse(bucketStart) !== start + index * 300_000 ||
      Date.parse(bucketEnd) !== start + (index + 1) * 300_000
    )
      throw invalid();
    const receivedCount = row.receivedCount;
    if (receivedCount === null) {
      if (!data.limited || knownSeen) throw invalid();
      unknown++;
    } else {
      if (
        typeof receivedCount !== "string" ||
        !/^(0|[1-9]\d{0,5})$/.test(receivedCount)
      )
        throw invalid();
      received += integer(receivedCount, 100000);
      knownSeen = true;
    }
    return { start: bucketStart, end: bucketEnd, receivedCount };
  });
  if (
    received > scannedItemCount ||
    (!data.limited && received !== scannedItemCount) ||
    (data.limited && (scannedItemCount !== 100000 || unknown === 0))
  )
    throw invalid();
  return {
    hubId,
    hours,
    rangeStart,
    rangeEnd,
    observedAt,
    bucketSeconds: 300,
    buckets,
    coverage: "retained_only",
    limited: data.limited,
    scanLimit: 100000,
    scannedItemCount,
  };
}
