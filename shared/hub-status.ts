export function hubLastEventTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const timestamp = value
    .trim()
    .replace(
      /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})?$/,
      (_, year, month, day, hour, minute, second, millisecond) =>
        `${year}-${month}-${day}T${hour}:${minute}:${second}${millisecond ? `.${millisecond}` : ""}Z`,
    );
  const parts = timestamp.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/,
  );
  if (!parts || parts[1].startsWith("0000-")) return null;
  const wallClock = `${parts[1]}T${parts[2]}${parts[3] ?? ""}`;
  const calendar = new Date(`${wallClock}Z`);
  if (
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 19) !== `${parts[1]}T${parts[2]}`
  )
    return null;
  const instant = Date.parse(`${wallClock}${parts[4] ?? "Z"}`);
  return Number.isFinite(instant) ? instant : null;
}
