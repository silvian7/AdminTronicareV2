import { Alert, Button, Card, Select, Space, Typography } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router";
import type { CareReportDetail, CareSubject } from "../../shared/care";
import { brusselsDateInput } from "../../shared/date-time";
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
    brusselsDateInput(new Date());
  const selectedDay = validCareDate(candidate)
    ? candidate
    : brusselsDateInput(new Date());
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
      <Space
        wrap
        align="end"
        size="middle"
        className="care-report-navigation"
        style={{ display: "flex", marginBottom: 16 }}
      >
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
        <Button
          disabled={!subject.latestReport}
          onClick={() => subject.latestReport && open(subject.latestReport.id)}
        >
          Latest report
        </Button>
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
      </Space>
      <Typography.Paragraph className="care-note">
        The selector lists completed reports from the 31 days through{" "}
        {careDate(anchor)}. Previous and next move within this window.
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
          message="Only the first 100 eligible reports in this reporting window are listed."
        />
      )}
    </Card>
  );
}
