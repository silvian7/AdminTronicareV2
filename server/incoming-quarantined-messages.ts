import {
  decodeIncomingQuarantinedMessage,
  decodeIncomingQuarantinedMessages,
  incomingQuarantineSources,
  type IncomingQuarantineSource,
  type IncomingQuarantineState,
} from "../shared/incoming-quarantined-messages";
import { ApiError } from "./wire";

export function incomingQuarantineQuery(
  query: Record<string, unknown>,
  detail = false,
) {
  const allowed = detail ? ["source"] : ["source", "state", "cursor"];
  if (Object.keys(query).some((key) => !allowed.includes(key)))
    throw new ApiError(400, "Choose supported incoming quarantine filters.");
  if (
    typeof query.source !== "string" ||
    !incomingQuarantineSources.includes(
      query.source as IncomingQuarantineSource,
    )
  )
    throw new ApiError(400, "Choose an incoming quarantine source.");
  const result: {
    source: IncomingQuarantineSource;
    state?: IncomingQuarantineState;
    cursor?: string;
  } = { source: query.source as IncomingQuarantineSource };
  if (query.state !== undefined) {
    const states =
      result.source === "CORE_TELEMETRY"
        ? ["REJECTED", "BLOCKED", "PERMANENT_FAILURE"]
        : ["PERMANENT_FAILURE"];
    if (typeof query.state !== "string" || !states.includes(query.state))
      throw new ApiError(400, "Choose an incoming quarantine status.");
    result.state = query.state as IncomingQuarantineState;
  }
  if (query.cursor !== undefined) {
    if (
      typeof query.cursor !== "string" ||
      !/^[A-Za-z0-9_-]{1,1024}$/.test(query.cursor)
    )
      throw new ApiError(
        400,
        "Refresh the incoming quarantined messages list.",
      );
    result.cursor = query.cursor;
  }
  return result;
}
export const incomingQuarantineService = (source: IncomingQuarantineSource) =>
  source === "CORE_TELEMETRY" ? ("core" as const) : ("mqttbridge" as const);
export const incomingQuarantinePath = (source: IncomingQuarantineSource) =>
  source === "CORE_TELEMETRY"
    ? "/v1/coreadmin/incoming-quarantined-messages"
    : "/v1/mqttbridgeadmin/incoming-quarantined-messages";
export function incomingQuarantinedMessages(
  input: unknown,
  source: IncomingQuarantineSource,
  state?: IncomingQuarantineState,
) {
  try {
    return decodeIncomingQuarantinedMessages(input, source, state);
  } catch {
    throw new ApiError(502, "Incoming quarantined messages are unavailable.");
  }
}
export function incomingQuarantinedMessage(
  input: unknown,
  source: IncomingQuarantineSource,
  id: string,
) {
  try {
    return decodeIncomingQuarantinedMessage(input, source, id);
  } catch {
    throw new ApiError(
      502,
      "Incoming quarantined message details are unavailable.",
    );
  }
}
