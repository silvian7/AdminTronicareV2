import { describe, expect, it } from "vitest";
import type { CareReportDetail, CareSeries } from "../shared/care";
import {
  bedExits,
  bedStateAt,
  boundSeries,
  graphRange,
  nearestSample,
  vendorHrv,
} from "../src/care/report-graph-data";

const subjectId = "9223372036854775806";
const report = {
  id: "9223372036854775807",
  subjectId,
  period: {
    start: "2026-10-25T05:00:00.000Z",
    endExclusive: "2026-10-26T05:00:00.000Z",
    timezone: "UTC",
    reportDate: "2026-10-25",
  },
  generatedAt: null,
  quality: {
    status: "completed",
    coverage: null,
    flagInvalid: 0,
    errorCode: 0,
  },
  metrics: [],
  provenance: {
    source: "stored_sleepace_report",
    ingestedAt: null,
    parsedAt: null,
  },
  availableSignals: [],
} satisfies CareReportDetail;
function series(): CareSeries {
  return {
    subjectId,
    reportId: report.id,
    period: { ...report.period },
    range: {
      start: report.period.start,
      endExclusive: report.period.endExclusive,
    },
    sampling: { intervalSeconds: 60, limited: false },
    points: [
      {
        at: "2026-10-25T05:00:00.000Z",
        endExclusive: "2026-10-25T05:01:00.000Z",
        heartRate: 63,
        breathRate: 12,
        movement: false,
      },
      {
        at: "2026-10-25T05:01:00.000Z",
        endExclusive: "2026-10-25T05:02:00.000Z",
        heartRate: null,
        breathRate: null,
        movement: null,
      },
      {
        at: "2026-10-25T05:02:00.000Z",
        endExclusive: "2026-10-25T05:03:00.000Z",
        heartRate: 81,
        breathRate: 0,
        movement: true,
      },
    ],
    bedPresence: [
      {
        start: "2026-10-25T05:00:00.000Z",
        endExclusive: "2026-10-25T05:01:00.000Z",
        state: "in_bed",
      },
      {
        start: "2026-10-25T05:01:00.000Z",
        endExclusive: "2026-10-25T05:02:00.000Z",
        state: "unknown",
      },
      {
        start: "2026-10-25T05:02:00.000Z",
        endExclusive: "2026-10-25T05:03:00.000Z",
        state: "out_of_bed",
      },
    ],
    hrv: [],
    temperature: [],
  };
}

describe("care report graph semantics", () => {
  const withHrv = () => {
    const data = series();
    data.hrvDefinition = {
      label: "Vendor HRV",
      unit: "ms",
      source: "analysis.maxReport.hrvArray",
      intervalSeconds: 300,
      definition: "Vendor five-minute HRV samples in milliseconds; not RMSSD.",
    };
    data.hrv = [
      {
        at: "2026-10-25T05:00:00.000Z",
        endExclusive: "2026-10-25T05:05:00.000Z",
        value: 0,
      },
      {
        at: "2026-10-25T05:05:00.000Z",
        endExclusive: "2026-10-25T05:10:00.000Z",
        value: null,
      },
      {
        at: "2026-10-25T05:10:00.000Z",
        endExclusive: "2026-10-25T05:15:00.000Z",
        value: 42,
      },
    ];
    return data;
  };

  it("keeps vendor HRV zero and missing five-minute bins with their own exact times and units", () => {
    const data = withHrv();
    const hrv = vendorHrv(data)!;
    expect(hrv.points).toBe(data.hrv);
    expect(hrv.line).toEqual([
      [Date.parse(data.hrv[0].at), 0],
      [Date.parse(data.hrv[1].at), null],
      [Date.parse(data.hrv[2].at), 42],
    ]);
    expect(hrv.definition).toMatchObject({
      label: "Vendor HRV",
      unit: "ms",
      intervalSeconds: 300,
    });
    expect(hrv.definition.definition).toContain("not RMSSD");
  });

  it("keeps unsupported HRV metadata unavailable without rejecting the main four series", () => {
    const data = withHrv();
    data.hrvDefinition!.unit = "unknown";
    expect(vendorHrv(data)).toBeNull();
    expect(boundSeries(data, subjectId, report)).toBe(data);
    delete data.hrvDefinition;
    expect(vendorHrv(data)).toBeNull();
    data.hrv = [];
    expect(vendorHrv(data)).toBeNull();
  });

  it("preserves finite negative vendor HRV readings without clamping or inventing a clinical range", () => {
    const data = withHrv();
    data.hrv[0].value = -2;
    const hrv = vendorHrv(data)!;
    expect(hrv.points[0].value).toBe(-2);
    expect(hrv.line[0]).toEqual([Date.parse(data.hrv[0].at), -2]);
  });

  it("rejects oversized, out-of-window and overlapping vendor HRV samples", () => {
    const oversized = withHrv();
    oversized.hrv = Array.from({ length: 289 }, () => oversized.hrv[0]);
    expect(vendorHrv(oversized)).toBeNull();
    const outside = withHrv();
    outside.hrv[0].at = "2026-10-25T04:59:00.000Z";
    expect(vendorHrv(outside)).toBeNull();
    const overlap = withHrv();
    overlap.hrv[1].at = "2026-10-25T05:04:00.000Z";
    expect(vendorHrv(overlap)).toBeNull();
  });

  it("draws an uncovered HRV interval as a gap, without manufacturing a sample", () => {
    const data = withHrv();
    data.hrv.splice(1, 1);
    const hrv = vendorHrv(data)!;
    expect(hrv.points).toHaveLength(2);
    expect(hrv.line).toEqual([
      [Date.parse(data.hrv[0].at), 0],
      [Date.parse(data.hrv[0].endExclusive), null],
      [Date.parse(data.hrv[1].at), 42],
    ]);
    expect(hrv.sampleIndices).toEqual([0, 2]);
  });
  it("preserves null gaps, genuine zero and boolean movement without deriving counts", () => {
    const value = series();
    expect(boundSeries(value, subjectId, report)).toBe(value);
    expect(value.points.map((point) => point.heartRate)).toEqual([
      63,
      null,
      81,
    ]);
    expect(value.points.map((point) => point.breathRate)).toEqual([
      12,
      null,
      0,
    ]);
    expect(value.points.map((point) => point.movement)).toEqual([
      false,
      null,
      true,
    ]);
  });

  it("binds exact int64 subject and report identities, never a neighboring record", () => {
    const value = series();
    expect(boundSeries(value, "9223372036854775805", report)).toBeNull();
    value.reportId = "9223372036854775806";
    expect(boundSeries(value, subjectId, report)).toBeNull();
  });

  it("rejects out-of-period, unordered and overlapping source intervals", () => {
    const outside = series();
    outside.range.endExclusive = "2026-10-27T05:00:00.000Z";
    expect(boundSeries(outside, subjectId, report)).toBeNull();
    const unordered = series();
    unordered.points.reverse();
    expect(boundSeries(unordered, subjectId, report)).toBeNull();
    const overlap = series();
    overlap.bedPresence[1].start = overlap.bedPresence[0].start;
    expect(boundSeries(overlap, subjectId, report)).toBeNull();
  });

  it("never describes an unknown-to-out or initial-out interval as an exit", () => {
    const intervals = series().bedPresence;
    expect(bedExits(intervals)).toEqual([]);
    intervals[1].state = "in_bed";
    expect(bedExits(intervals)).toEqual([intervals[2]]);
    intervals[0].state = "out_of_bed";
    expect(bedExits(intervals)).toEqual([intervals[2]]);
    intervals[2].start = "2026-10-25T05:02:01.000Z";
    expect(bedExits(intervals)).toEqual([]);
  });

  it("uses half-open observed intervals and keeps uncovered time unknown", () => {
    const intervals = series().bedPresence;
    expect(bedStateAt(intervals, Date.parse("2026-10-25T05:00:59.999Z"))).toBe(
      "in_bed",
    );
    expect(bedStateAt(intervals, Date.parse("2026-10-25T05:01:00.000Z"))).toBe(
      "unknown",
    );
    expect(bedStateAt(intervals, Date.parse("2026-10-25T05:03:00.000Z"))).toBe(
      "unknown",
    );
  });

  it("inspects an actual retained sample rather than interpolating a cursor value", () => {
    const points = series().points;
    expect(nearestSample(points, Date.parse("2026-10-25T05:01:10.000Z"))).toBe(
      1,
    );
    expect(
      points[nearestSample(points, Date.parse("2026-10-25T05:01:10.000Z"))]
        .heartRate,
    ).toBeNull();
    expect(nearestSample(points, 0)).toBe(0);
    expect(nearestSample(points, Date.parse(report.period.endExclusive))).toBe(
      2,
    );
  });

  it("converts Brussels range fields to exact UTC wire instants within the report", () => {
    expect(
      graphRange("2026-10-25T06:00:00.001", "2026-10-25T07:00", report.period),
    ).toEqual({
      start: "2026-10-25T05:00:00.001Z",
      end: "2026-10-25T06:00:00.000Z",
      maxPoints: 5000,
    });
    expect(
      graphRange("2026-10-25T06:00", "2026-10-25T06:00", report.period),
    ).toBeNull();
    expect(
      graphRange("2026-10-25T05:59", "2026-10-25T07:00", report.period),
    ).toBeNull();
    expect(
      graphRange("2026-02-30T06:00", "2026-10-25T07:00", report.period),
    ).toBeNull();
  });

  it("preserves either unchanged repeated Brussels hour from the current UTC request", () => {
    const period = { ...report.period, start: "2026-10-24T05:00:00.000Z" };
    for (const start of [
      "2026-10-25T00:30:00.123Z",
      "2026-10-25T01:30:00.123Z",
    ]) {
      const previous = { start, end: "2026-10-25T02:30:00.000Z" };
      expect(
        graphRange(
          "2026-10-25T02:30:00.123",
          "2026-10-25T03:30",
          period,
          previous,
        ),
      ).toEqual({
        ...previous,
        maxPoints: 5000,
      });
      expect(
        graphRange("2026-10-25T02:45", "2026-10-25T03:30", period, previous),
      ).toBeNull();
    }
  });

  it("rejects skipped Brussels times and converts valid summer boundaries", () => {
    const period = {
      ...report.period,
      start: "2026-03-28T05:00:00.000Z",
      endExclusive: "2026-03-29T05:00:00.000Z",
    };
    expect(
      graphRange("2026-03-29T02:30", "2026-03-29T04:00", period),
    ).toBeNull();
    expect(graphRange("2026-03-29T03:30", "2026-03-29T04:00", period)).toEqual({
      start: "2026-03-29T01:30:00.000Z",
      end: "2026-03-29T02:00:00.000Z",
      maxPoints: 5000,
    });
  });
});
