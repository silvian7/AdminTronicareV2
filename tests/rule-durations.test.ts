import { describe, expect, it } from "vitest";
import {
  millisecondsToSeconds,
  secondsToMilliseconds,
} from "../shared/rule-durations";

const exactDurations = [
  ["0", "0"],
  ["1", "0.001"],
  ["10", "0.01"],
  ["100", "0.1"],
  ["999", "0.999"],
  ["1000", "1"],
  ["1001", "1.001"],
  ["1500", "1.5"],
  ["60000", "60"],
  ["604800000", "604800"],
  ["-1", "-0.001"],
  ["-1000", "-1"],
  ["-1500", "-1.5"],
  ["9007199254740991", "9007199254740.991"],
  ["9007199254740993", "9007199254740.993"],
  ["9223372036854775807", "9223372036854775.807"],
  ["-9223372036854775808", "-9223372036854775.808"],
] as const;

describe("rule duration units", () => {
  it.each(exactDurations)(
    "roundtrips %s milliseconds through %s seconds without precision loss",
    (milliseconds, seconds) => {
      expect(millisecondsToSeconds(milliseconds)).toBe(seconds);
      expect(secondsToMilliseconds(seconds)).toBe(milliseconds);
      expect(secondsToMilliseconds(millisecondsToSeconds(milliseconds))).toBe(
        milliseconds,
      );
    },
  );

  it.each([
    [" 0001500 ", "1.5"],
    ["-0001", "-0.001"],
    ["-0", "0"],
    [0, "0"],
    [-0, "0"],
    [1500, "1.5"],
    [Number.MAX_SAFE_INTEGER, "9007199254740.991"],
    [Number.MIN_SAFE_INTEGER, "-9007199254740.991"],
  ])("normalizes millisecond value %s", (milliseconds, seconds) => {
    expect(millisecondsToSeconds(milliseconds)).toBe(seconds);
  });

  it.each([
    [" 0001.500 ", "1500"],
    ["1.020", "1020"],
    ["1.000", "1000"],
    ["-000.010", "-10"],
    ["-0.000", "0"],
    [".5", "500"],
    [".001", "1"],
    ["-.5", "-500"],
    ["1.", "1000"],
    [0, "0"],
    [-0, "0"],
    [0.001, "1"],
    [0.1, "100"],
    [1.001, "1001"],
    [-1.5, "-1500"],
    [604800, "604800000"],
  ])("normalizes second value %s", (seconds, milliseconds) => {
    expect(secondsToMilliseconds(seconds)).toBe(milliseconds);
  });

  it.each([
    undefined,
    null,
    "",
    " ",
    true,
    false,
    {},
    [],
    1n,
    NaN,
    Infinity,
    -Infinity,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MIN_SAFE_INTEGER - 1,
    "1.5",
    "1e3",
    "+1000",
    "1,000",
    "1000ms",
  ])("rejects invalid or inexact milliseconds %s", (value) => {
    expect(millisecondsToSeconds(value)).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    "",
    " ",
    true,
    false,
    {},
    [],
    1n,
    NaN,
    Infinity,
    -Infinity,
    0.0001,
    1e21,
    9007199254741,
    -9007199254741,
    "1e3",
    "1E-3",
    "+1",
    "1,5",
    "1.0000",
    "0.0001",
    ".",
    "-.",
    "-",
    "1.2.3",
    "1 s",
  ])("rejects unsupported or inexact seconds %s", (value) => {
    expect(secondsToMilliseconds(value)).toBeUndefined();
  });

  it("leaves field bounds to callers instead of clamping values", () => {
    expect(secondsToMilliseconds("604800.001")).toBe("604800001");
    expect(secondsToMilliseconds("9223372036854775.808")).toBe(
      "9223372036854775808",
    );
    expect(millisecondsToSeconds("9223372036854775808")).toBe(
      "9223372036854775.808",
    );
  });
});
