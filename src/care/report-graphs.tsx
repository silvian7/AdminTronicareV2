import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Skeleton } from "antd";
import { init, use, type ECharts, type EChartsCoreOption } from "echarts/core";
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
  vendorHrv,
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

function optionFor(data: CareSeries, hrv: VendorHrv | null): EChartsCoreOption {
  const start = Date.parse(data.range.start),
    end = Date.parse(data.range.endExclusive);
  const axes = [0, 1, 2, 3, 4];
  return {
    animation: false,
    grid: [
      { top: 124, height: 94 },
      { top: 295, height: 115 },
      { top: 475, height: 115 },
      { top: 655, height: 85 },
      { top: 835, height: 115 },
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
      ...(index === 4 ? {} : { min: 0 }),
      ...(index === 0 || index === 3 ? { max: 1, show: false } : {}),
      axisLabel: { color: "#577183" },
      splitLine: {
        show: index === 1 || index === 2 || index === 4,
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
        return text;
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
        xAxisIndex: 2,
        yAxisIndex: 2,
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
        xAxisIndex: 3,
        yAxisIndex: 3,
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
        xAxisIndex: 4,
        yAxisIndex: 4,
        connectNulls: false,
        smooth: false,
        showSymbol: true,
        symbol: "circle",
        symbolSize: 4,
        itemStyle: { color: "#6c59a6" },
        lineStyle: { color: "#6c59a6", width: 1.5 },
        data: hrv?.line ?? [],
      },
    ],
  };
}

function GraphView({ data }: { data: CareSeries }) {
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
    instance.setOption(optionFor(data, hrv));
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
  }, [data, start, end, hrv]);
  return (
    <>
      <div className="care-graph-toolbar" aria-label="Graph time controls">
        <Button
          onClick={() => {
            const width = (visible.end - visible.start) / 2,
              center = (visible.start + visible.end) / 2;
            focusRange(center - width / 2, center + width / 2);
          }}
        >
          Zoom in
        </Button>
        <Button
          onClick={() => {
            const width = Math.min(
                end - start,
                (visible.end - visible.start) * 2,
              ),
              center = (visible.start + visible.end) / 2;
            focusRange(center - width / 2, center + width / 2);
          }}
        >
          Zoom out
        </Button>
        <Button
          onClick={() =>
            focusRange(
              visible.start - (visible.end - visible.start) / 4,
              visible.end - (visible.end - visible.start) / 4,
            )
          }
        >
          Pan earlier
        </Button>
        <Button
          onClick={() =>
            focusRange(
              visible.start + (visible.end - visible.start) / 4,
              visible.end + (visible.end - visible.start) / 4,
            )
          }
        >
          Pan later
        </Button>
        <Button onClick={() => focusRange(start, end)}>Reset view</Button>
      </div>
      <p
        className="care-note care-graph-visible-range"
        role="status"
        aria-label="Visible range"
        aria-live="polite"
      >
        Visible range:{" "}
        <time dateTime={new Date(visible.start).toISOString()}>
          {sampleTime(visible.start)}
        </time>{" "}
        to{" "}
        <time dateTime={new Date(visible.end).toISOString()}>
          {sampleTime(visible.end)}
        </time>
        .
      </p>
      <div className="care-graph-figure care-graph-with-hrv">
        {["Bed presence", "Heart rate", "Respiration", "Movement", "HRV"].map(
          (title, index) => (
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
                    "breaths/min",
                    "Status-34 event flag",
                    hrv ? "ms · five-minute samples" : "Not available",
                  ][index]
                }
              </small>
            </h3>
          ),
        )}
        <div
          ref={element}
          className="care-report-chart"
          role="img"
          aria-label="Bed presence, heart rate, respiration, movement and HRV over time"
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
      </div>
      <p className="care-note">
        Scroll or pinch to zoom; drag to pan. All visible panels share the same
        time window. Missing readings remain gaps. Movement shows the status-34
        event flag, not a movement count or continuous activity measurement.
      </p>
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
  return (
    <Card
      className="care-report-graphs"
      role="region"
      aria-label="Report graphs"
      title={<h2 className="care-card-heading">Report graphs</h2>}
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
          <p className="care-note">
            {data.points.length} retained samples. Source sampling interval:{" "}
            {data.sampling.intervalSeconds === null
              ? "not recorded"
              : `${data.sampling.intervalSeconds} seconds`}
            . Source window:{" "}
            <time dateTime={data.range.start}>
              {sampleTime(data.range.start)}
            </time>{" "}
            to{" "}
            <time dateTime={data.range.endExclusive}>
              {sampleTime(data.range.endExclusive)}
            </time>{" "}
            (exclusive).
          </p>
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
            vendorHrv(data)
          ) && (
            <Empty description="No observations are available in this range." />
          )}
          <GraphView
            key={`${data.range.start}/${data.range.endExclusive}`}
            data={data}
          />
          <details className="care-graph-source-note">
            <summary>Temperature availability</summary>
            <p className="care-note">
              Temperature is unavailable in this report. A verified temperature
              history source for the reporting period has not been established.
            </p>
          </details>
        </>
      )}
    </Card>
  );
}
