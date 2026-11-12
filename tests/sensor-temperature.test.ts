import { describe, expect, it } from "vitest";
import { sensorRealDisplay } from "../shared/sensor-reading";

describe("temperature reading display", () => {
  it.each([
    ["23.66776547419453", "23.7"],
    ["23", "23.0"],
    ["0", "0.0"],
    ["-0.04", "0.0"],
    ["2.55", "2.6"],
    ["-2.55", "-2.6"],
    ["2.34e1", "23.4"],
  ])("displays %s to one decimal place", (value, expected) => {
    expect(sensorRealDisplay(value, "  BeDtEmPmAx  ")).toBe(expected);
  });

  it.each([
    "temp",
    "temperature",
    "tempbase",
    "bedtemp",
    "bedtempmax",
    "bed_temperature",
    "in100temp",
  ])("recognizes the %s temperature kind", (kind) => {
    expect(sensorRealDisplay("23.667", kind)).toBe("23.7");
  });

  it("preserves exact non-temperature real readings and unknown types", () => {
    const exact = "1234567890.12345678901234567890";
    for (const kind of ["heart", "humidity", "custom_temperature", "", null])
      expect(sensorRealDisplay(exact, kind)).toBe(exact);
  });

  it("preserves absent and invalid values", () => {
    for (const value of [
      null,
      undefined,
      "",
      "invalid",
      "0x10",
      "1e999",
      Infinity,
    ])
      expect(sensorRealDisplay(value, "bedtemp")).toBe(value);
  });
});
