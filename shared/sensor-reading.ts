/** Admin sensor timestamps: explicit UTC/offset ISO or the legacy UTC form. */
export function sensorLastReadingTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const timestamp = value.replace(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
    "$1-$2-$3T$4:$5:$6Z",
  );
  const parts = timestamp.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!parts) return null;
  const calendar = new Date(`${parts[1]}T${parts[2]}Z`);
  const date = new Date(timestamp);
  if (
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 19) !== `${parts[1]}T${parts[2]}` ||
    !Number.isFinite(date.getTime())
  )
    return null;
  return date.getTime();
}
