export const quarantineDestinations = [
  "RULES",
  "ASSETS",
  "MQTT_INFORMATION",
  "EXTERNAL_HISTORY",
] as const;
export const quarantineStates = [
  "AMBIGUOUS",
  "PERMANENT_FAILURE",
  "LOCAL_ONLY",
] as const;
export type QuarantineDestination = (typeof quarantineDestinations)[number];
export type QuarantineState = (typeof quarantineStates)[number];
export interface QuarantineFilters {
  destination?: QuarantineDestination;
  state?: QuarantineState;
}
export interface DeferredQuarantineDelivery {
  state: "PENDING" | "LEASED" | "CONFIRMED" | "NEEDS_REVIEW" | "EXHAUSTED";
  attemptCount: number;
  failureCode: string | null;
  updatedAt: string;
  sourceVersion: number;
  matchesCurrentSource: boolean;
}
export interface QuarantinedMessage {
  id: string;
  messageUuid: string;
  originItemId: string;
  destination: QuarantineDestination;
  state: QuarantineState;
  localOnly: boolean;
  retentionDays: 7 | null;
  createdAt: string;
  quarantinedAt: string;
  updatedAt: string;
  attemptCount: number;
  errorCode: string | null;
  acknowledgedAt: string | null;
  deferredDelivery: DeferredQuarantineDelivery | null;
}
export interface QuarantineAttempt {
  attemptNumber: number;
  startedAt: string;
  completedAt: string | null;
  outcome:
    | "RUNNING"
    | "DELIVERED"
    | "RETRYABLE_FAILURE"
    | "PERMANENT_FAILURE"
    | "AMBIGUOUS"
    | "LEASE_EXPIRED"
    | "LEASE_LOST";
  protocolStatus: number | null;
  durationMs: number | null;
  errorCode: string | null;
}

export function isLocalOnlyHistoryAttempt(
  message: Pick<QuarantinedMessage, "destination">,
  attempt: QuarantineAttempt,
): boolean {
  return (
    message.destination === "EXTERNAL_HISTORY" &&
    attempt.outcome === "PERMANENT_FAILURE" &&
    attempt.errorCode === "HISTORY_TYPE_RETAINED" &&
    attempt.protocolStatus === null
  );
}
export interface QuarantinedMessagesResponse {
  data: QuarantinedMessage[];
  limit: 50;
  hasMore: boolean;
  nextCursor: string | null;
  observedAt: string;
  recoveryDetailsAvailable: boolean;
}
export interface QuarantinedMessageDetail {
  message: QuarantinedMessage & {
    contractVersion: string;
    payloadSha256: string;
    version: number;
  };
  attempts: QuarantineAttempt[];
  attemptLimit: 100;
  attemptsHasMore: boolean;
  observedAt: string;
  recoveryDetailsAvailable: boolean;
}

const invalid = (): never => {
  throw new Error("Quarantined messages are unavailable.");
};
const object = (input: unknown): Record<string, unknown> =>
  input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : invalid();
const bool = (input: unknown): boolean =>
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
const nullableTime = (input: unknown) =>
  input === null ? null : timestamp(input);
const code = (input: unknown): string | null =>
  input === null
    ? null
    : typeof input === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(input)
      ? input
      : invalid();
const choice = <T extends string>(input: unknown, options: readonly T[]): T =>
  typeof input === "string" && options.includes(input as T)
    ? (input as T)
    : invalid();
const cursor = (input: unknown): string =>
  typeof input === "string" && /^[A-Za-z0-9_-]{1,1024}$/.test(input)
    ? input
    : invalid();

function message(
  input: unknown,
  observedAt: string,
  recoveryDetailsAvailable: boolean,
): QuarantinedMessage {
  const row = object(input);
  const createdAt = timestamp(row.createdAt);
  const quarantinedAt = timestamp(row.quarantinedAt);
  const updatedAt = timestamp(row.updatedAt);
  const acknowledgedAt = nullableTime(row.acknowledgedAt);
  if (
    createdAt > quarantinedAt ||
    quarantinedAt > updatedAt ||
    updatedAt > observedAt ||
    (acknowledgedAt !== null && acknowledgedAt > observedAt)
  )
    invalid();
  if (
    typeof row.messageUuid !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      row.messageUuid,
    )
  )
    return invalid();
  let deferredDelivery: DeferredQuarantineDelivery | null = null;
  if (row.deferredDelivery !== null) {
    if (!recoveryDetailsAvailable) invalid();
    const recovery = object(row.deferredDelivery);
    const at = timestamp(recovery.updatedAt);
    if (at > observedAt) invalid();
    deferredDelivery = {
      state: choice(recovery.state, [
        "PENDING",
        "LEASED",
        "CONFIRMED",
        "NEEDS_REVIEW",
        "EXHAUSTED",
      ]),
      attemptCount: integer(recovery.attemptCount),
      failureCode: code(recovery.failureCode),
      updatedAt: at,
      sourceVersion: integer(recovery.sourceVersion),
      matchesCurrentSource: bool(recovery.matchesCurrentSource),
    };
  }
  const destination = choice(row.destination, quarantineDestinations);
  const sourceState = choice(row.state, quarantineStates);
  const errorCode = code(row.errorCode);
  const localOnly =
    destination === "EXTERNAL_HISTORY" &&
    (sourceState === "PERMANENT_FAILURE" || sourceState === "LOCAL_ONLY") &&
    errorCode === "HISTORY_TYPE_RETAINED";
  const hasLocalOnly = Object.hasOwn(row, "localOnly");
  const hasRetentionDays = Object.hasOwn(row, "retentionDays");
  if (
    hasLocalOnly !== hasRetentionDays ||
    (hasLocalOnly && bool(row.localOnly) !== localOnly) ||
    (sourceState === "LOCAL_ONLY" && (!localOnly || !hasLocalOnly))
  )
    invalid();
  const retentionDays =
    !hasRetentionDays || row.retentionDays === null
      ? null
      : integer(row.retentionDays, 7) === 7 && localOnly
        ? 7
        : invalid();
  return {
    id: identifier(row.id),
    messageUuid: row.messageUuid,
    originItemId: identifier(row.originItemId),
    destination,
    state: localOnly ? "LOCAL_ONLY" : sourceState,
    localOnly,
    retentionDays,
    createdAt,
    quarantinedAt,
    updatedAt,
    attemptCount: integer(row.attemptCount),
    errorCode,
    acknowledgedAt,
    deferredDelivery,
  };
}

export function decodeQuarantinedMessages(
  input: unknown,
  filters: QuarantineFilters = {},
): QuarantinedMessagesResponse {
  const value = object(input);
  const observedAt = timestamp(value.observedAt);
  const recoveryDetailsAvailable = bool(value.recoveryDetailsAvailable);
  if (!Array.isArray(value.data) || value.data.length > 50) invalid();
  const sourceRows = value.data as unknown[];
  const data = Array.from(sourceRows, (row) =>
    message(row, observedAt, recoveryDetailsAvailable),
  );
  const ids = new Set<string>();
  for (const [index, row] of data.entries()) {
    if (
      ids.has(row.id) ||
      (filters.destination && filters.destination !== row.destination) ||
      (filters.state &&
        filters.state !== row.state &&
        filters.state !== object(sourceRows[index]).state) ||
      (index > 0 && data[index - 1].quarantinedAt < row.quarantinedAt)
    )
      invalid();
    ids.add(row.id);
  }
  const hasMore = bool(value.hasMore);
  if (
    integer(value.limit, 50) !== 50 ||
    (hasMore && data.length !== 50) ||
    (!hasMore && value.nextCursor !== null)
  )
    invalid();
  return {
    data,
    limit: 50,
    hasMore,
    nextCursor: hasMore ? cursor(value.nextCursor) : null,
    observedAt,
    recoveryDetailsAvailable,
  };
}

export function decodeQuarantinedMessage(
  input: unknown,
  expectedId?: string,
): QuarantinedMessageDetail {
  const value = object(input);
  const observedAt = timestamp(value.observedAt);
  const recoveryDetailsAvailable = bool(value.recoveryDetailsAvailable);
  const source = object(value.message);
  const row = message(source, observedAt, recoveryDetailsAvailable);
  if (expectedId !== undefined && row.id !== expectedId) invalid();
  if (
    typeof source.contractVersion !== "string" ||
    !source.contractVersion.trim() ||
    source.contractVersion.length > 64 ||
    /[\u0000-\u001f\u007f]/.test(source.contractVersion) ||
    typeof source.payloadSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(source.payloadSha256) ||
    !Array.isArray(value.attempts) ||
    value.attempts.length > 100
  )
    return invalid();
  let previous = Infinity;
  const attempts = Array.from(value.attempts, (input): QuarantineAttempt => {
    const attempt = object(input);
    const attemptNumber = integer(attempt.attemptNumber);
    const startedAt = timestamp(attempt.startedAt);
    const completedAt = nullableTime(attempt.completedAt);
    const outcome = choice(attempt.outcome, [
      "RUNNING",
      "DELIVERED",
      "RETRYABLE_FAILURE",
      "PERMANENT_FAILURE",
      "AMBIGUOUS",
      "LEASE_EXPIRED",
      "LEASE_LOST",
    ]);
    if (
      attemptNumber === 0 ||
      attemptNumber >= previous ||
      attemptNumber > row.attemptCount ||
      startedAt > observedAt ||
      (completedAt !== null &&
        (completedAt < startedAt || completedAt > observedAt)) ||
      (outcome === "RUNNING") !== (completedAt === null)
    )
      invalid();
    previous = attemptNumber;
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
      protocolStatus,
      durationMs:
        attempt.durationMs === null ? null : integer(attempt.durationMs),
      errorCode: code(attempt.errorCode),
    };
  });
  const attemptsHasMore = bool(value.attemptsHasMore);
  if (
    integer(value.attemptLimit, 100) !== 100 ||
    (attemptsHasMore && attempts.length !== 100)
  )
    invalid();
  return {
    message: {
      ...row,
      contractVersion: source.contractVersion,
      payloadSha256: source.payloadSha256,
      version: integer(source.version),
    },
    attempts,
    attemptLimit: 100,
    attemptsHasMore,
    observedAt,
    recoveryDetailsAvailable,
  };
}
