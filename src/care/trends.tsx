import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Select,
  Skeleton,
  Table,
  Tag,
} from "antd";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { CareMetric, CareTrends } from "../../shared/care";
import { translated } from "../../shared/resources";
import {
  careDateOffset,
  careDate,
  careDateTime,
  careSubjectUrl,
  useCareSubject,
  useCareTrends,
  validCareDate,
  validCareId,
} from "./api";
import { BreathHistoryPlot, DailyTrendPlot } from "./trend-charts";
import "./pages.css";
import "./trends.css";

function validTrends(
  data: CareTrends | undefined,
  subjectId: string | undefined,
  startDate: string,
  endDate: string,
): data is CareTrends {
  if (
    !data ||
    data.subjectId !== subjectId ||
    !Array.isArray(data.days) ||
    data.days.length > 31 ||
    data.timezone !== "UTC" ||
    data.startDate !== startDate ||
    data.endDate !== endDate ||
    data.days.length !==
      (Date.parse(endDate) - Date.parse(startDate)) / 86400000 + 1
  )
    return false;
  const dates = new Set<string>(),
    units = new Map<string, string>();
  return data.days.every((day) => {
    if (!day || typeof day !== "object") return false;
    if (
      !validCareDate(day.date) ||
      dates.has(day.date) ||
      day.date < startDate ||
      day.date > endDate
    )
      return false;
    dates.add(day.date);
    if (day.status !== "available")
      return (
        ["incomplete", "unavailable"].includes(day.status) &&
        day.report === null
      );
    const report = day.report;
    if (
      !report ||
      !report.period ||
      report.subjectId !== subjectId ||
      !validCareId(report.id) ||
      report.period.reportDate !== day.date ||
      !Number.isFinite(Date.parse(report.period.start)) ||
      !(
        Date.parse(report.period.start) < Date.parse(report.period.endExclusive)
      ) ||
      !Array.isArray(report.metrics)
    )
      return false;
    return report.metrics.every((metric) => {
      if (
        !metric ||
        typeof metric.key !== "string" ||
        typeof metric.unit !== "string"
      )
        return false;
      if (!(
        metric.value === null ||
        (typeof metric.value === "number" && Number.isFinite(metric.value))
      ))
        return false;
      if (units.has(metric.key) && units.get(metric.key) !== metric.unit)
        return false;
      units.set(metric.key, metric.unit);
      return true;
    });
  });
}

function validBreath(value: CareTrends["breathHistory"]): boolean {
  if (
    !value ||
    value.source !== "daily_report.ahi_count" ||
    value.unit !== "events/report" ||
    value.windowDays !== 28 ||
    value.cutoff !== "exclusive" ||
    !Array.isArray(value.groups) ||
    value.groups.length > 100
  )
    return false;
  let count = 0;
  return value.groups.every((group) => {
    if (!group || typeof group !== "object") return false;
    if (
      !validCareId(group.anchorReportId) ||
      !Array.isArray(group.points) ||
      Date.parse(group.endInclusive) - Date.parse(group.startExclusive) !==
        28 * 86400000
    )
      return false;
    count += group.points.length;
    return (
      count <= 100 &&
      group.points.every(
        (point) =>
          !!point &&
          !!point.period &&
          validCareId(point.reportId) &&
          Date.parse(point.period.start) > Date.parse(group.startExclusive) &&
          Date.parse(point.period.start) <= Date.parse(group.endInclusive) &&
          Date.parse(point.period.start) <
            Date.parse(point.period.endExclusive) &&
          (point.value === null ||
            (Number.isInteger(point.value) && point.value >= 0)),
      )
    );
  });
}

export default function CareTrendsPage() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const end = params.get("endDate") ?? today;
  const safeEnd = validCareDate(end) ? end : today;
  const start = params.get("startDate") ?? undefined;
  const days = params.get("days") === "30" ? 30 : 7;
  const custom = start !== undefined;
  const rangeValid =
    validCareDate(end) &&
    (!custom ||
      (validCareDate(start) &&
        Date.parse(start) <= Date.parse(end) &&
        Date.parse(end) - Date.parse(start) <= 30 * 86400000));
  const [customOpen, setCustomOpen] = useState(custom);
  const [draftStart, setDraftStart] = useState(
    start ?? careDateOffset(today, -6),
  );
  const [draftEnd, setDraftEnd] = useState(end);
  const [rangeError, setRangeError] = useState("");
  const [selectedMetric, setSelectedMetric] = useState("asleep_min");
  useEffect(() => {
    setDraftStart(start ?? careDateOffset(safeEnd, -6));
    setDraftEnd(safeEnd);
    setCustomOpen(custom);
  }, [start, safeEnd, custom]);
  const subjectQuery = useCareSubject(
    validCareId(subjectId) ? subjectId : undefined,
  );
  const subjectResponse =
    !subjectQuery.isError && !subjectQuery.isPlaceholderData
      ? subjectQuery.data
      : undefined;
  const subject =
    subjectResponse && subjectResponse.data?.id === subjectId
      ? subjectResponse.data
      : undefined;
  const allowed =
    !!subject &&
    subjectResponse?.reportsAvailable === true &&
    subjectResponse?.reportAccess !== "denied";
  const query = useCareTrends(
    allowed && rangeValid ? subjectId : undefined,
    custom ? { startDate: start, endDate: end } : { days, endDate: end },
  );
  const expectedStart =
    custom && validCareDate(start) ? start : careDateOffset(safeEnd, -days + 1);
  const data =
    !query.isError &&
    !query.isPlaceholderData &&
    validTrends(query.data?.data, subjectId, expectedStart, safeEnd)
      ? query.data?.data
      : undefined;
  const metrics = useMemo(() => {
    const result = new Map<string, CareMetric>();
    for (const day of data?.days ?? [])
      for (const metric of day.report?.metrics ?? [])
        if (!result.has(metric.key)) result.set(metric.key, metric);
    return [...result.values()];
  }, [data]);
  const metric =
    metrics.find((item) => item.key === selectedMetric) ?? metrics[0];
  const breath =
    data && validBreath(data.breathHistory) ? data.breathHistory : undefined;
  const openReport = (id: string) => navigate(careSubjectUrl(subjectId!, id));
  const choosePreset = (
    count: 7 | 30,
    endDate = validCareDate(end) ? end : today,
  ) => {
    setRangeError("");
    setParams({ days: String(count), endDate });
  };
  const errorView = (message: string, retry: () => void) => (
    <Alert
      type="error"
      showIcon
      message={message}
      action={<Button onClick={retry}>Retry trends</Button>}
    />
  );
  return (
    <div className="care-page care-trends">
      <div className="care-detail-links">
        <Link
          className="care-back-link"
          to={validCareId(subjectId) ? careSubjectUrl(subjectId) : "/care"}
        >
          Back to asset
        </Link>
        <Link to="/care">Overview</Link>
      </div>
      <div className="care-page-heading">
        <div>
          <h1>Historical trends</h1>
          {subject && (
            <p>
              {translated(subject.tag) ||
                translated(subject.label) ||
                `Asset #${subject.id}`}{" "}
              · Asset #{subject.id}
            </p>
          )}
        </div>
        <Button
          disabled={!validCareId(subjectId)}
          loading={subjectQuery.isFetching || query.isFetching}
          onClick={() => {
            if (validCareId(subjectId)) void subjectQuery.refetch();
            if (allowed && rangeValid) void query.refetch();
          }}
        >
          Refresh trends
        </Button>
      </div>
      {!validCareId(subjectId) || !rangeValid ? (
        <Alert
          type="error"
          showIcon
          message="Asset or date range unavailable"
          description="Choose a valid asset and at most 31 report dates."
        />
      ) : subjectQuery.isError ? (
        errorView(subjectQuery.error.message, () => void subjectQuery.refetch())
      ) : !subject ? (
        subjectQuery.isSuccess ? (
          <Alert type="error" message="Asset unavailable" showIcon />
        ) : (
          <Skeleton active />
        )
      ) : subjectResponse?.reportAccess === "denied" ? (
        <Alert
          type="info"
          showIcon
          message="Report access unavailable"
          description="Measurement and report access is not enabled for this account."
        />
      ) : !subjectResponse?.reportsAvailable ? (
        <Alert
          type="warning"
          showIcon
          message="Reports unavailable"
          description="Stored reports are currently unavailable. Refresh to try again."
        />
      ) : (
        <>
          <Card title={<h2 className="care-card-heading">Report dates</h2>}>
            <div className="care-trend-controls">
              <div className="care-trend-presets">
                <Button
                  type={!custom && days === 7 ? "primary" : "default"}
                  aria-pressed={!custom && days === 7}
                  onClick={() => choosePreset(7)}
                >
                  7 days
                </Button>
                <Button
                  type={!custom && days === 30 ? "primary" : "default"}
                  aria-pressed={!custom && days === 30}
                  onClick={() => choosePreset(30)}
                >
                  30 days
                </Button>
                <Button
                  aria-expanded={customOpen}
                  onClick={() => setCustomOpen((value) => !value)}
                >
                  Custom range
                </Button>
              </div>
              {!custom && (
                <label>
                  Trend end date (UTC)
                  <Input
                    aria-label="Trend end date"
                    type="date"
                    value={end}
                    min="1970-01-01"
                    max="9999-12-31"
                    onChange={(event) =>
                      validCareDate(event.target.value) &&
                      choosePreset(days, event.target.value)
                    }
                  />
                </label>
              )}
            </div>
            {customOpen && (
              <form
                className="care-trend-controls"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (
                    !validCareDate(draftStart) ||
                    !validCareDate(draftEnd) ||
                    Date.parse(draftStart) > Date.parse(draftEnd) ||
                    Date.parse(draftEnd) - Date.parse(draftStart) >
                      30 * 86400000
                  ) {
                    setRangeError(
                      "Choose at most 31 dates, with the end on or after the start.",
                    );
                    return;
                  }
                  setRangeError("");
                  setParams({ startDate: draftStart, endDate: draftEnd });
                }}
              >
                <label>
                  Custom start date (UTC)
                  <Input
                    aria-label="Custom start date"
                    type="date"
                    required
                    value={draftStart}
                    onChange={(event) => setDraftStart(event.target.value)}
                  />
                </label>
                <label>
                  Custom end date (UTC)
                  <Input
                    aria-label="Custom end date"
                    type="date"
                    required
                    value={draftEnd}
                    onChange={(event) => setDraftEnd(event.target.value)}
                  />
                </label>
                <Button htmlType="submit">Apply range</Button>
              </form>
            )}
            {rangeError && <Alert type="error" message={rangeError} showIcon />}
            <p className="care-note">
              Each day shows an unambiguous eligible completed report by its
              original UTC report date. Missing, unverified or ambiguous days
              are unavailable; incomplete reports are shown separately. These
              states are not zero. Open a report to inspect its exact period.
            </p>
          </Card>
          {query.isError ? (
            errorView(query.error.message, () => void query.refetch())
          ) : query.isPending ? (
            <Card>
              <Skeleton active paragraph={{ rows: 6 }} />
            </Card>
          ) : !data ? (
            <Alert
              type="error"
              showIcon
              message="Trend data unavailable"
              description="The service did not return consistent report data for this asset."
            />
          ) : (
            <>
              <Card title={<h2 className="care-card-heading">Daily values</h2>}>
                {metric ? (
                  <>
                    <label>
                      Trend metric
                      <Select
                        className="care-trend-metric"
                        aria-label="Trend metric"
                        value={metric.key}
                        options={metrics.map((item) => ({
                          value: item.key,
                          label: `${item.label} (${item.unit})`,
                        }))}
                        onChange={setSelectedMetric}
                      />
                    </label>
                    <h3>
                      {metric.label} <small>({metric.unit})</small>
                    </h3>
                    <DailyTrendPlot
                      data={data}
                      metric={metric}
                      onReport={openReport}
                    />
                    <p className="care-note">
                      Stored daily values; no rolling average or interpolation
                      across missing days. Select a plotted point or use its
                      report link below.
                    </p>
                  </>
                ) : (
                  <Empty description="No eligible completed report values in this date range." />
                )}
                <Table
                  className="care-trend-data"
                  rowKey="date"
                  dataSource={data.days}
                  pagination={false}
                  size="small"
                  columns={[
                    {
                      title: "Report date (UTC)",
                      dataIndex: "date",
                      width: 130,
                      render: (value: string) => careDate(value),
                    },
                    {
                      title: "Availability",
                      key: "status",
                      render: (_, day) => (
                        <Tag
                          color={
                            day.status === "available"
                              ? "success"
                              : day.status === "incomplete"
                                ? "warning"
                                : "default"
                          }
                        >
                          {day.status === "available"
                            ? "Available"
                            : day.status === "incomplete"
                              ? "Incomplete report"
                              : "Unavailable"}
                        </Tag>
                      ),
                    },
                    {
                      title: metric
                        ? `${metric.label} (${metric.unit})`
                        : "Value",
                      key: "value",
                      render: (_, day) => {
                        const value = day.report?.metrics.find(
                          (item) => item.key === metric?.key,
                        )?.value;
                        return value == null
                          ? "Not available"
                          : new Intl.NumberFormat(undefined, {
                              maximumSignificantDigits: 15,
                            }).format(value);
                      },
                    },
                    {
                      title: "Report",
                      key: "report",
                      render: (_, day) =>
                        day.report ? (
                          <Link
                            aria-label={`Open report for ${careDate(day.date)}`}
                            title={`${careDateTime(day.report.period.start)} to ${careDateTime(day.report.period.endExclusive)} (exclusive)`}
                            to={careSubjectUrl(subject.id, day.report.id)}
                          >
                            Open report
                          </Link>
                        ) : (
                          "—"
                        ),
                    },
                  ]}
                />
              </Card>
              <Card
                title={<h2 className="care-card-heading">Breathing history</h2>}
              >
                <p>
                  Vendor recorded apnea/hypopnea events per report. Each
                  separate source uses its latest eligible completed report
                  start and the ingester's exclusive 28-day cutoff,
                  independently of the trend dates selected above.
                </p>
                {!breath ? (
                  <Empty description="Breathing history is unavailable." />
                ) : !breath.groups.length ? (
                  <Empty description="No eligible breathing-history reports are available." />
                ) : (
                  <>
                    {breath.limited && (
                      <Alert
                        type="info"
                        showIcon
                        message="This breathing-history response reached its report limit. Only the returned reports are shown."
                      />
                    )}
                    {breath.groups.map((group, index) => (
                      <section
                        className="care-breath-source"
                        key={group.anchorReportId}
                      >
                        <h3>Source {index + 1}</h3>
                        <p className="care-note">
                          Report starts after{" "}
                          {careDateTime(group.startExclusive)} through{" "}
                          {careDateTime(group.endInclusive)} (inclusive). Counts
                          use events/report; zero is a recorded value.
                        </p>
                        <BreathHistoryPlot
                          group={group}
                          number={index + 1}
                          onReport={openReport}
                        />
                        <details>
                          <summary>
                            Report values for source {index + 1}
                          </summary>
                          <ul className="care-breath-values">
                            {group.points.map((point) => (
                              <li key={point.reportId}>
                                <span>{careDate(point.period.reportDate)}</span>
                                <span>
                                  {point.value === null
                                    ? "Not available"
                                    : `${point.value} events/report`}
                                </span>
                                <Link
                                  aria-label={`Open breathing-history report ${point.reportId}`}
                                  to={careSubjectUrl(
                                    subject.id,
                                    point.reportId,
                                  )}
                                >
                                  Open report
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </section>
                    ))}
                  </>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
