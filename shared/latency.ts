export function formatLatency(value?: string): string {
  const parts = value?.trim().match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!parts || !Number.isFinite(Number(value))) return "—";

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
  return [seconds / 3600n, (seconds / 60n) % 60n, seconds % 60n]
    .map((part) => part.toString().padStart(2, "0"))
    .join(":");
}
