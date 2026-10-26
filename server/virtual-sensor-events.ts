import { ApiError, idValue } from "./wire";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function operationId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value))
    throw new ApiError(400, "Use a valid simulation operation ID.");
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(
      502,
      "The service returned an invalid simulation result.",
    );
  return value as Record<string, unknown>;
}

export function virtualEventBody(value: unknown) {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  if (
    Object.keys(input).length !== 2 ||
    !("operationId" in input) ||
    typeof input.value !== "boolean"
  )
    throw new ApiError(400, "Choose a bed state and simulation operation ID.");
  return { operationId: operationId(input.operationId), value: input.value };
}

export function virtualEventCapability(value: unknown, sensorId: string) {
  const result = object(value);
  if (
    result.sensorId !== sensorId ||
    typeof result.supported !== "boolean" ||
    (result.value !== undefined && typeof result.value !== "boolean")
  )
    throw new ApiError(
      502,
      "The service returned an invalid simulation result.",
    );
  return {
    sensorId,
    supported: result.supported,
    ...(result.value === undefined ? {} : { value: result.value }),
  };
}

function utcDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    /^\d{4}-\d\d-\d\dT/.test(value) &&
    /(?:Z|\+00:00)$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function virtualEventResult(
  value: unknown,
  sensorId: string,
  expectedOperation: string,
  expectedValue?: boolean,
) {
  const result = object(value);
  if (
    result.sensorId !== idValue(sensorId) ||
    result.operationId !== expectedOperation ||
    typeof result.value !== "boolean" ||
    (expectedValue !== undefined && result.value !== expectedValue) ||
    (result.status !== "queued" &&
      result.status !== "accepted" &&
      result.status !== "rejected") ||
    !utcDate(result.eventAt) ||
    (result.acceptedAt !== undefined && !utcDate(result.acceptedAt))
  )
    throw new ApiError(
      502,
      "The service returned an invalid simulation result.",
    );
  return {
    sensorId,
    operationId: expectedOperation,
    value: result.value,
    status: result.status as "queued" | "accepted" | "rejected",
    eventAt: result.eventAt,
    ...(result.acceptedAt === undefined
      ? {}
      : { acceptedAt: result.acceptedAt }),
  };
}
