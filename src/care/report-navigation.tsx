import { Alert, Button, Card, Input, Select, Space, Typography } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router";
import type { CareReportDetail, CareSubject } from "../../shared/care";
import {
  careDateOffset,
  careDate,
  careSubjectUrl,
  useCareReports,
  validCareDate,
  validCareId,
} from "./api";

export function ReportNavigation({
  subject,
  report,
  requestedDate,
}: {
  subject: CareSubject;
  report?: CareReportDetail;
  requestedDate?: string;
}) {
  const navigate = useNavigate();
  const candidate =
    requestedDate ??
    report?.period.reportDate ??
    subject.latestReport?.period.reportDate ??
    new Date().toISOString().slice(0, 10);
  const selectedDay = validCareDate(candidate)
    ? candidate
    : new Date().toISOString().slice(0, 10);
  const latestDay = subject.latestReport?.period.reportDate;
  const distance = validCareDate(latestDay)
    ? (Date.parse(latestDay) - Date.parse(selectedDay)) / 86400000
    : 0;
  const anchor =
    distance > 0
      ? distance <= 30
        ? latestDay!
        : careDateOffset(selectedDay, 15)
      : selectedDay;
  const query = useCareReports(subject.id, {
    startDate: careDateOffset(anchor, -30),
    endDate: anchor,
  });
  const reports =
    !query.isError && !query.isPlaceholderData
      ? (query.data?.data ?? []).filter(
          (entry) => entry.subjectId === subject.id && validCareId(entry.id),
        )
      : [];
  const index = reports.findIndex((entry) => entry.id === report?.id);
  const open = (id: string) => navigate(careSubjectUrl(subject.id, id));
  return (
    <Card title={<h2 className="care-card-heading">Choose a report</h2>}>
      <Space wrap size="middle" className="care-report-navigation">
        <Button
          icon={<LeftOutlined aria-hidden="true" />}
          disabled={index < 0 || index >= reports.length - 1}
          onClick={() => open(reports[index + 1].id)}
        >
          Previous report
        </Button>
        <Button
          icon={<RightOutlined aria-hidden="true" />}
          disabled={index <= 0}
          onClick={() => open(reports[index - 1].id)}
        >
          Next report
        </Button>
        <label>
          Reporting period
          <Select
            aria-label="Reporting period"
            value={report?.id}
            placeholder="Select a completed report"
            style={{ minWidth: 240, display: "block" }}
            loading={query.isFetching}
            options={reports.map((entry) => ({
              value: entry.id,
              label: `${careDate(entry.period.reportDate)} · ${entry.id}`,
            }))}
            onChange={open}
          />
        </label>
        <label>
          Report date (UTC)
          <Input
            type="date"
            aria-label="Report date"
            value={requestedDate ?? report?.period.reportDate ?? selectedDay}
            min="1970-01-01"
            max="9999-12-31"
            onChange={(event) => {
              const value = event.target.value;
              if (validCareDate(value))
                navigate(`${careSubjectUrl(subject.id)}?date=${value}`);
            }}
          />
        </label>
        <Button
          disabled={!subject.latestReport}
          onClick={() => subject.latestReport && open(subject.latestReport.id)}
        >
          Latest report
        </Button>
      </Space>
      <Typography.Paragraph className="care-note">
        Report dates follow the original UTC convention. The selector lists
        completed reports from the 31 days through {careDate(anchor)}. Previous
        and next move within this window; choose a date to search other history.
      </Typography.Paragraph>
      {query.isError && (
        <Alert
          type="error"
          showIcon
          message="Report list unavailable"
          description={query.error.message}
          action={
            <Button onClick={() => void query.refetch()}>
              Retry report list
            </Button>
          }
        />
      )}
      {query.data?.limited && (
        <Alert
          type="info"
          showIcon
          message="Only the first 100 eligible reports in this date range are listed. Choose a date to narrow the search."
        />
      )}
    </Card>
  );
}
