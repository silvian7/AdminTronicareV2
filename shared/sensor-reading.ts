const temperatureKinds = new Set([
  "temp",
  "temperature",
  "tempbase",
  "bedtemp",
  "bedtempmax",
  "bed_temperature",
  "in100temp",
]);
const temperatureFormat = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  useGrouping: false,
});

/** Format known temperature readings for display; retain the original wire value. */
export function sensorRealDisplay(
  value: unknown,
  hardwareType: unknown,
): unknown {
  if (
    typeof hardwareType !== "string" ||
    !temperatureKinds.has(hardwareType.trim().toLowerCase()) ||
    (typeof value !== "number" &&
      (typeof value !== "string" ||
        !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)))
  )
    return value;
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  const formatted = temperatureFormat.format(number);
  return formatted === "-0.0" ? "0.0" : formatted;
}

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
