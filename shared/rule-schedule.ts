import { DISPLAY_TIME_ZONE } from "./date-time";

export const ruleScheduleLabels: Readonly<Record<string, string>> = {
  TimeStart: "Start time (local)",
  TimeEnd: "End time (local)",
};

const hourMilliseconds = 60 * 60 * 1000;
const dayMilliseconds = 24 * hourMilliseconds;

type TimeParts = [number, number, number, number];

function parseTime(
  value: unknown,
  allowMinutes = false,
): TimeParts | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  const parts = raw.match(
    allowMinutes
      ? /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
      : /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/,
  );
  if (!parts) return undefined;
  const time: TimeParts = [
    Number(parts[1]),
    Number(parts[2]),
    Number(parts[3] ?? "0"),
    Number((parts[4] ?? "").padEnd(3, "0")),
  ];
  return time[0] <= 23 && time[1] <= 59 && time[2] <= 59 ? time : undefined;
}

function formatTime(date: Date, utc: boolean): string {
  const parts = utc
    ? [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    : localTimeParts(date).slice(0, 3);
  const milliseconds = date.getUTCMilliseconds();
  return `${parts.map((part) => String(part).padStart(2, "0")).join(":")}${milliseconds ? `.${String(milliseconds).padStart(3, "0")}` : ""}`;
}

const localFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function localParts(date: Date): Record<string, number> {
  return Object.fromEntries(
    localFormatter
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
}

function localTimeParts(date: Date): TimeParts {
  const parts = localParts(date);
  return [parts.hour, parts.minute, parts.second, date.getUTCMilliseconds()];
}

function timezoneOffset(date: Date): number {
  const parts = localParts(date);
  const localTimestamp = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    date.getUTCMilliseconds(),
  );
  return (date.getTime() - localTimestamp) / 60_000;
}

function utcDayStart(referenceDate: Date): number | undefined {
  const date = new Date(referenceDate.getTime());
  date.setUTCHours(0, 0, 0, 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : undefined;
}

export function utcScheduleDate(
  value: unknown,
  referenceDate: Date,
): Date | undefined {
  const time = parseTime(value);
  const start = utcDayStart(referenceDate);
  if (!time || start === undefined) return undefined;
  const date = new Date(start);
  date.setUTCHours(...time);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function utcTimeToLocal(
  value: unknown,
  referenceDate: Date,
): string | undefined {
  const date = utcScheduleDate(value, referenceDate);
  return date ? formatTime(date, false) : undefined;
}

export function localTimeToUtc(
  value: unknown,
  referenceDate: Date,
  originalUtc?: unknown,
): string | undefined {
  const time = parseTime(value, true);
  const start = utcDayStart(referenceDate);
  if (!time || start === undefined) return undefined;
  const matches = (date: Date) =>
    localTimeParts(date).every((part, index) => part === time[index]);
  const original = utcScheduleDate(originalUtc, referenceDate);
  // A repeated local time must not change an untouched UTC schedule.
  if (original && matches(original)) return formatTime(original, true);

  const offsets = new Set<number>();
  for (let hour = 0; hour <= 24; hour += 1)
    offsets.add(timezoneOffset(new Date(start + hour * hourMilliseconds)));
  offsets.add(timezoneOffset(new Date(start + dayMilliseconds - 1)));
  if (original) offsets.add(timezoneOffset(original));

  const localMilliseconds =
    ((time[0] * 60 + time[1]) * 60 + time[2]) * 1000 + time[3];
  const candidates = new Set<number>();
  // The local date can be yesterday, today or tomorrow within one UTC day.
  for (const day of [-1, 0, 1])
    for (const offset of offsets) {
      const timestamp =
        start + day * dayMilliseconds + localMilliseconds + offset * 60_000;
      if (
        timestamp >= start &&
        timestamp < start + dayMilliseconds &&
        matches(new Date(timestamp))
      )
        candidates.add(timestamp);
    }
  const dates = [...candidates]
    .sort((a, b) => a - b)
    .map((time) => new Date(time));
  const preferred = original
    ? dates.find((date) => timezoneOffset(date) === timezoneOffset(original))
    : undefined;
  const date = preferred ?? dates[0];
  // Reject gaps instead of allowing Date to silently move the entered time.
  return date ? formatTime(date, true) : undefined;
}
