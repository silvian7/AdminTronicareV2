import {
  serviceOutboxLabels,
  type OutboxService,
  type ServiceOutbox,
} from "../shared/service-outboxes";
import { ApiError } from "./wire";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(502, "Outbox metrics are unavailable.");
  return value as Record<string, unknown>;
}

export function serviceOutboxes(
  service: OutboxService,
  info: unknown,
): ServiceOutbox[] {
  const queues = object(object(info).Outboxes);
  return Object.keys(serviceOutboxLabels[service]).map((destination) => {
    const queue = object(queues[destination]);
    const size = queue.Size;
    const latency = queue.Latency_Seconds;
    // These services report integer queue sizes and integer-second ages.
    // Keep the decimal strings supplied by parseWire without Number coercion.
    if (
      typeof size !== "string" ||
      !/^\d+$/.test(size) ||
      typeof latency !== "string" ||
      !/^\d+$/.test(latency)
    )
      throw new ApiError(502, "Outbox metrics are unavailable.");
    return { destination, size, latencySeconds: latency };
  });
}
