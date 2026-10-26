import { useEffect, useState } from "react";
import { useList } from "@refinedev/core";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Empty,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  ArrowRightOutlined,
  ApartmentOutlined,
  TeamOutlined,
  RadarChartOutlined,
  ClusterOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Link, useNavigate } from "react-router";
import {
  recordTitle,
  resourceMap,
  serviceLabels,
  valueOf,
  type RecordData,
  type Service,
} from "../../shared/resources";
import { useAdmin } from "../context";
import { AssetLastEvent, ErrorNotice } from "../components/fields";
import { HubStatus } from "../components/hub-status";
import { VirtualIndicator } from "../components/virtual-indicator";
import { CoreOutboxes } from "../components/core-outboxes";
import { ServiceOutboxes } from "../components/service-outboxes";
import { useRecordRow } from "../components/record-row";
import {
  LastRefreshed,
  useOperationalRefresh,
} from "../components/operational-freshness";
import { request } from "../api";
import { coreOutboxLabels, type CoreOutbox } from "../../shared/core-outboxes";
import {
  serviceOutboxLabels,
  type ServiceOutboxStatus,
} from "../../shared/service-outboxes";
import { exceedsTenMinutes, formatLatency } from "../../shared/latency";

function Metric({
  resource,
  icon,
  refreshVersion,
}: {
  resource: string;
  icon: React.ReactNode;
  refreshVersion: number;
}) {
  const { organization } = useAdmin();
  const { result, query } = useList<RecordData>({
    resource,
    pagination: { pageSize: 1 },
    meta: { organization },
    errorNotification: false,
  });
  useEffect(() => {
    if (refreshVersion) void query.refetch({ cancelRefetch: false });
  }, [refreshVersion, query.refetch]);
  return (
    <MetricCard
      resource={resource}
      icon={icon}
      total={result.total}
      limited={result.limited}
      isLoading={query.isLoading}
      isError={query.isError}
    />
  );
}
function MetricCard({
  resource,
  icon,
  total,
  limited,
  isLoading,
  isError,
}: {
  resource: string;
  icon: React.ReactNode;
  total?: number;
  limited?: boolean;
  isLoading: boolean;
  isError: boolean;
}) {
  return (
    <Card className="metric-card">
      <div className="metric-top">
        <span>{resourceMap[resource].label}</span>
        <span className="metric-icon">{icon}</span>
      </div>
      {isLoading ? (
        <Skeleton.Input active size="small" />
      ) : (
        <div className="metric-value">
          {isError ? "—" : `${total ?? 0}${limited ? "+" : ""}`}
        </div>
      )}
      <Link to={`/${resource}`} className="metric-link">
        {isError ? "Check access or service" : "View records"}
        <ArrowRightOutlined />
      </Link>
    </Card>
  );
}
export function Overview() {
  const { identity, organization, can } = useAdmin();
  const navigate = useNavigate();
  const assetRow = useRecordRow("assets");
  const [statusNow, setStatusNow] = useState(() => Date.now());
  const [refreshVersion, setRefreshVersion] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setStatusNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const { result, query } = useList<RecordData>({
    resource: "assets",
    pagination: { pageSize: 6 },
    meta: { organization },
    errorNotification: false,
    queryOptions: {
      enabled: can(resourceMap.assets, "list"),
      refetchOnWindowFocus: false,
    },
  });
  useOperationalRefresh(can(resourceMap.assets, "list"), query.refetch);
  const cards: [string, React.ReactNode][] = [
    ["assets", <ApartmentOutlined />],
    ["hubs", <ClusterOutlined />],
    ["sensors", <RadarChartOutlined />],
    ["users", <TeamOutlined />],
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PLATFORM OVERVIEW</span>
          <h1>Your workspace</h1>
          <p>
            Welcome, {identity.name.split(" ")[0]}. Review assets and manage
            connected equipment.
          </p>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            if (can(resourceMap.assets, "list"))
              void query.refetch({ cancelRefetch: false });
            setRefreshVersion((version) => version + 1);
          }}
          loading={query.isFetching}
        >
          Refresh
        </Button>
      </div>
      <div className="metrics-grid">
        {cards
          .filter(([r]) => can(resourceMap[r], "list"))
          .map(([resource, icon]) =>
            resource === "assets" ? (
              <MetricCard
                key={resource}
                resource={resource}
                icon={icon}
                total={result.total}
                limited={result.limited}
                isLoading={query.isLoading}
                isError={query.isError}
              />
            ) : (
              <Metric
                key={resource}
                resource={resource}
                icon={icon}
                refreshVersion={refreshVersion}
              />
            ),
          )}
      </div>
      <div className="overview-grid">
        <Card
          title="Assets in this workspace"
          extra={
            can(resourceMap.assets, "list") ? (
              <Link to="/assets">
                View all <ArrowRightOutlined />
              </Link>
            ) : undefined
          }
        >
          <LastRefreshed
            dataUpdatedAt={query.dataUpdatedAt}
            isFetching={query.isFetching}
            isError={query.isError}
          />
          <ErrorNotice
            error={query.error}
            retry={() => {
              if (can(resourceMap.assets, "list"))
                void query.refetch({ cancelRefetch: false });
            }}
          />
          {result.limited && (
            <Alert
              type="warning"
              className="page-alert"
              message="Asset counts reflect the loaded collection."
            />
          )}
          {can(resourceMap.assets, "list") ? (
            <Table
              rowKey="id"
              onRow={assetRow}
              loading={query.isLoading}
              dataSource={result.data}
              pagination={false}
              columns={[
                {
                  title: "Asset",
                  render: (_, row) => (
                    <div className="record-identity">
                      <VirtualIndicator value={valueOf(row, "Tag")} />
                      <Link to={`/assets/${row.id}`}>{recordTitle(row)}</Link>
                      <span>#{row.id}</span>
                    </div>
                  ),
                },
                {
                  title: "Status",
                  width: 80,
                  render: (_, row) => (
                    <HubStatus
                      value={valueOf(row, "DhLastEvent")}
                      now={statusNow}
                    />
                  ),
                },
                {
                  title: "Rules",
                  render: (_, row) => (
                    <Tag color={row.m_bPauseRules ? "gold" : "cyan"}>
                      {row.m_bPauseRules ? "Paused" : "Active"}
                    </Tag>
                  ),
                },
                {
                  title: "Last event",
                  render: (_, row) => (
                    <AssetLastEvent value={valueOf(row, "DhLastEvent")} />
                  ),
                },
              ]}
              scroll={{ x: 630 }}
            />
          ) : (
            <Empty description="No asset access is assigned to this account." />
          )}
        </Card>
        <Card title="Common tasks" className="quick-tasks">
          <p className="muted">Jump to the records you work with most.</p>
          {[
            ["users", "Manage people", "Accounts and access"],
            ["devices", "Inspect equipment", "Devices and their sensors"],
            ["rules", "Review rules", "Thresholds and schedules"],
          ]
            .filter(([r]) => can(resourceMap[r], "list"))
            .map(([r, title, description]) => (
              <button
                key={r}
                className="task-link"
                onClick={() => navigate(`/${r}`)}
              >
                <span>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
                <ArrowRightOutlined />
              </button>
            ))}
          {can(resourceMap.sensors, "list") && (
            <button
              className="task-link"
              onClick={() => navigate("/sensor-history")}
            >
              <span>
                <strong>Explore sensor history</strong>
                <small>Readings over time</small>
              </span>
              <ArrowRightOutlined />
            </button>
          )}
        </Card>
      </div>
      <Typography.Paragraph type="secondary" className="overview-note">
        Counts reflect records available to your account and the selected
        workspace. Service limits are shown where applicable.
      </Typography.Paragraph>
    </>
  );
}
interface ServiceRow {
  service: Service;
  state: string;
  version?: string;
  lastHeartbeat?: unknown;
  message?: string;
}
export function Services() {
  const { identity } = useAdmin();
  const query = useQuery({
    queryKey: ["service-status"],
    queryFn: ({ signal }) =>
      request<{ data: ServiceRow[] }>("/api/services", { signal }),
    enabled: identity.level >= 90,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const coreQuery = useQuery({
    queryKey: ["core-outboxes"],
    queryFn: ({ signal }) =>
      request<{ data: CoreOutbox[] }>("/api/core/outboxes", { signal }),
    enabled: identity.level >= 90,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const outboxesQuery = useQuery({
    queryKey: ["service-outboxes"],
    queryFn: ({ signal }) =>
      request<{ data: ServiceOutboxStatus[] }>("/api/outboxes", { signal }),
    enabled: identity.level >= 90,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const refresh = () => {
    void query.refetch();
    void coreQuery.refetch();
    void outboxesQuery.refetch();
  };
  const warnings = [
    ...(query.isError ? [] : (query.data?.data ?? []))
      .filter((row) => exceedsTenMinutes(row.lastHeartbeat))
      .map(
        (row) =>
          `${serviceLabels[row.service]} heartbeat: ${formatLatency(row.lastHeartbeat)}`,
      ),
    ...(coreQuery.isError ? [] : (coreQuery.data?.data ?? []))
      .filter((row) => exceedsTenMinutes(row.latencySeconds))
      .map(
        (row) =>
          `Core — ${coreOutboxLabels[row.destination]} latency: ${formatLatency(row.latencySeconds)}`,
      ),
    ...(outboxesQuery.isError ? [] : (outboxesQuery.data?.data ?? []))
      .filter((status) => status.state === "available")
      .flatMap((status) =>
        status.outboxes
          .filter((row) => exceedsTenMinutes(row.latencySeconds))
          .map(
            (row) =>
              `${serviceLabels[status.service]} — ${serviceOutboxLabels[status.service][row.destination]} latency: ${formatLatency(row.latencySeconds)}`,
          ),
      ),
  ];
  if (identity.level < 90)
    return (
      <Alert
        type="info"
        message="Service status is available to platform administrators."
      />
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">OPERATIONS</span>
          <h1>Service status</h1>
          <p>
            Availability reported by the configured administration APIs.
            Refreshes every minute while this page is in focus.
          </p>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={refresh}
          loading={
            query.isFetching || coreQuery.isFetching || outboxesQuery.isFetching
          }
        >
          Refresh
        </Button>
      </div>
      {warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          className="page-alert service-status-warning"
          message="Service delays exceed 10 minutes"
          description={
            <ul>
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          }
        />
      )}
      <ErrorNotice error={query.error} retry={refresh} />
      <Card>
        <Table
          rowKey="service"
          dataSource={query.data?.data ?? []}
          loading={query.isFetching}
          pagination={false}
          columns={[
            {
              title: "Service",
              dataIndex: "service",
              render: (v: Service) => serviceLabels[v],
            },
            {
              title: "Status",
              dataIndex: "state",
              render: (v) => (
                <Tag
                  color={
                    v === "available"
                      ? "cyan"
                      : v === "unconfigured"
                        ? "default"
                        : "gold"
                  }
                >
                  {v === "available"
                    ? "Available"
                    : v === "unconfigured"
                      ? "Not configured"
                      : "Unavailable"}
                </Tag>
              ),
            },
            { title: "Version", dataIndex: "version" },
            {
              title: "Heartbeat age",
              dataIndex: "lastHeartbeat",
              render: (v) => (v != null ? `${v}s` : "—"),
            },
            { title: "Details", dataIndex: "message" },
          ]}
          scroll={{ x: 750 }}
        />
      </Card>
      <CoreOutboxes query={coreQuery} />
      <ServiceOutboxes query={outboxesQuery} />
    </>
  );
}
