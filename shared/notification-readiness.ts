export const notificationReadinessBatchLimit = 50;
export const pushDeviceLimit = 32;

export type RegistrationReadiness =
  "registered" | "no_registered_device" | "device_limit_exceeded";

export type NotificationReadiness =
  | { userId: string; state: "unavailable" }
  | {
      userId: string;
      state: "available";
      registeredDeviceCount: number;
      notificationReadiness: RegistrationReadiness;
      lastRegistrationAt: string | null;
    };

export function notificationUserId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d{0,18}$/.test(value) ||
    BigInt(value) > 9223372036854775807n
  )
    throw new Error("Invalid notification user ID.");
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Notification readiness is unavailable.");
  return value as Record<string, unknown>;
}

function count(value: unknown): number {
  const number =
    typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)
      ? Number(value)
      : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0)
    throw new Error("Notification readiness is unavailable.");
  return number;
}

function timestamp(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(new Date(value).getTime())
  )
    throw new Error("Notification readiness is unavailable.");
  return value;
}

function readiness(
  value: unknown,
  registrations: number,
): RegistrationReadiness {
  const expected =
    registrations === 0
      ? "no_registered_device"
      : registrations > pushDeviceLimit
        ? "device_limit_exceeded"
        : "registered";
  if (value !== expected)
    throw new Error("Notification readiness is unavailable.");
  return expected;
}

export function normalizeNotificationReadiness(
  value: unknown,
  expectedUserId: string,
): NotificationReadiness {
  const row = object(value);
  if (
    row.Status !== true ||
    row.Error !== "" ||
    notificationUserId(row.user_id) !== expectedUserId
  )
    throw new Error("Notification readiness is unavailable.");
  const registeredDeviceCount = count(row.registered_device_count);
  return {
    userId: expectedUserId,
    state: "available",
    registeredDeviceCount,
    notificationReadiness: readiness(
      row.notification_readiness,
      registeredDeviceCount,
    ),
    lastRegistrationAt: timestamp(row.last_registration_at),
  };
}

export function decodeNotificationReadinessBatch(
  value: unknown,
  userIds: readonly string[],
): NotificationReadiness[] {
  const rows = object(value).data;
  if (!Array.isArray(rows) || rows.length !== userIds.length)
    throw new Error("Notification readiness is unavailable.");
  const expected = new Set(userIds);
  const seen = new Set<string>();
  return rows.map((value) => {
    const row = object(value);
    const userId = notificationUserId(row.userId);
    if (!expected.has(userId) || seen.has(userId))
      throw new Error("Notification readiness is unavailable.");
    seen.add(userId);
    if (row.state === "unavailable") return { userId, state: "unavailable" };
    if (row.state !== "available")
      throw new Error("Notification readiness is unavailable.");
    const registeredDeviceCount = count(row.registeredDeviceCount);
    return {
      userId,
      state: "available",
      registeredDeviceCount,
      notificationReadiness: readiness(
        row.notificationReadiness,
        registeredDeviceCount,
      ),
      lastRegistrationAt: timestamp(row.lastRegistrationAt),
    };
  });
}
