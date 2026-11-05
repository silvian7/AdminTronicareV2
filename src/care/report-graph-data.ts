import type {
  BedState,
  CarePeriod,
  CareReportDetail,
  CareSeries,
} from "../../shared/care";
import { parseBrusselsDateTimeInput } from "../../shared/date-time";

export const bedStateLabel = (state: BedState) =>
  state === "in_bed"
    ? "In bed"
    : state === "out_of_bed"
      ? "Out of bed"
      : "Unknown";

/** Preserve unchanged DST-fold boundaries; edited local times must be unambiguous. */
export function graphRange(
  start: string,
  end: string,
  period: CarePeriod,
  previous = { start: period.start, end: period.endExclusive },
) {
  const from = parseBrusselsDateTimeInput(start, previous.start),
    to = parseBrusselsDateTimeInput(end, previous.end),
    left = from ? Date.parse(from) : NaN,
    right = to ? Date.parse(to) : NaN;
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(right) ||
    !(
      Date.parse(period.start) <= left &&
      left < right &&
      right <= Date.parse(period.endExclusive)
    )
  )
    return null;
  return {
    start: new Date(left).toISOString(),
    end: new Date(right).toISOString(),
    maxPoints: 5000,
  };
}

/** Reject another parent/window rather than ever drawing stale report data. */
export function boundSeries(
  data: CareSeries | undefined,
  subjectId: string,
  report: CareReportDetail,
): CareSeries | null {
  if (
    !data ||
    data.subjectId !== subjectId ||
    data.reportId !== report.id ||
    report.subjectId !== subjectId ||
    !data.period ||
    !data.range ||
    Date.parse(data.period.start) !== Date.parse(report.period.start) ||
    Date.parse(data.period.endExclusive) !==
      Date.parse(report.period.endExclusive)
  )
    return null;
  const start = Date.parse(data.range.start),
    end = Date.parse(data.range.endExclusive);
  if (
    !(
      Date.parse(report.period.start) <= start &&
      start < end &&
      end <= Date.parse(report.period.endExclusive)
    ) ||
    !Array.isArray(data.points) ||
    data.points.length > 5000 ||
    !Array.isArray(data.bedPresence) ||
    data.bedPresence.length > 5000 ||
    !data.sampling ||
    typeof data.sampling.limited !== "boolean" ||
    !(
      data.sampling.intervalSeconds === null ||
      (typeof data.sampling.intervalSeconds === "number" &&
        Number.isFinite(data.sampling.intervalSeconds))
    )
  )
    return null;
  let previous = -Infinity;
  for (const point of data.points) {
    if (!point) return null;
    const at = Date.parse(point.at),
      until = Date.parse(point.endExclusive);
    if (
      !(
        start <= at &&
        at < end &&
        previous < at &&
        at < until &&
        until <= Date.parse(report.period.endExclusive)
      ) ||
      ![point.heartRate, point.breathRate].every(
        (value) =>
          value === null ||
          (typeof value === "number" && Number.isFinite(value)),
      ) ||
      !(point.movement === null || typeof point.movement === "boolean")
    )
      return null;
    previous = at;
  }
  previous = start;
  for (const interval of data.bedPresence) {
    if (!interval) return null;
    const left = Date.parse(interval.start),
      right = Date.parse(interval.endExclusive);
    if (
      !(previous <= left && left < right && right <= end) ||
      !["in_bed", "out_of_bed", "unknown"].includes(interval.state)
    )
      return null;
    previous = right;
  }
  return data;
}

/** Only a contiguous, observed in→out transition is described as an exit. */
export function bedExits(intervals: CareSeries["bedPresence"]) {
  return intervals.filter(
    (interval, index) =>
      interval.state === "out_of_bed" &&
      index > 0 &&
      intervals[index - 1].state === "in_bed" &&
      intervals[index - 1].endExclusive === interval.start,
  );
}

export function bedStateAt(
  intervals: CareSeries["bedPresence"],
  at: number,
): BedState {
  return (
    intervals.find(
      (item) =>
        Date.parse(item.start) <= at && at < Date.parse(item.endExclusive),
    )?.state ?? "unknown"
  );
}

export function nearestSample(points: readonly { at: string }[], at: number) {
  let left = 0,
    right = points.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (Date.parse(points[middle].at) < at) left = middle + 1;
    else right = middle;
  }
  if (left === 0) return 0;
  if (left === points.length) return Math.max(0, left - 1);
  return at - Date.parse(points[left - 1].at) <=
    Date.parse(points[left].at) - at
    ? left - 1
    : left;
}

export interface VendorHrv {
  points: CareSeries["hrv"];
  definition: NonNullable<CareSeries["hrvDefinition"]>;
  line: [number, number | null][];
  sampleIndices: number[];
}

/** HRV is optional: an unsupported vendor contract never invalidates the main series. */
export function vendorHrv(data: CareSeries): VendorHrv | null {
  const definition = data.hrvDefinition;
  if (
    !definition ||
    definition.label !== "Vendor HRV" ||
    definition.unit !== "ms" ||
    definition.source !== "analysis.maxReport.hrvArray" ||
    definition.intervalSeconds !== 300 ||
    typeof definition.definition !== "string" ||
    !definition.definition.trim() ||
    !Array.isArray(data.hrv) ||
    data.hrv.length === 0 ||
    data.hrv.length > 288
  )
    return null;
  const start = Date.parse(data.range.start),
    end = Date.parse(data.range.endExclusive),
    periodEnd = Date.parse(data.period.endExclusive);
  let previousEnd = start;
  const line: VendorHrv["line"] = [],
    sampleIndices: number[] = [];
  for (const point of data.hrv) {
    if (!point) return null;
    const at = Date.parse(point.at),
      until = Date.parse(point.endExclusive);
    if (
      !(
        previousEnd <= at &&
        at < end &&
        at < until &&
        until <= periodEnd &&
        until - at <= 300_000
      ) ||
      !(
        point.value === null ||
        (typeof point.value === "number" && Number.isFinite(point.value))
      )
    )
      return null;
    if (sampleIndices.length > 0 && previousEnd < at)
      line.push([previousEnd, null]);
    sampleIndices.push(line.length);
    line.push([at, point.value]);
    previousEnd = until;
  }
  return { points: data.hrv, definition, line, sampleIndices };
}

export interface ReportTemperatureStream {
  id: string;
  label: string;
  points: { at: string; value: number | null }[];
  line: [number, number | null][];
}

export interface ReportTemperature {
  availability: "available" | "no_data" | "unavailable" | "limited";
  streams: ReportTemperatureStream[];
}

/** Wrap canvas tooltip text without losing labels, timestamps or disclaimers. */
export function wrapGraphTooltip(
  text: string,
  maximumWidth: number,
  measure: (text: string) => number,
): string {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maximumWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      for (const character of word) {
        if (line && measure(line + character) > maximumWidth) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines.join("\n");
}

function temperatureInstant(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value
    ? time
    : null;
}

/** Historical temperature is optional and never supplies a current-value fallback. */
export function reportTemperature(data: CareSeries): ReportTemperature {
  const unavailable = (): ReportTemperature => ({
    availability: "unavailable",
    streams: [],
  });
  const definition = data.temperatureDefinition;
  if (
    !definition ||
    definition.source !== "stored_bedtemp_max" ||
    definition.unit !== "°C" ||
    definition.gapThresholdSeconds !== 120 ||
    !["available", "no_data", "unavailable", "limited"].includes(
      definition.availability,
    )
  )
    return unavailable();
  if (
    definition.availability === "unavailable" ||
    definition.availability === "limited"
  )
    return { availability: definition.availability, streams: [] };
  if (
    !Array.isArray(data.temperatureStreams) ||
    data.temperatureStreams.length > 8
  )
    return unavailable();
  const start = temperatureInstant(data.range.start),
    end = temperatureInstant(data.range.endExclusive),
    periodStart = temperatureInstant(data.period.start),
    periodEnd = temperatureInstant(data.period.endExclusive);
  if (
    start === null ||
    end === null ||
    periodStart === null ||
    periodEnd === null ||
    !(periodStart <= start && start < end && end <= periodEnd)
  )
    return unavailable();
  const ids = new Set<string>();
  const streams: ReportTemperatureStream[] = [];
  let pointCount = 0,
    measured = false;
  for (const [index, stream] of data.temperatureStreams.entries()) {
    const label =
      data.temperatureStreams.length === 1
        ? "Bed temperature"
        : `Bed temperature ${index + 1}`;
    if (
      !stream ||
      typeof stream.id !== "string" ||
      !/^[1-9]\d{0,18}$/.test(stream.id) ||
      BigInt(stream.id) > 9223372036854775807n ||
      ids.has(stream.id) ||
      stream.label !== label ||
      !Array.isArray(stream.points) ||
      stream.points.length > 5000
    )
      return unavailable();
    ids.add(stream.id);
    pointCount += stream.points.length;
    if (pointCount > 10000) return unavailable();
    let previous = -Infinity;
    const line: ReportTemperatureStream["line"] = [];
    for (const point of stream.points) {
      if (!point) return unavailable();
      const at = temperatureInstant(point.at);
      if (
        at === null ||
        !(start <= at && at < end && previous < at) ||
        !(
          point.value === null ||
          (typeof point.value === "number" &&
            Number.isFinite(point.value) &&
            point.value >= -50 &&
            point.value <= 150)
        )
      )
        return unavailable();
      // A null separator breaks the line, without fabricating a reading or interval.
      if (line.length && at - previous >= 120_000) line.push([at, null]);
      line.push([at, point.value]);
      previous = at;
      measured ||= point.value !== null;
    }
    streams.push({ id: stream.id, label, points: stream.points, line });
  }
  if (definition.availability === "no_data")
    return measured ? unavailable() : { availability: "no_data", streams: [] };
  return measured ? { availability: "available", streams } : unavailable();
}
