import {
  normalizeNotificationReadiness,
  notificationReadinessBatchLimit,
  notificationUserId,
  type NotificationReadiness,
} from "../shared/notification-readiness";
import type { createUpstream } from "./upstream";
import { ApiError } from "./wire";

export function readinessUserIds(query: Record<string, unknown>): string[] {
  if (
    Object.keys(query).some((key) => key !== "ids") ||
    typeof query.ids !== "string"
  )
    throw new ApiError(400, "Supply the user IDs to check.");
  const ids = query.ids.split(",");
  if (!ids.length || ids.length > notificationReadinessBatchLimit)
    throw new ApiError(400, "Check at most 50 users at a time.");
  try {
    return [...new Set(ids.map(notificationUserId))];
  } catch {
    throw new ApiError(400, "Check the supplied user IDs.");
  }
}

export async function notificationReadiness(
  userIds: readonly string[],
  token: string,
  upstream: ReturnType<typeof createUpstream>,
): Promise<NotificationReadiness[]> {
  const rows: NotificationReadiness[] = userIds.map((userId) => ({
    userId,
    state: "unavailable",
  }));
  const controller = new AbortController();
  let index = 0;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve();
    }, 10_000);
  });
  async function worker() {
    while (index < userIds.length && !controller.signal.aborted) {
      const selected = index++;
      const userId = userIds[selected];
      try {
        const { data } = await upstream(
          "push",
          `/v1/pushadmin/devices/readiness/${userId}`,
          token,
          { signal: controller.signal },
        );
        const row = normalizeNotificationReadiness(data, userId);
        if (!controller.signal.aborted) rows[selected] = row;
      } catch {
        // Denied, absent, malformed and unavailable rows reveal no device data.
        // A dependency failure never becomes a zero count or expires the BFF session.
      }
    }
  }
  try {
    await Promise.race([
      Promise.all(Array.from({ length: Math.min(4, userIds.length) }, worker)),
      deadline,
    ]);
    return rows.map((row) => ({ ...row }));
  } finally {
    clearTimeout(timer!);
    controller.abort();
  }
}
