export const incomingQuarantineSources = [
  "CORE_TELEMETRY",
  "MQTT_INGRESS",
  "BRIDGE_CORE_DELIVERY",
  "BRIDGE_CORE_DELIVERY_ITEM",
] as const;
export type IncomingQuarantineSource =
  (typeof incomingQuarantineSources)[number];
export type IncomingQuarantineState =
  "REJECTED" | "BLOCKED" | "PERMANENT_FAILURE";
export const incomingAttemptOutcomes = [
  "RUNNING",
  "PARSED",
  "NO_OUTPUT",
  "RETRY_WAIT",
  "PERMANENT_FAILURE",
  "LEASE_EXPIRED",
  "LEASE_LOST",
  "PROCESSED",
  "DISCARDED",
  "REJECTED",
  "BLOCKED",
  "RETRY_SCHEDULED",
  "SUCCEEDED",
] as const;
export interface IncomingQuarantinedMessage {
  id: string;
  source: IncomingQuarantineSource;
  state: IncomingQuarantineState;
  createdAt: string;
  quarantinedAt: string;
  updatedAt: string;
  attemptCount: number;
  outcomeCode: string | null;
  errorCode: string | null;
  parentId: string | null;
  itemCount: number | null;
  parserFamily: string | null;
  disposition: "ACTIVE" | "SHADOW" | null;
  route: "PRIMARY" | "MIRROR" | "PRIMARY_AND_MIRROR" | null;
}
export interface IncomingQuarantineAttempt {
  attemptNumber: number;
  startedAt: string;
  completedAt: string | null;
  outcome: (typeof incomingAttemptOutcomes)[number];
  outcomeCode: string | null;
  errorCode: string | null;
  protocolStatus: number | null;
  durationMs: number | null;
  component: "PARSER" | "CORE_PROCESSING" | "CORE_PRIMARY" | "CORE_MIRROR";
}
export interface IncomingQuarantinedMessagesResponse {
  source: IncomingQuarantineSource;
  data: IncomingQuarantinedMessage[];
  limit: 50;
  hasMore: boolean;
  nextCursor: string | null;
  observedAt: string;
  payloadAvailable: false;
  scanLimit: 100000;
  scannedRowCount: number;
  scanLimited: boolean;
}
export interface IncomingQuarantinedMessageDetail {
  source: IncomingQuarantineSource;
  message: IncomingQuarantinedMessage & { version: number };
  attempts: IncomingQuarantineAttempt[];
  attemptLimit: 100;
  attemptsHasMore: boolean;
  observedAt: string;
  payloadAvailable: false;
}

const invalid = (): never => {
  throw new Error("Incoming quarantined messages are unavailable.");
};
const object = (input: unknown): Record<string, unknown> =>
  input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : invalid();
const bool = (input: unknown) =>
  typeof input === "boolean" ? input : invalid();
const integer = (input: unknown, max = 2_147_483_647): number => {
  if (typeof input === "string" && /^(0|[1-9]\d*)$/.test(input))
    input = Number(input);
  return typeof input === "number" &&
    Number.isSafeInteger(input) &&
    input >= 0 &&
    input <= max
    ? input
    : invalid();
};
const identifier = (input: unknown): string =>
  typeof input === "string" &&
  /^[1-9]\d{0,18}$/.test(input) &&
  BigInt(input) <= 9_223_372_036_854_775_807n
    ? input
    : invalid();
const timestamp = (input: unknown): string => {
  if (
    typeof input !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input)
  )
    return invalid();
  const at = Date.parse(input);
  return Number.isFinite(at) && new Date(at).toISOString() === input
    ? input
    : invalid();
};
const code = (input: unknown): string | null =>
  input === null
    ? null
    : typeof input === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(input)
      ? input
      : invalid();
const choice = <T extends string>(input: unknown, values: readonly T[]): T =>
  typeof input === "string" && values.includes(input as T)
    ? (input as T)
    : invalid();
const source = (input: unknown, expected?: IncomingQuarantineSource) => {
  const value = choice(input, incomingQuarantineSources);
  if (expected !== undefined && value !== expected) invalid();
  return value;
};
function message(
  input: unknown,
  expected: IncomingQuarantineSource,
  observedAt: string,
): IncomingQuarantinedMessage {
  const row = object(input);
  const createdAt = timestamp(row.createdAt),
    quarantinedAt = timestamp(row.quarantinedAt),
    updatedAt = timestamp(row.updatedAt);
  if (
    createdAt > quarantinedAt ||
    quarantinedAt > updatedAt ||
    updatedAt > observedAt
  )
    invalid();
  return {
    id: identifier(row.id),
    source: source(row.source, expected),
    state: choice(
      row.state,
      expected === "CORE_TELEMETRY"
        ? ["REJECTED", "BLOCKED", "PERMANENT_FAILURE"]
        : ["PERMANENT_FAILURE"],
    ),
    createdAt,
    quarantinedAt,
    updatedAt,
    attemptCount: integer(row.attemptCount),
    outcomeCode: code(row.outcomeCode),
    errorCode: code(row.errorCode),
    parentId: row.parentId === null ? null : identifier(row.parentId),
    itemCount: row.itemCount === null ? null : integer(row.itemCount),
    parserFamily: code(row.parserFamily),
    disposition:
      row.disposition === null
        ? null
        : choice(row.disposition, ["ACTIVE", "SHADOW"] as const),
    route:
      row.route === null
        ? null
        : choice(row.route, [
            "PRIMARY",
            "MIRROR",
            "PRIMARY_AND_MIRROR",
          ] as const),
  };
}
export function decodeIncomingQuarantinedMessages(
  input: unknown,
  expectedSource?: IncomingQuarantineSource,
  expectedState?: IncomingQuarantineState,
): IncomingQuarantinedMessagesResponse {
  const value = object(input),
    family = source(value.source, expectedSource),
    observedAt = timestamp(value.observedAt);
  if (
    !Array.isArray(value.data) ||
    value.data.length > 50 ||
    value.payloadAvailable !== false
  )
    invalid();
  const data = Array.from(value.data as unknown[], (row) =>
    message(row, family, observedAt),
  );
  const ids = new Set<string>();
  for (const [index, row] of data.entries()) {
    if (
      ids.has(row.id) ||
      (expectedState !== undefined && row.state !== expectedState) ||
      (index > 0 && BigInt(data[index - 1].id) <= BigInt(row.id))
    )
      invalid();
    ids.add(row.id);
  }
  const hasMore = bool(value.hasMore),
    scanLimited = bool(value.scanLimited),
    scannedRowCount = integer(value.scannedRowCount, 100_000);
  if (
    integer(value.limit, 50) !== 50 ||
    integer(value.scanLimit, 100_000) !== 100_000 ||
    scannedRowCount < data.length ||
    (scanLimited && (scannedRowCount !== 100_000 || !hasMore)) ||
    (hasMore && data.length < 50 && !scanLimited) ||
    (!hasMore && value.nextCursor !== null)
  )
    invalid();
  let nextCursor: string | null = null;
  if (hasMore) {
    if (
      typeof value.nextCursor !== "string" ||
      !/^[A-Za-z0-9_-]{1,1024}$/.test(value.nextCursor)
    )
      return invalid();
    nextCursor = value.nextCursor;
  }
  return {
    source: family,
    data,
    limit: 50,
    hasMore,
    nextCursor,
    observedAt,
    payloadAvailable: false,
    scanLimit: 100000,
    scannedRowCount,
    scanLimited,
  };
}
export function decodeIncomingQuarantinedMessage(
  input: unknown,
  expectedSource?: IncomingQuarantineSource,
  expectedId?: string,
): IncomingQuarantinedMessageDetail {
  const value = object(input),
    family = source(value.source, expectedSource),
    observedAt = timestamp(value.observedAt),
    raw = object(value.message);
  const row = message(raw, family, observedAt);
  if (
    (expectedId !== undefined && row.id !== expectedId) ||
    value.payloadAvailable !== false ||
    !Array.isArray(value.attempts) ||
    value.attempts.length > 100
  )
    invalid();
  const identities = new Set<string>();
  let previousAt = observedAt;
  const attempts = Array.from(
    value.attempts as unknown[],
    (input): IncomingQuarantineAttempt => {
      const attempt = object(input),
        attemptNumber = integer(attempt.attemptNumber),
        startedAt = timestamp(attempt.startedAt),
        completedAt =
          attempt.completedAt === null ? null : timestamp(attempt.completedAt);
      const component = choice(attempt.component, [
        "PARSER",
        "CORE_PROCESSING",
        "CORE_PRIMARY",
        "CORE_MIRROR",
      ]);
      const outcome = choice(attempt.outcome, incomingAttemptOutcomes),
        identity = `${component}:${attemptNumber}`;
      if (
        attemptNumber === 0 ||
        identities.has(identity) ||
        startedAt > previousAt ||
        (completedAt !== null &&
          (completedAt < startedAt || completedAt > observedAt)) ||
        (outcome === "RUNNING") !== (completedAt === null)
      )
        invalid();
      identities.add(identity);
      previousAt = startedAt;
      const protocolStatus =
        attempt.protocolStatus === null
          ? null
          : integer(attempt.protocolStatus, 599);
      if (protocolStatus !== null && protocolStatus < 100) invalid();
      return {
        attemptNumber,
        startedAt,
        completedAt,
        outcome,
        component,
        outcomeCode: code(attempt.outcomeCode),
        errorCode: code(attempt.errorCode),
        protocolStatus,
        durationMs:
          attempt.durationMs === null ? null : integer(attempt.durationMs),
      };
    },
  );
  const attemptsHasMore = bool(value.attemptsHasMore);
  if (
    integer(value.attemptLimit, 100) !== 100 ||
    (attemptsHasMore && attempts.length !== 100)
  )
    invalid();
  return {
    source: family,
    message: { ...row, version: integer(raw.version) },
    attempts,
    attemptLimit: 100,
    attemptsHasMore,
    observedAt,
    payloadAvailable: false,
  };
}
