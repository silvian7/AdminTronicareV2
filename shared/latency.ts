function parseDuration(value: unknown) {
  const raw =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "";
  const parts = raw.match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!parts || !Number.isFinite(Number(raw))) return undefined;

  // Truncate fractional seconds without rounding exact decimal strings.
  const digits = parts[1] + (parts[2] ?? "");
  const point = parts[1].length + Number(parts[3] ?? 0);
  const seconds =
    point <= 0 || /^0+$/.test(digits)
      ? 0n
      : BigInt(
          point < digits.length
            ? digits.slice(0, point)
            : digits + "0".repeat(point - digits.length),
        );
  return {
    seconds,
    hasFraction:
      point < digits.length && /[1-9]/.test(digits.slice(Math.max(point, 0))),
  };
}

export function exceedsTenMinutes(value: unknown): boolean {
  const duration = parseDuration(value);
  return (
    !!duration &&
    (duration.seconds > 600n ||
      (duration.seconds === 600n && duration.hasFraction))
  );
}

export function formatLatency(value?: unknown): string {
  const duration = parseDuration(value);
  if (!duration) return "—";
  const { seconds } = duration;
  return [seconds / 3600n, (seconds / 60n) % 60n, seconds % 60n]
    .map((part) => part.toString().padStart(2, "0"))
    .join(":");
}
