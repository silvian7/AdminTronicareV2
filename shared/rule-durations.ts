export const ruleDurationLabels: Readonly<Record<string, string>> = {
  ValueDuree: "Duration (seconds)",
  ResetDelayMs: "Reset delay (seconds)",
};

export function millisecondsToSeconds(value: unknown): string | undefined {
  const raw =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" && Number.isSafeInteger(value)
        ? String(value)
        : "";
  if (!/^-?\d+$/.test(raw)) return undefined;
  const milliseconds = BigInt(raw);
  const negative = milliseconds < 0n;
  const absolute = negative ? -milliseconds : milliseconds;
  const fraction = (absolute % 1000n)
    .toString()
    .padStart(3, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${absolute / 1000n}${fraction ? `.${fraction}` : ""}`;
}

export function secondsToMilliseconds(value: unknown): string | undefined {
  const numeric = typeof value === "number";
  const raw =
    typeof value === "string"
      ? value.trim()
      : numeric && Number.isFinite(value)
        ? String(value)
        : "";
  const parts = raw.match(/^(-?)(\d*)(?:\.(\d{0,3}))?$/);
  if (!parts || !(parts[2] || parts[3])) return undefined;
  const absolute =
    BigInt(parts[2] || "0") * 1000n + BigInt((parts[3] ?? "").padEnd(3, "0"));
  // Numbers cannot retain arbitrary millisecond precision; exact large values
  // must be supplied as strings. Field-specific bounds are checked by callers.
  if (numeric && absolute > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return (parts[1] === "-" ? -absolute : absolute).toString();
}
