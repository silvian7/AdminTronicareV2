import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Skeleton } from "antd";
import {
  format,
  init,
  use,
  type ECharts,
  type EChartsCoreOption,
} from "echarts/core";
import { CustomChart, LineChart } from "echarts/charts";
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { CustomSeriesRenderItem } from "echarts";
import type { CareReportDetail, CareSeries } from "../../shared/care";
import {
  formatDisplayClock,
  formatDisplayDateTime,
} from "../../shared/date-time";
import { useCareSeries } from "./api";
import {
  bedExits,
  bedStateAt,
  bedStateLabel,
  boundSeries,
  nearestSample,
  reportTemperature,
  vendorHrv,
  wrapGraphTooltip,
  type ReportTemperature,
  type VendorHrv,
} from "./report-graph-data";
import "./report-graphs.css";

use([
  LineChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

const colors = {
  in_bed: "#2e7d77",
  out_of_bed: "#b76723",
  unknown: "#c8d1da",
  movement: "#7357a6",
  still: "#b1cbd9",
};
const temperatureColors = [
  "#bd682d",
  "#447a45",
  "#3b7a91",
  "#90603d",
  "#ad4f79",
  "#6666a0",
  "#7a7734",
  "#537675",
];
const clockTime = (value: number) =>
  formatDisplayClock(value, { second: undefined });
const sampleTime = (value: number | string) =>
  formatDisplayDateTime(value, { timeZoneName: "shortOffset" });
const numeric = (value: number | null) =>
  value === null ? "Not available" : String(value);
const movementLabel = (value: boolean | null) =>
  value === null
    ? "Unknown"
    : value
      ? "Movement event flag"
      : "No movement event flag";

const intervalRenderer: CustomSeriesRenderItem = (_params, api) => {
  const left = api.coord([api.value(0), 0.2]);
  const right = api.coord([api.value(1), 0.8]);
  return {
    type: "rect",
    shape: {
      x: left[0],
      y: right[1],
      width: Math.max(0, right[0] - left[0]),
      height: Math.max(0, left[1] - right[1]),
    },
    style: { fill: String(api.visual("color")) },
  };
};

function optionFor(
  data: CareSeries,
  hrv: VendorHrv | null,
  temperature: ReportTemperature,
  chartWidth: () => number,
): EChartsCoreOption {
  const start = Date.parse(data.range.start),
    end = Date.parse(data.range.endExclusive);
  const axes = [0, 1, 2, 3, 4, 5];
  return {
    animation: false,
    grid: [
      { top: 124, height: 94 },
      { top: 295, height: 115 },
      { top: 475, height: 115 },
      { top: 655, height: 115 },
      { top: 835, height: 85 },
      { top: 1015, height: 115 },
    ].map((grid) => ({ ...grid, left: 54, right: 20 })),
    xAxis: axes.map((index) => ({
      type: "time",
      gridIndex: index,
      min: start,
      max: end,
      axisLabel: {
        formatter: clockTime,
        hideOverlap: true,
      },
      axisPointer: { show: true, snap: false },
      splitLine: { show: true, lineStyle: { color: "#edf1f4" } },
    })),
    yAxis: axes.map((index) => ({
      type: "value",
      gridIndex: index,
      ...(index === 2 || index === 5 ? {} : { min: 0 }),
      ...(index === 5 ? { scale: true } : {}),
      ...(index === 0 || index === 4 ? { max: 1, show: false } : {}),
      axisLabel: { color: "#577183" },
      splitLine: {
        show: index === 1 || index === 2 || index === 3 || index === 5,
        lineStyle: { color: "#edf1f4" },
      },
    })),
    axisPointer: {
      link: [{ xAxisIndex: "all" }],
      label: {
        formatter: ({ value }: { value: number }) => sampleTime(value),
      },
    },
    tooltip: {
      trigger: "axis",
      renderMode: "richText",
      confine: true,
      padding: [8, 10],
      textStyle: { fontSize: 12 },
      formatter: (raw: unknown) => {
        const list = Array.isArray(raw) ? raw : [raw];
        const pointer = Number(
          (list[0] as { axisValue?: number } | undefined)?.axisValue,
        );
        if (!Number.isFinite(pointer)) return "";
        const point = data.points[nearestSample(data.points, pointer)];
        const cursor = `Cursor: ${sampleTime(pointer)}\nBed presence at cursor: ${bedStateLabel(bedStateAt(data.bedPresence, pointer))}`;
        const atSample =
          point &&
          Date.parse(point.at) <= pointer &&
          pointer < Date.parse(point.endExclusive);
        let text = point
          ? `${cursor}\nRetained sample: ${sampleTime(point.at)}${atSample ? "" : "\nNearest retained sample; not a reading at the cursor."}\nSample heart rate: ${numeric(point.heartRate)}${point.heartRate === null ? "" : " beats/min"}\nSample respiration: ${numeric(point.breathRate)}${point.breathRate === null ? "" : " breaths/min"}\nSample movement: ${movementLabel(point.movement)}`
          : `${cursor}\nNo retained vital sample available.`;
        if (hrv) {
          const bin = hrv.points[nearestSample(hrv.points, pointer)];
          const inBin =
            Date.parse(bin.at) <= pointer &&
            pointer < Date.parse(bin.endExclusive);
          text += `\nHRV sample: ${sampleTime(bin.at)}\nHRV: ${numeric(bin.value)}${bin.value === null ? "" : " ms"}${inBin ? "" : "\nNearest HRV sample; not a reading at the cursor."}`;
        }
        for (const stream of temperature.streams) {
          if (!stream.points.length) continue;
          const sample = stream.points[nearestSample(stream.points, pointer)];
          text += `\n${stream.label} sample: ${sampleTime(sample.at)}\n${stream.label}: ${numeric(sample.value)}${sample.value === null ? "" : " °C"}${Date.parse(sample.at) === pointer ? "" : "\nNearest bed temperature sample; not a reading at the cursor."}`;
        }
        // Rich-text tooltips do not honor CSS width/overflow. Leave room for
        // their padding, border and shadow, and recalculate after chart resize.
        return wrapGraphTooltip(
          text,
          Math.max(1, Math.min(460, chartWidth() - 48)),
          (line) => format.getTextRect(line, "12px sans-serif").width,
        );
      },
    },
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: axes,
        filterMode: "none",
        start: 0,
        end: 100,
      },
      {
        type: "slider",
        xAxisIndex: axes,
        filterMode: "none",
        top: 16,
        height: 26,
        showDataShadow: false,
        labelFormatter: clockTime,
      },
    ],
    series: [
      {
        name: "Bed presence",
        type: "custom",
        xAxisIndex: 0,
        yAxisIndex: 0,
        renderItem: intervalRenderer,
        clip: true,
        encode: { x: [0, 1] },
        data: data.bedPresence.map((interval) => ({
          value: [
            Date.parse(interval.start),
            Date.parse(interval.endExclusive),
          ],
          itemStyle: { color: colors[interval.state] },
        })),
      },
      {
        name: "Heart rate",
        type: "line",
        xAxisIndex: 1,
        yAxisIndex: 1,
        connectNulls: false,
        smooth: false,
        showSymbol: true,
        symbol: "circle",
        symbolSize: 3,
        itemStyle: { color: "#b85865" },
        lineStyle: { color: "#b85865", width: 1.5 },
        data: data.points.map((point) => [
          Date.parse(point.at),
          point.heartRate,
        ]),
      },
      {
        name: "Respiration",
        type: "line",
        xAxisIndex: 3,
        yAxisIndex: 3,
        connectNulls: false,
        smooth: false,
        showSymbol: true,
        symbol: "circle",
        symbolSize: 3,
        itemStyle: { color: "#307fa0" },
        lineStyle: { color: "#307fa0", width: 1.5 },
        data: data.points.map((point) => [
          Date.parse(point.at),
          point.breathRate,
        ]),
      },
      {
        name: "Movement",
        type: "custom",
        xAxisIndex: 4,
        yAxisIndex: 4,
        renderItem: intervalRenderer,
        clip: true,
        encode: { x: [0, 1] },
        data: data.points.map((point) => ({
          value: [
            Date.parse(point.at),
            Math.min(end, Date.parse(point.endExclusive)),
          ],
          itemStyle: {
            color:
              point.movement === null
                ? colors.unknown
                : point.movement
                  ? colors.movement
                  : colors.still,
          },
        })),
      },
      {
        name: "HRV",
        type: "line",
        xAxisIndex: 2,
        yAxisIndex: 2,
        connectNulls: false,
        smooth: false,
        showSymbol: true,
        symbol: "circle",
        symbolSize: 4,
        itemStyle: { color: "#6c59a6" },
        lineStyle: { color: "#6c59a6", width: 1.5 },
        data: hrv?.line ?? [],
      },
      ...temperature.streams.map((stream, index) => ({
        name: stream.label,
        type: "line" as const,
        xAxisIndex: 5,
        yAxisIndex: 5,
        connectNulls: false,
        smooth: false,
        showSymbol: true,
        symbol: "circle",
        symbolSize: 4,
        itemStyle: { color: temperatureColors[index] },
        lineStyle: { color: temperatureColors[index], width: 1.5 },
        data: stream.line,
      })),
    ],
  };
}

function GraphView({
  data,
  temperature,
}: {
  data: CareSeries;
  temperature: ReportTemperature;
}) {
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const start = Date.parse(data.range.start),
    end = Date.parse(data.range.endExclusive);
  const [visible, setVisible] = useState({ start, end });
  const hrv = useMemo(() => vendorHrv(data), [data]);
  const exits = useMemo(() => bedExits(data.bedPresence), [data]);
  const focusRange = (left: number, right: number) => {
    const width = Math.min(end - start, Math.max(1000, right - left));
    const from = Math.max(start, Math.min(left, end - width));
    const to = from + width;
    chart.current?.dispatchAction({
      type: "dataZoom",
      startValue: from,
      endValue: to,
    });
    setVisible({ start: from, end: to });
  };
  const focusExit = (exit: CareSeries["bedPresence"][number]) => {
    const at = Date.parse(exit.start);
    focusRange(at - 15 * 60_000, Date.parse(exit.endExclusive) + 15 * 60_000);
    if (data.points.length)
      chart.current?.dispatchAction({
        type: "showTip",
        seriesIndex: 1,
        dataIndex: nearestSample(data.points, at),
      });
  };
  useEffect(() => {
    if (!element.current) return;
    const instance = init(element.current, undefined, { renderer: "canvas" });
    chart.current = instance;
    instance.setOption(
      optionFor(data, hrv, temperature, () => instance.getWidth()),
    );
    instance.dispatchAction({
      type: "dataZoom",
      startValue: visible.start,
      endValue: visible.end,
    });
    instance.on("click", (event) => {
      if (event.seriesIndex !== 0) return;
      const interval = data.bedPresence[event.dataIndex];
      if (interval && exits.includes(interval)) focusExit(interval);
    });
    instance.on("datazoom", () => {
      const options = instance.getOption() as {
        dataZoom?: {
          start?: number;
          end?: number;
          startValue?: number;
          endValue?: number;
        }[];
      };
      const zoom = options.dataZoom?.[0];
      if (!zoom) return;
      const left =
        zoom.startValue ?? start + ((end - start) * (zoom.start ?? 0)) / 100;
      const right =
        zoom.endValue ?? start + ((end - start) * (zoom.end ?? 100)) / 100;
      setVisible({ start: Number(left), end: Number(right) });
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      chart.current = null;
      instance.dispose();
    };
  }, [data, start, end, hrv, temperature]);
  return (
    <>
      <p
        className="care-note care-graph-visible-range"
        role="status"
        aria-label="Visible range"
        aria-live="polite"
      >
        Visible range:{" "}
        <time dateTime={new Date(visible.start).toISOString()}>
          {formatDisplayDateTime(visible.start)}
        </time>{" "}
        to{" "}
        <time dateTime={new Date(visible.end).toISOString()}>
          {formatDisplayDateTime(visible.end)}
        </time>
        .
      </p>
      <div className="care-graph-figure care-graph-with-hrv care-graph-with-temperature">
        {[
          "Bed presence",
          "Heart rate",
          "HRV",
          "Respiration",
          "Movement",
          "Bed temperature",
        ].map((title, index) => (
          <h3
            key={title}
            className={`care-graph-panel-title care-graph-panel-${index}`}
          >
            {title}
            <small>
              {
                [
                  "Observed intervals",
                  "beats/min",
                  hrv ? "ms · five-minute samples" : "Not available",
                  "breaths/min",
                  "Status-34 event flag",
                  temperature.availability === "available"
                    ? "°C"
                    : "Not available",
                ][index]
              }
            </small>
          </h3>
        ))}
        <div
          ref={element}
          className="care-report-chart"
          role="img"
          aria-label="Bed presence, heart rate, HRV, respiration, movement and bed temperature over time"
        />
      </div>
      <div className="care-graph-legend" aria-label="Graph legend">
        {[
          [colors.in_bed, "In bed"],
          [colors.out_of_bed, "Out of bed"],
          [colors.unknown, "Unknown / missing"],
          [colors.movement, "Movement event flag"],
          [colors.still, "No movement event flag"],
        ].map(([color, text]) => (
          <span key={text}>
            <i style={{ background: color }} aria-hidden="true" />
            {text}
          </span>
        ))}
        {temperature.streams.map((stream, index) => (
          <span key={stream.id}>
            <i
              style={{ background: temperatureColors[index] }}
              aria-hidden="true"
            />
            {stream.label}
          </span>
        ))}
      </div>
    </>
  );
}

export default function ReportGraphs({
  subjectId,
  report,
}: {
  subjectId: string;
  report: CareReportDetail;
}) {
  const query = useCareSeries(subjectId, report.id);
  const data = useMemo(
    () =>
      !query.isError && !query.isPlaceholderData
        ? boundSeries(query.data?.data, subjectId, report)
        : null,
    [query.data, query.isError, query.isPlaceholderData, subjectId, report],
  );
  const temperature = useMemo(
    () =>
      data
        ? reportTemperature(data)
        : { availability: "unavailable" as const, streams: [] },
    [data],
  );
  return (
    <Card
      className="care-report-graphs"
      role="region"
      aria-label="Report graphs"
    >
      {query.isError ? (
        <Alert
          type="error"
          showIcon
          message={
            query.error.statusCode === 403
              ? "Measurement access denied"
              : query.error.statusCode === 422
                ? "Graphs unavailable for this reporting period"
                : "Graphs unavailable"
          }
          description={
            query.error.statusCode === 422
              ? "Graph data is unavailable for this report. Select another reporting period or retry."
              : query.error.message
          }
          action={
            <Button onClick={() => void query.refetch()}>Retry graphs</Button>
          }
        />
      ) : query.isPending || (query.isFetching && !query.data) ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : !data ? (
        <Alert
          type="error"
          showIcon
          message="Graphs unavailable"
          description="The service did not return a valid series for this asset and report."
        />
      ) : (
        <>
          {data.sampling.limited && (
            <Alert
              type="info"
              showIcon
              message="Reduced sample set"
              description="The service retained extrema, gaps and transitions within the point limit. This is not every source sample."
            />
          )}
          {!(
            data.points.length ||
            data.bedPresence.length ||
            vendorHrv(data) ||
            temperature.availability === "available"
          ) && (
            <Empty description="No observations are available in this range." />
          )}
          <GraphView
            key={`${data.range.start}/${data.range.endExclusive}`}
            data={data}
            temperature={temperature}
          />
          {temperature.availability !== "available" && (
            <p className="care-note care-graph-source-note">
              {temperature.availability === "no_data"
                ? "No bed temperature readings are recorded for this reporting period."
                : temperature.availability === "limited"
                  ? "Bed temperature history exceeds the display limit for this reporting period."
                  : "Bed temperature history is unavailable for this reporting period."}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
