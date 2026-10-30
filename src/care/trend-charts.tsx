import { useEffect, useMemo, useRef } from "react";
import { init, use, type EChartsCoreOption } from "echarts/core";
import { LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { CareMetric, CareTrends } from "../../shared/care";
import { careDate, careDateTime } from "./api";

use([LineChart, ScatterChart, GridComponent, TooltipComponent, CanvasRenderer]);

function Plot({
  option,
  label,
  onPoint,
}: {
  option: EChartsCoreOption;
  label: string;
  onPoint: (index: number) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const handler = useRef(onPoint);
  handler.current = onPoint;
  useEffect(() => {
    if (!element.current) return;
    const chart = init(element.current, undefined, { renderer: "canvas" });
    chart.setOption(option);
    chart.on("click", (raw: unknown) => {
      const point = raw as { componentType?: string; dataIndex?: number };
      if (point.componentType === "series" && Number.isInteger(point.dataIndex))
        handler.current(point.dataIndex!);
    });
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(element.current);
    return () => {
      resize.disconnect();
      chart.dispose();
    };
  }, [option]);
  return (
    <div
      ref={element}
      className="care-trend-chart"
      role="img"
      aria-label={label}
    />
  );
}

export function DailyTrendPlot({
  data,
  metric,
  onReport,
}: {
  data: CareTrends;
  metric: CareMetric;
  onReport: (id: string) => void;
}) {
  const option = useMemo<EChartsCoreOption>(
    () => ({
      animation: false,
      grid: { left: 60, right: 20, top: 25, bottom: 55 },
      xAxis: {
        type: "category",
        data: data.days.map((day) => day.date),
        boundaryGap: false,
        axisLabel: {
          hideOverlap: true,
          formatter: (value: string) => careDate(value),
        },
      },
      yAxis: {
        type: "value",
        min: 0,
        name: metric.unit,
        nameLocation: "end",
        splitLine: { lineStyle: { color: "#edf1f4" } },
      },
      tooltip: {
        trigger: "axis",
        renderMode: "richText",
        confine: true,
        formatter: (raw: unknown) => {
          const points = Array.isArray(raw) ? raw : [raw];
          const index = (points[0] as { dataIndex?: number } | undefined)
            ?.dataIndex;
          const day = index === undefined ? undefined : data.days[index];
          if (!day) return "";
          const value = day.report?.metrics.find(
            (item) => item.key === metric.key,
          )?.value;
          return `${careDate(day.date)} (UTC report date)\n${metric.label}: ${value == null ? "Not available" : `${value} ${metric.unit}`}\n${day.report ? `${careDateTime(day.report.period.start)} → ${careDateTime(day.report.period.endExclusive)} (exclusive)` : day.status === "incomplete" ? "Incomplete report" : "No eligible completed report"}`;
        },
      },
      series: [
        {
          name: metric.label,
          type: "line",
          connectNulls: false,
          smooth: false,
          showSymbol: true,
          symbol: "circle",
          symbolSize: 7,
          itemStyle: { color: "#087f8c" },
          lineStyle: { color: "#087f8c", width: 2 },
          data: data.days.map(
            (day) =>
              day.report?.metrics.find((item) => item.key === metric.key)
                ?.value ?? null,
          ),
        },
      ],
    }),
    [data, metric.key, metric.label, metric.unit],
  );
  return (
    <Plot
      option={option}
      label="Daily report trend"
      onPoint={(index) => {
        const report = data.days[index]?.report;
        if (report) onReport(report.id);
      }}
    />
  );
}

type BreathGroup = NonNullable<CareTrends["breathHistory"]>["groups"][number];
export function BreathHistoryPlot({
  group,
  number,
  onReport,
}: {
  group: BreathGroup;
  number: number;
  onReport: (id: string) => void;
}) {
  const points = useMemo(
    () => group.points.filter((point) => point.value !== null),
    [group],
  );
  const option = useMemo<EChartsCoreOption>(
    () => ({
      animation: false,
      grid: { left: 60, right: 20, top: 25, bottom: 50 },
      xAxis: {
        type: "time",
        min: Date.parse(group.startExclusive),
        max: Date.parse(group.endInclusive),
        axisLabel: {
          hideOverlap: true,
          formatter: (value: number) =>
            careDate(new Date(value).toISOString().slice(0, 10)),
        },
      },
      yAxis: {
        type: "value",
        min: 0,
        minInterval: 1,
        name: "events/report",
        splitLine: { lineStyle: { color: "#edf1f4" } },
      },
      tooltip: {
        trigger: "item",
        renderMode: "richText",
        confine: true,
        formatter: (raw: unknown) => {
          const index = (raw as { dataIndex?: number }).dataIndex;
          const point = index === undefined ? undefined : points[index];
          return point
            ? `${careDate(point.period.reportDate)}\nVendor recorded events: ${point.value} events/report\n${careDateTime(point.period.start)} → ${careDateTime(point.period.endExclusive)} (exclusive)`
            : "";
        },
      },
      series: [
        {
          type: "scatter",
          symbolSize: 9,
          itemStyle: { color: "#7357a6" },
          data: points.map((point) => [
            Date.parse(point.period.start),
            point.value,
          ]),
        },
      ],
    }),
    [group, points],
  );
  return (
    <Plot
      option={option}
      label={`Breathing history source ${number}`}
      onPoint={(index) => {
        const point = points[index];
        if (point) onReport(point.reportId);
      }}
    />
  );
}
