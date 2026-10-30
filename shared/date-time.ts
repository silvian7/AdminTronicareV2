/** One display timezone for Admin and the caregiver portal; API instants stay UTC. */
export const DISPLAY_TIME_ZONE = "Europe/Brussels";

type DateValue = Date | number | string | null | undefined;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const fixed = { ...options, timeZone: DISPLAY_TIME_ZONE };
  const key = JSON.stringify(fixed);
  let result = formatters.get(key);
  if (!result) {
    result = new Intl.DateTimeFormat("en-GB", fixed);
    // The UI uses a few fixed combinations; keep the cache bounded as well.
    if (formatters.size >= 32) formatters.clear();
    formatters.set(key, result);
  }
  return result;
}

function dateOf(value: DateValue): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const input =
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value;
  const date = input instanceof Date ? input : new Date(input);
  return Number.isFinite(date.getTime()) ? date : null;
}

function displayZone(value: string): string {
  return value.replace(
    /\bGMT\+(0?[12])(?::00)?(?![\d:])/g,
    (_, offset: string) => (Number(offset) === 1 ? "CET" : "CEST"),
  );
}

export function formatDisplayDateTime(
  value: DateValue,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = dateOf(value);
  return date
    ? displayZone(
        formatter({
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          ...options,
          hourCycle: "h23",
          timeZone: DISPLAY_TIME_ZONE,
        }).format(date),
      )
    : "Not available";
}

export function formatDisplayDate(value: DateValue): string {
  const date = dateOf(value);
  return date
    ? formatter({
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: DISPLAY_TIME_ZONE,
      }).format(date)
    : "Not available";
}

export function formatDisplayClock(
  value: DateValue,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = dateOf(value);
  return date
    ? displayZone(
        formatter({
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          ...options,
          hourCycle: "h23",
          timeZone: DISPLAY_TIME_ZONE,
        }).format(date),
      )
    : "Not available";
}

const wallClock = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
  hourCycle: "h23",
  timeZone: DISPLAY_TIME_ZONE,
});

export function toBrusselsDateTimeInput(value: DateValue): string {
  const date = dateOf(value);
  if (!date) return "";
  const parts = Object.fromEntries(
    wallClock.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}`;
}

export function brusselsDateInput(value: DateValue): string {
  return toBrusselsDateTimeInput(value).slice(0, 10);
}

/** Reject DST gaps and edited repeated hours; an unchanged original stays exact. */
export function parseBrusselsDateTimeInput(
  value: string,
  originalUtc?: string,
): string | null {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/,
  );
  if (!match) return null;
  const normalized = `${match[1]}T${match[2]}:${match[3]}:${match[4] ?? "00"}.${(match[5] ?? "").padEnd(3, "0")}`;
  const nominal = Date.parse(`${normalized}Z`);
  if (
    !Number.isFinite(nominal) ||
    new Date(nominal).toISOString() !== `${normalized}Z`
  )
    return null;
  const original = dateOf(originalUtc);
  if (original && toBrusselsDateTimeInput(original) === normalized)
    return original.toISOString();

  const offsets = new Set<number>();
  for (let hour = -36; hour <= 36; hour += 6) {
    const at = nominal + hour * 3_600_000;
    offsets.add(Date.parse(`${toBrusselsDateTimeInput(at)}Z`) - at);
  }
  const candidates = [...offsets]
    .map((offset) => nominal - offset)
    .filter((at) => toBrusselsDateTimeInput(at) === normalized);
  return candidates.length === 1 ? new Date(candidates[0]).toISOString() : null;
}
