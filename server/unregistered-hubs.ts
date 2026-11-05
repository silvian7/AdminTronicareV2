import { decodeUnregisteredHubs } from "../shared/unregistered-hubs";
import { ApiError } from "./wire";

export function unregisteredHubs(input: unknown) {
  try {
    return decodeUnregisteredHubs(input);
  } catch {
    throw new ApiError(502, "Unregistered hub data is unavailable.");
  }
}
