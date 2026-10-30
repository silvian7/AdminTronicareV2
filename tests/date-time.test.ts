import { describe, expect, it } from "vitest";
import {
  brusselsDateInput,
  DISPLAY_TIME_ZONE,
  formatDisplayClock,
  formatDisplayDate,
  formatDisplayDateTime,
  parseBrusselsDateTimeInput,
  toBrusselsDateTimeInput,
} from "../shared/date-time";

describe("Brussels display times", () => {
  it("uses Brussels winter/summer offsets and local calendar dates in 24-hour format", () => {
    expect(DISPLAY_TIME_ZONE).toBe("Europe/Brussels");
    expect(formatDisplayDateTime("2026-10-29T23:30:00Z")).toBe(
      "30/10/2026, 00:30:00",
    );
    expect(formatDisplayDateTime("2026-07-01T18:30:00Z")).toBe(
      "01/07/2026, 20:30:00",
    );
    expect(formatDisplayDate("2026-10-29T23:30:00Z")).toBe("30/10/2026");
    expect(brusselsDateInput("2026-10-29T23:30:00Z")).toBe("2026-10-30");
    expect(formatDisplayClock("2026-07-01T18:30:00Z")).toBe("20:30:00");
    expect(formatDisplayDateTime("2026-10-29T23:30:00")).toBe(
      "30/10/2026, 00:30:00",
    );
  });

  it("distinguishes both occurrences of the autumn repeated hour", () => {
    for (const timeZoneName of [
      "short",
      "shortOffset",
      "longOffset",
    ] as const) {
      expect(
        formatDisplayDateTime("2026-10-25T00:30:00Z", { timeZoneName }),
      ).toBe("25/10/2026, 02:30:00 CEST");
      expect(
        formatDisplayDateTime("2026-10-25T01:30:00Z", { timeZoneName }),
      ).toBe("25/10/2026, 02:30:00 CET");
    }
    expect(
      formatDisplayClock("2026-10-25T01:30:00Z", {
        timeZoneName: "shortOffset",
      }),
    ).toBe("02:30:00 CET");
  });

  it("converts entered Brussels wall time to UTC and preserves milliseconds", () => {
    expect(toBrusselsDateTimeInput("2026-07-01T23:30:20.123Z")).toBe(
      "2026-07-02T01:30:20.123",
    );
    expect(parseBrusselsDateTimeInput("2026-07-02T01:30:20.123")).toBe(
      "2026-07-01T23:30:20.123Z",
    );
    expect(parseBrusselsDateTimeInput("2026-01-02T01:30")).toBe(
      "2026-01-02T00:30:00.000Z",
    );
  });

  it("rejects nonexistent or ambiguous edits while preserving untouched DST-fold instants", () => {
    expect(parseBrusselsDateTimeInput("2026-03-29T02:30")).toBeNull();
    expect(parseBrusselsDateTimeInput("2026-10-25T02:30")).toBeNull();
    for (const original of [
      "2026-10-25T00:30:00.123Z",
      "2026-10-25T01:30:00.123Z",
    ])
      expect(
        parseBrusselsDateTimeInput(toBrusselsDateTimeInput(original), original),
      ).toBe(original);
  });

  it("keeps missing and invalid timestamps unavailable", () => {
    for (const value of [null, undefined, "", "invalid"])
      expect(formatDisplayDateTime(value)).toBe("Not available");
    for (const value of ["2026-02-30T12:00", "2026-10-30T25:00", "bad"])
      expect(parseBrusselsDateTimeInput(value)).toBeNull();
    expect(toBrusselsDateTimeInput("bad")).toBe("");
  });
});
