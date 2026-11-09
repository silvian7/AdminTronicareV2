import {
  decodeQuarantinedMessage,
  decodeQuarantinedMessages,
  quarantineDestinations,
  quarantineStates,
  type QuarantineDestination,
  type QuarantineFilters,
  type QuarantineState,
} from "../shared/quarantined-messages";
import { ApiError } from "./wire";

export function quarantineQuery(query: Record<string, unknown>) {
  if (
    Object.keys(query).some(
      (key) => !["destination", "state", "cursor"].includes(key),
    )
  )
    throw new ApiError(400, "Choose supported quarantine filters.");
  const result: QuarantineFilters & { cursor?: string } = {};
  if (query.destination !== undefined) {
    if (
      typeof query.destination !== "string" ||
      !quarantineDestinations.includes(
        query.destination as QuarantineDestination,
      )
    )
      throw new ApiError(400, "Choose a quarantine destination.");
    result.destination = query.destination as QuarantineDestination;
  }
  if (query.state !== undefined) {
    if (
      typeof query.state !== "string" ||
      !quarantineStates.includes(query.state as QuarantineState)
    )
      throw new ApiError(400, "Choose a quarantine status.");
    result.state = query.state as QuarantineState;
  }
  if (query.cursor !== undefined) {
    if (
      typeof query.cursor !== "string" ||
      !/^[A-Za-z0-9_-]{1,1024}$/.test(query.cursor)
    )
      throw new ApiError(400, "Refresh the quarantined messages list.");
    result.cursor = query.cursor;
  }
  return result;
}

export function quarantinedMessages(
  input: unknown,
  filters: QuarantineFilters,
) {
  try {
    return decodeQuarantinedMessages(input, filters);
  } catch {
    throw new ApiError(502, "Quarantined messages are unavailable.");
  }
}

export function quarantinedMessage(input: unknown, id: string) {
  try {
    return decodeQuarantinedMessage(input, id);
  } catch {
    throw new ApiError(502, "Quarantined message details are unavailable.");
  }
}
