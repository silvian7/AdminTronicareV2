import { coreOutboxLabels, type CoreOutbox } from "../shared/core-outboxes";
import { ApiError } from "./wire";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(502, "Core outbox metrics are unavailable.");
  return value as Record<string, unknown>;
}

export function coreOutboxes(info: unknown): CoreOutbox[] {
  const queues = object(object(info).Outboxes);
  return (Object.keys(coreOutboxLabels) as CoreOutbox["destination"][]).map(
    (destination) => {
      const queue = object(queues[destination]);
      const size = queue.Size;
      const latency = queue.Latency_Seconds;
      // Upstream JSON numbers arrive as decimal strings through parseWire.
      if (
        typeof size !== "string" ||
        !/^\d+$/.test(size) ||
        typeof latency !== "string" ||
        !/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(latency) ||
        !Number.isFinite(Number(latency))
      )
        throw new ApiError(502, "Core outbox metrics are unavailable.");
      return { destination, size, latencySeconds: latency };
    },
  );
}
