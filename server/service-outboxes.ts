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

export function pushPartialSuccesses(info: unknown): string | undefined {
  const value = object(info).DeliveryOutcomes;
  if (value === undefined) return undefined;
  const partial = object(value).PartialSuccess;
  if (partial === undefined) return undefined;
  if (typeof partial !== "string" || !/^(0|[1-9]\d*)$/.test(partial))
    throw new ApiError(502, "Push delivery outcomes are unavailable.");
  return partial;
}

export function pushLegacyPartialAcceptances(
  info: unknown,
): string | undefined {
  const outcomes = object(info).DeliveryOutcomes;
  if (outcomes === undefined) return undefined;
  const legacy = object(outcomes).LegacyPartialAcceptance;
  if (legacy === undefined) return undefined;
  const total = pushPartialSuccesses(info);
  if (
    typeof legacy !== "string" ||
    !/^(0|[1-9]\d*)$/.test(legacy) ||
    total === undefined ||
    BigInt(legacy) > BigInt(total)
  )
    throw new ApiError(502, "Push delivery outcomes are unavailable.");
  return legacy;
}
