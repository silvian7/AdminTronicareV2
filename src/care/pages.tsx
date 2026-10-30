import { lazy, Suspense, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Pagination,
  Skeleton,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { CarePeriod, CareReport, CareSubject } from "../../shared/care";
import { translated } from "../../shared/resources";
import { useAdmin } from "../context";
import {
  careDateTime,
  careDisplayTimezone,
  careSubjectUrl,
  useCareReport,
  useCareReports,
  useCareSubject,
  useCareSubjects,
  validCareId,
  validCareDate,
  type CareFailure,
} from "./api";
import "./pages.css";
import { ReportNavigation } from "./report-navigation";
import { BedPictogram } from "../components/bed-pictogram";
import { HubStatus } from "../components/hub-status";
const ReportGraphs = lazy(() => import("./report-graphs"));

function useStatusTime() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return now;
}

const subjectName = (subject: CareSubject) =>
  translated(subject.tag) ||
  translated(subject.label) ||
  `Asset #${subject.id}`;

function knownReport(report: CareReport | null | undefined, subjectId: string) {
  return !!(
    report &&
    validCareId(report.id) &&
    report.subjectId === subjectId &&
    report.period &&
    Number.isFinite(Date.parse(report.period.start)) &&
    Number.isFinite(Date.parse(report.period.endExclusive)) &&
    Date.parse(report.period.start) < Date.parse(report.period.endExclusive) &&
    Array.isArray(report.metrics)
  );
}

function Moment({ value }: { value: string | null | undefined }) {
  return value && Number.isFinite(Date.parse(value)) ? (
    <time dateTime={value}>{careDateTime(value)}</time>
  ) : (
    <span>Not available</span>
  );
}

function Period({ period }: { period: CarePeriod }) {
  return (
    <dl className="care-period">
      <div>
        <dt>Start</dt>
        <dd>
          <Moment value={period.start} />
        </dd>
      </div>
      <div>
        <dt>End (exclusive)</dt>
        <dd>
          <Moment value={period.endExclusive} />
        </dd>
      </div>
    </dl>
  );
}

function BedObservation({ subject }: { subject: CareSubject }) {
  const state = subject.bed?.lastObservedState;
  const availability = subject.bed?.availability;
  const observed =
    (availability === undefined || availability === "available") &&
    !!subject.bed?.observedAt &&
    ["in_bed", "out_of_bed"].includes(state);
  const unavailable =
    availability === "denied"
      ? "Measurement access unavailable."
      : availability === "ambiguous"
        ? "Multiple bed sensors; observation is ambiguous."
        : availability === "limited"
          ? "Bed observation temporarily unavailable."
          : availability === "unavailable"
            ? "Bed observation unavailable."
            : "No bed observation available.";
  return (
    <div className="care-bed-observation">
      {observed ? (
        <>
          <div className="care-bed-reading">
            <BedPictogram state={state as "in_bed" | "out_of_bed"} />
          </div>
          <Typography.Text type="secondary">
            <Moment value={subject.bed.observedAt} />
          </Typography.Text>
        </>
      ) : (
        <Typography.Text type="secondary">{unavailable}</Typography.Text>
      )}
    </div>
  );
}

function LatestReport({
  subject,
  available,
  denied,
}: {
  subject: CareSubject;
  available: boolean;
  denied: boolean;
}) {
  const report = subject.latestReport;
  if (denied)
    return (
      <Typography.Text type="secondary">
        Report access unavailable.
      </Typography.Text>
    );
  if (!available)
    return (
      <Typography.Text type="secondary">Reports unavailable.</Typography.Text>
    );
  if (!report)
    return (
      <Typography.Text type="secondary">
        No eligible completed report.
      </Typography.Text>
    );
  if (!knownReport(report, subject.id))
    return (
      <Typography.Text type="secondary">Report unavailable.</Typography.Text>
    );
  return (
    <div className="care-latest-report">
      <Period period={report.period} />
      <Link
        to={careSubjectUrl(subject.id, report.id)}
        aria-label={`Open completed report for ${subjectName(subject)}`}
      >
        Open report
      </Link>
    </div>
  );
}

function QueryFailure({
  error,
  retry,
  resource,
}: {
  error: CareFailure;
  retry: () => void;
  resource: "Assets" | "Asset" | "Report";
}) {
  return (
    <Alert
      type="error"
      showIcon
      message={
        error.statusCode === 403
          ? "Access denied"
          : resource === "Assets" && error.statusCode === 503
            ? "Caregiver service unavailable"
            : `${resource} unavailable`
      }
      description={error.message || "This view could not be loaded. Try again."}
      action={<Button onClick={retry}>Retry</Button>}
    />
  );
}

function pageNumber(value: string | null, fallback: number, maximum: number) {
  return value && /^[1-9]\d{0,4}$/.test(value) && Number(value) <= maximum
    ? Number(value)
    : fallback;
}

export function CareOverview() {
  const statusNow = useStatusTime();
  const { identity, organization } = useAdmin();
  const [params, setParams] = useSearchParams();
  const search = (params.get("q") ?? "").slice(0, 100);
  const page = pageNumber(params.get("page"), 1, 1000);
  const size = pageNumber(params.get("size"), 20, 100);
  const [draft, setDraft] = useState(search);
  useEffect(() => setDraft(search), [search]);
  const query = useCareSubjects({
    q: search,
    page,
    size,
    ...(identity.level >= 90 && organization ? { organization } : {}),
  });
  const response =
    !query.isError && !query.isPlaceholderData ? query.data : undefined;
  const rows = response?.data ?? [];
  const denied = response?.reportAccess === "denied";
  const available = response?.reportsAvailable === true;
  function setFilters(q: string, nextPage: number, nextSize: number) {
    const next = new URLSearchParams(params);
    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");
    next.set("page", String(nextPage));
    next.set("size", String(nextSize));
    setParams(next);
  }
  const assetIdentity = (subject: CareSubject) => {
    const name = subjectName(subject),
      label = translated(subject.label);
    return (
      <div className="care-asset-identity">
        <div className="care-asset-title">
          <HubStatus value={subject.lastEventAt} now={statusNow} />
          <Link to={careSubjectUrl(subject.id)}>{name}</Link>
        </div>
        {label && label !== name && (
          <Typography.Text type="secondary">{label}</Typography.Text>
        )}
      </div>
    );
  };
  const columns: TableColumnsType<CareSubject> = [
    {
      title: "Resident",
      key: "asset",
      width: "25%",
      render: (_, row) => assetIdentity(row),
    },
    {
      title: "Bed observation",
      key: "bed",
      width: "35%",
      render: (_, row) => <BedObservation subject={row} />,
    },
    {
      title: "Latest completed report",
      key: "report",
      render: (_, row) => (
        <LatestReport subject={row} available={available} denied={denied} />
      ),
    },
  ];
  return (
    <div className="care-page care-overview">
      <div className="care-page-heading">
        <div>
          <h1>Overview</h1>
        </div>
        <Button
          icon={<ReloadOutlined aria-hidden="true" />}
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh
        </Button>
      </div>
      <Card className="care-search-card">
        <label htmlFor="care-search">Find an asset</label>
        <Input.Search
          id="care-search"
          aria-label="Search assets"
          allowClear
          enterButton="Search"
          maxLength={100}
          value={draft}
          placeholder="Search by asset tag or label"
          onChange={(event) => setDraft(event.target.value)}
          onSearch={(value) => setFilters(value, 1, size)}
        />
      </Card>
      {query.isError ? (
        <QueryFailure
          error={query.error}
          retry={() => void query.refetch()}
          resource="Assets"
        />
      ) : !response ? (
        <Card aria-label="Loading assets">
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      ) : (
        <>
          {denied ? (
            <Alert
              type="info"
              showIcon
              message="Report access unavailable"
              description="You can view asset identities. Measurement and report access is not enabled for this account."
            />
          ) : !available ? (
            <Alert
              type="warning"
              showIcon
              message="Reports unavailable"
              description="Asset information is available. Stored reports are currently unavailable. Refresh to try again."
            />
          ) : null}
          {response.limited && (
            <Alert
              type="warning"
              showIcon
              message="Limited asset list"
              description="The service returned part of the available list. Some matching assets may not be listed."
            />
          )}
          {rows.length ? (
            <section aria-label="Authorized assets">
              <div className="care-subject-table">
                <Table<CareSubject>
                  columns={columns}
                  dataSource={rows}
                  rowKey="id"
                  pagination={false}
                />
              </div>
              <div className="care-subject-cards">
                {rows.map((subject) => (
                  <Card key={subject.id} className="care-subject-card">
                    {assetIdentity(subject)}
                    <h2>Bed observation</h2>
                    <BedObservation subject={subject} />
                    <h2>Latest completed report</h2>
                    <LatestReport
                      subject={subject}
                      available={available}
                      denied={denied}
                    />
                  </Card>
                ))}
              </div>
            </section>
          ) : (
            <Card>
              <Empty
                description={
                  response.total > 0
                    ? "No assets on this page."
                    : search
                      ? "No assets match your search."
                      : "No assets are available to this account."
                }
              />
              {response.total > 0 && (
                <Button onClick={() => setFilters(search, 1, size)}>
                  Return to first page
                </Button>
              )}
            </Card>
          )}
          <Pagination
            className="care-pagination"
            current={page}
            pageSize={size}
            total={response.total}
            showSizeChanger
            pageSizeOptions={[10, 20, 50, 100]}
            showTotal={(total) =>
              `${total}${response?.limited ? "+" : ""} assets`
            }
            onChange={(nextPage, nextSize) =>
              setFilters(search, nextSize !== size ? 1 : nextPage, nextSize)
            }
          />
        </>
      )}
    </div>
  );
}

const metricNumber = new Intl.NumberFormat(undefined, {
  maximumSignificantDigits: 15,
});

export function CareDetail() {
  const statusNow = useStatusTime();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { subjectId, reportId } = useParams<{
    subjectId: string;
    reportId: string;
  }>();
  const requestedDate = reportId
    ? undefined
    : (params.get("date") ?? undefined);
  const validSubject = validCareId(subjectId);
  const validReport =
    (reportId === undefined || validCareId(reportId)) &&
    (requestedDate === undefined || validCareDate(requestedDate));
  const subjectQuery = useCareSubject(validSubject ? subjectId : undefined);
  const response =
    !subjectQuery.isError && !subjectQuery.isPlaceholderData
      ? subjectQuery.data
      : undefined;
  const subject =
    response && response.data?.id === subjectId ? response.data : undefined;
  const latest =
    subject && knownReport(subject.latestReport, subject.id)
      ? subject.latestReport
      : null;
  const reportAllowed =
    !!subject &&
    response?.reportAccess !== "denied" &&
    response?.reportsAvailable === true;
  const dayReports = useCareReports(
    reportAllowed && requestedDate && validReport ? subjectId : undefined,
    requestedDate ? { startDate: requestedDate, endDate: requestedDate } : {},
  );
  const requestedReports =
    !dayReports.isError && !dayReports.isPlaceholderData
      ? dayReports.data?.data
      : undefined;
  const selected =
    reportId ??
    (requestedDate
      ? requestedReports?.find((entry) => entry.subjectId === subjectId)?.id
      : latest?.id);
  const reportQuery = useCareReport(
    reportAllowed && validReport ? subjectId : undefined,
    reportAllowed && validReport ? selected : undefined,
  );
  const fetched =
    !reportQuery.isError && !reportQuery.isPlaceholderData
      ? reportQuery.data?.data
      : undefined;
  const report =
    fetched && fetched.id === selected && knownReport(fetched, subjectId!)
      ? fetched
      : undefined;
  useEffect(() => {
    if (!reportId && !requestedDate && latest && reportAllowed && subjectId)
      navigate(careSubjectUrl(subjectId, latest.id), { replace: true });
  }, [reportId, requestedDate, latest?.id, reportAllowed, subjectId, navigate]);
  const refresh = () => {
    void subjectQuery.refetch();
    if (requestedDate && reportAllowed && validReport)
      void dayReports.refetch();
    if (reportAllowed && validReport && selected) void reportQuery.refetch();
  };
  return (
    <div className="care-page care-detail">
      <div className="care-detail-links">
        <Link to="/care" className="care-back-link">
          <ArrowLeftOutlined aria-hidden="true" /> Back to overview
        </Link>
        {subject && (
          <Link
            className="care-back-link"
            to={`${careSubjectUrl(subject.id)}/trends`}
          >
            Trends
          </Link>
        )}
      </div>
      <div className="care-page-heading">
        <div>
          <div className="care-asset-title">
            {subject && (
              <HubStatus value={subject.lastEventAt} now={statusNow} />
            )}
            <h1>{subject ? subjectName(subject) : "Asset detail"}</h1>
          </div>
          {subject && translated(subject.label) !== subjectName(subject) && (
            <p>{translated(subject.label)}</p>
          )}
        </div>
        {validSubject && (
          <Button
            icon={<ReloadOutlined aria-hidden="true" />}
            loading={
              subjectQuery.isFetching ||
              (reportAllowed && reportQuery.isFetching)
            }
            onClick={refresh}
          >
            Refresh
          </Button>
        )}
      </div>
      {!validSubject || !validReport ? (
        <Alert
          type="error"
          showIcon
          message="Asset or report unavailable"
          description="Check the link or select an asset from the overview."
        />
      ) : subjectQuery.isError ? (
        <QueryFailure
          error={subjectQuery.error}
          retry={refresh}
          resource="Asset"
        />
      ) : !subject ? (
        subjectQuery.isSuccess ? (
          <Alert
            type="error"
            showIcon
            message="Asset unavailable"
            description="The service did not return the selected asset."
          />
        ) : (
          <Card aria-label="Loading asset">
            <Skeleton active paragraph={{ rows: 4 }} />
          </Card>
        )
      ) : (
        <>
          <dl className="care-identity-metadata">
            <div>
              <dt>Asset ID</dt>
              <dd>{subject.id}</dd>
            </div>
            <div>
              <dt>Organization ID</dt>
              <dd>{subject.organizationId}</dd>
            </div>
          </dl>
          <Card
            title={<h2 className="care-card-heading">Latest observation</h2>}
          >
            <BedObservation subject={subject} />
            <p className="care-note">
              This observation is separate from the completed report below.
            </p>
          </Card>
          {reportAllowed && validReport && (
            <ReportNavigation
              subject={subject}
              report={report}
              requestedDate={requestedDate}
            />
          )}
          {response?.reportAccess === "denied" ? (
            <Alert
              type="info"
              showIcon
              message="Report access unavailable"
              description="Measurement and report access is not enabled for this account."
            />
          ) : !response?.reportsAvailable ? (
            <Alert
              type="warning"
              showIcon
              message="Reports unavailable"
              description="Stored reports are currently unavailable. Refresh to try again."
            />
          ) : requestedDate && dayReports.isError ? (
            <QueryFailure
              error={dayReports.error}
              retry={refresh}
              resource="Report"
            />
          ) : requestedDate && !reportId && dayReports.isPending ? (
            <Card aria-label="Loading report date">
              <Skeleton active />
            </Card>
          ) : !selected ? (
            <Card>
              <Empty description="No eligible completed report is available. Reports require a verified asset assignment for the entire reporting period." />
            </Card>
          ) : reportQuery.isError ? (
            <QueryFailure
              error={reportQuery.error}
              retry={refresh}
              resource="Report"
            />
          ) : !report ? (
            reportQuery.isSuccess ? (
              <Alert
                type="error"
                showIcon
                message="Report unavailable"
                description="The service did not return the selected report for this asset."
              />
            ) : (
              <Card aria-label="Loading report">
                <Skeleton active paragraph={{ rows: 6 }} />
              </Card>
            )
          ) : (
            <>
              <Card
                title={<h2 className="care-card-heading">Reporting period</h2>}
                extra={
                  <Tag color="success">
                    {report.id === latest?.id
                      ? "Latest completed report"
                      : "Completed report"}
                  </Tag>
                }
              >
                <Period period={report.period} />
                <p className="care-time-note">
                  Reporting convention: {report.period.timezone}. Times shown in{" "}
                  {careDisplayTimezone()}. The end marks the start of the next
                  period.
                </p>
              </Card>
              <Card
                title={<h2 className="care-card-heading">Report summary</h2>}
              >
                <p className="care-note">
                  Stored report values. Data coverage is not available.
                </p>
                <dl className="care-summary-values">
                  {report.metrics.map((metric) => (
                    <div key={metric.key}>
                      <dt>{metric.label}</dt>
                      <dd>
                        {metric.value === null ||
                        !Number.isFinite(metric.value) ? (
                          <span className="care-missing">Not available</span>
                        ) : (
                          <>
                            <span>{metricNumber.format(metric.value)}</span>
                            <small>{metric.unit}</small>
                          </>
                        )}
                      </dd>
                      {metric.definition && (
                        <p className="care-note">{metric.definition}</p>
                      )}
                    </div>
                  ))}
                </dl>
              </Card>
              <Suspense
                fallback={
                  <Card aria-label="Loading report graphs">
                    <Skeleton active />
                  </Card>
                }
              >
                <ReportGraphs
                  key={`${subject.id}:${report.id}`}
                  subjectId={subject.id}
                  report={report}
                />
              </Suspense>
              <Card
                title={
                  <h2 className="care-card-heading">Report information</h2>
                }
              >
                <dl className="care-provenance">
                  <div>
                    <dt>Generation time</dt>
                    <dd>
                      {report.generatedAt ? (
                        <Moment value={report.generatedAt} />
                      ) : (
                        "Not recorded"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Received</dt>
                    <dd>
                      <Moment value={report.provenance.ingestedAt} />
                    </dd>
                  </div>
                  <div>
                    <dt>Processed</dt>
                    <dd>
                      <Moment value={report.provenance.parsedAt} />
                    </dd>
                  </div>
                  {report.provenance.vendorUpdatedAt && (
                    <div>
                      <dt>Vendor updated</dt>
                      <dd>
                        <Moment value={report.provenance.vendorUpdatedAt} />
                      </dd>
                    </div>
                  )}
                </dl>
                <p className="care-note">
                  Received and processed times describe report preparation, not
                  its measurement window.
                </p>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
