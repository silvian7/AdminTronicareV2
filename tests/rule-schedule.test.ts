import { afterEach, describe, expect, it } from "vitest";
import {
  localTimeToUtc,
  utcScheduleDate,
  utcTimeToLocal,
} from "../shared/rule-schedule";

const originalTimezone = process.env.TZ;
afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

function reference(instant = "2026-01-15T12:00:00.000Z") {
  return new Date(instant);
}

describe("rule schedule conversion", () => {
  it.each([
    ["Europe/Brussels", "2026-01-15T12:00:00Z", "22:30:45.123", "23:30:45.123"],
    ["Europe/Brussels", "2026-07-15T12:00:00Z", "00:30:00", "02:30:00"],
    ["Europe/Brussels", "2026-01-15T12:00:00Z", "23:00:00", "00:00:00"],
    ["Europe/Brussels", "2026-07-15T12:00:00Z", "23:59:59.999", "01:59:59.999"],
    ["America/New_York", "2026-01-15T02:00:00Z", "00:30:00", "19:30:00"],
    ["America/New_York", "2026-07-15T12:00:00Z", "00:30:00", "20:30:00"],
    ["Asia/Kolkata", "2026-01-15T12:00:00Z", "23:45:00", "05:15:00"],
    ["Asia/Kolkata", "2026-07-15T12:00:00Z", "00:00:00.010", "05:30:00.010"],
  ])("roundtrips %s schedule %s / %s", (timezone, day, utc, local) => {
    process.env.TZ = timezone;
    const date = reference(day);
    expect(utcTimeToLocal(utc, date)).toBe(local);
    expect(localTimeToUtc(local, date, utc)).toBe(utc);
    expect(localTimeToUtc(local, date)).toBe(utc);
  });

  it("anchors the UTC calendar date without modifying the reference date", () => {
    process.env.TZ = "America/New_York";
    const date = reference("2026-01-15T02:00:00.123Z");
    const instant = date.toISOString();
    expect(utcScheduleDate("23:59:59.5", date)?.toISOString()).toBe(
      "2026-01-15T23:59:59.500Z",
    );
    expect(utcTimeToLocal("00:30:00", date)).toBe("19:30:00");
    expect(localTimeToUtc("19:30", date)).toBe("00:30:00");
    expect(date.toISOString()).toBe(instant);
  });

  it("normalizes supported local input precision without rounding", () => {
    process.env.TZ = "UTC";
    for (const [local, utc] of [
      ["00:00", "00:00:00"],
      ["12:34", "12:34:00"],
      ["12:34:56.0", "12:34:56"],
      ["12:34:56.1", "12:34:56.100"],
      ["12:34:56.01", "12:34:56.010"],
      ["12:34:56.123", "12:34:56.123"],
      [" 12:34:56.123 ", "12:34:56.123"],
    ]) {
      expect(localTimeToUtc(local, reference())).toBe(utc);
      expect(utcTimeToLocal(utc, reference())).toBe(utc);
    }
  });

  it("uses the offset at the scheduled UTC instant on the spring transition day", () => {
    process.env.TZ = "Europe/Brussels";
    const day = reference("2026-03-29T12:00:00Z");
    expect(utcTimeToLocal("00:30:00", day)).toBe("01:30:00");
    expect(utcTimeToLocal("02:30:00", day)).toBe("04:30:00");
    expect(localTimeToUtc("01:30", day)).toBe("00:30:00");
    expect(localTimeToUtc("04:30", day)).toBe("02:30:00");
    expect(localTimeToUtc("02:30", day)).toBeUndefined();
    expect(localTimeToUtc("02:30:00.123", day, "00:30:00.123")).toBeUndefined();
  });

  it("rejects New York's spring gap and preserves valid midnight rollover", () => {
    process.env.TZ = "America/New_York";
    const day = reference("2026-03-08T12:00:00Z");
    expect(localTimeToUtc("02:30", day)).toBeUndefined();
    expect(localTimeToUtc("01:30", day)).toBe("06:30:00");
    expect(localTimeToUtc("03:30", day)).toBe("07:30:00");
    expect(localTimeToUtc("19:30", day)).toBe("00:30:00");
  });

  it("preserves either original instant when an autumn local time is repeated", () => {
    process.env.TZ = "Europe/Brussels";
    const day = reference("2026-10-25T12:00:00Z");
    expect(utcTimeToLocal("00:30:00", day)).toBe("02:30:00");
    expect(utcTimeToLocal("01:30:00", day)).toBe("02:30:00");
    expect(localTimeToUtc("02:30", day, "00:30:00.000")).toBe("00:30:00");
    expect(localTimeToUtc("02:30", day, "01:30:00")).toBe("01:30:00");
    expect(localTimeToUtc("02:30:00.123", day, "01:30:00.123")).toBe(
      "01:30:00.123",
    );
  });

  it("prefers the original offset for changed ambiguous input, otherwise the earlier instant", () => {
    process.env.TZ = "Europe/Brussels";
    const day = reference("2026-10-25T12:00:00Z");
    expect(localTimeToUtc("02:45", day, "00:30:00")).toBe("00:45:00");
    expect(localTimeToUtc("02:45", day, "01:30:00")).toBe("01:45:00");
    expect(localTimeToUtc("02:45", day)).toBe("00:45:00");
    expect(localTimeToUtc("02:45", day, "invalid")).toBe("00:45:00");
    // This local time exists, but not anywhere in the selected UTC day.
    expect(localTimeToUtc("01:30", day)).toBeUndefined();
  });

  it("handles New York's repeated local times and UTC-date anchoring", () => {
    process.env.TZ = "America/New_York";
    const day = reference("2026-11-01T12:00:00Z");
    expect(localTimeToUtc("01:30", day, "05:30:00")).toBe("05:30:00");
    expect(localTimeToUtc("01:30", day, "06:30:00")).toBe("06:30:00");
    expect(localTimeToUtc("01:45", day, "06:30:00")).toBe("06:45:00");
    expect(localTimeToUtc("01:45", day)).toBe("05:45:00");
    expect(localTimeToUtc("19:30", day)).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    "",
    " ",
    0,
    true,
    {},
    "24:00:00",
    "12:60:00",
    "12:00:60",
    "12:34:56.1234",
    "12:34:56.",
    "1:00:00",
    "12:3:00",
    "12:00:00Z",
    "2026-01-15T12:00:00",
  ])("rejects missing or malformed time %s", (value) => {
    process.env.TZ = "Europe/Brussels";
    expect(utcScheduleDate(value, reference())).toBeUndefined();
    expect(utcTimeToLocal(value, reference())).toBeUndefined();
    expect(localTimeToUtc(value, reference())).toBeUndefined();
  });

  it("accepts minute precision only for local form input", () => {
    process.env.TZ = "Europe/Brussels";
    expect(utcScheduleDate("12:30", reference())).toBeUndefined();
    expect(utcTimeToLocal("12:30", reference())).toBeUndefined();
    expect(localTimeToUtc("12:30", reference())).toBe("11:30:00");
  });

  it("rejects an invalid reference date", () => {
    const invalid = new Date(NaN);
    expect(utcScheduleDate("12:30:00", invalid)).toBeUndefined();
    expect(utcTimeToLocal("12:30:00", invalid)).toBeUndefined();
    expect(localTimeToUtc("12:30", invalid)).toBeUndefined();
  });
});
