export interface UnregisteredHub {
  /** Exact, case-sensitive upstream identity; neither component is trimmed. */
  hubKind: string;
  serialNumber: string;
  firstSeenAt: string;
  lastSeenAt: string;
  rejectionCount: string;
  /** Registration of the HubType; the hub itself remains unregistered. */
  hubTypeStatus: "registered" | "unregistered" | "ambiguous";
}

export interface UnregisteredHubsResponse {
  data: UnregisteredHub[];
  limit: 100;
  hasMore: boolean;
  scanLimit: 10000;
  scannedMessageCount: number;
  messagesLimited: boolean;
  observedAt: string;
}

const unavailable = () => {
  throw new Error("Unregistered hub data is unavailable.");
};

function object(value: unknown, required: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return unavailable();
  const row = value as Record<string, unknown>;
  if (required.some((key) => !Object.hasOwn(row, key))) return unavailable();
  return row;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  const raw =
    typeof value === "number" && Number.isInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value
        : "";
  if (raw.length > String(maximum).length || !/^(?:0|[1-9]\d*)$/.test(raw))
    return unavailable();
  const result = Number(raw);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum)
    return unavailable();
  return result;
}

function identity(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 256 ||
    [...value].length > 128 ||
    /[\u0000-\u001f]/.test(value)
  )
    return unavailable();
  return value;
}

function timestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length !== 24 ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return unavailable();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    return unavailable();
  return value;
}

/** Validate either lossless BFF wire values or normalized browser JSON. */
export function decodeUnregisteredHubs(
  input: unknown,
): UnregisteredHubsResponse {
  const response = object(input, [
    "data",
    "limit",
    "hasMore",
    "scanLimit",
    "scannedMessageCount",
    "messagesLimited",
    "observedAt",
  ]);
  const limit = integer(response.limit, 100, 100);
  const scanLimit = integer(response.scanLimit, 10000, 10000);
  const scannedMessageCount = integer(
    response.scannedMessageCount,
    0,
    scanLimit,
  );
  const observedAt = timestamp(response.observedAt);
  if (
    !Array.isArray(response.data) ||
    response.data.length > limit ||
    typeof response.hasMore !== "boolean" ||
    typeof response.messagesLimited !== "boolean" ||
    (response.hasMore && response.data.length !== limit) ||
    (response.messagesLimited && scannedMessageCount !== scanLimit)
  )
    return unavailable();
  const identities = new Set<string>();
  let returnedMessageCount = 0;
  const data = Array.from(response.data).map((value): UnregisteredHub => {
    const row = object(value, [
      "hubKind",
      "serialNumber",
      "firstSeenAt",
      "lastSeenAt",
      "rejectionCount",
      "hubTypeStatus",
    ]);
    const hubKind = identity(row.hubKind);
    const serialNumber = identity(row.serialNumber);
    const key = JSON.stringify([hubKind, serialNumber]);
    if (identities.has(key)) return unavailable();
    identities.add(key);
    const firstSeenAt = timestamp(row.firstSeenAt);
    const lastSeenAt = timestamp(row.lastSeenAt);
    if (firstSeenAt > lastSeenAt || lastSeenAt > observedAt)
      return unavailable();
    const rejectionCount = integer(row.rejectionCount, 1, scanLimit);
    returnedMessageCount += rejectionCount;
    if (
      !["registered", "unregistered", "ambiguous"].includes(
        row.hubTypeStatus as string,
      )
    )
      return unavailable();
    return {
      hubKind,
      serialNumber,
      firstSeenAt,
      lastSeenAt,
      rejectionCount: String(rejectionCount),
      hubTypeStatus: row.hubTypeStatus as UnregisteredHub["hubTypeStatus"],
    };
  });
  if (returnedMessageCount > scannedMessageCount) return unavailable();
  return {
    data,
    limit: 100,
    hasMore: response.hasMore,
    scanLimit: 10000,
    scannedMessageCount,
    messagesLimited: response.messagesLimited,
    observedAt,
  };
}
