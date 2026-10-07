import { useEffect, useState } from "react";
import { useList } from "@refinedev/core";
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
import { ErrorNotice } from "../components/fields";
import { request } from "../api";

function Metric({
  resource,
  icon,
}: {
  resource: string;
  icon: React.ReactNode;
}) {
  const { organization } = useAdmin();
  const { result, query } = useList<RecordData>({
    resource,
    pagination: { pageSize: 1 },
    meta: { organization },
    errorNotification: false,
  });
  return (
    <Card className="metric-card">
      <div className="metric-top">
        <span>{resourceMap[resource].label}</span>
        <span className="metric-icon">{icon}</span>
      </div>
      {query.isLoading ? (
        <Skeleton.Input active size="small" />
      ) : (
        <div className="metric-value">
          {query.isError
            ? "—"
            : `${result.total ?? 0}${result.limited ? "+" : ""}`}
        </div>
      )}
      <Link to={`/${resource}`} className="metric-link">
        {query.isError ? "Check access or service" : "View records"}
        <ArrowRightOutlined />
      </Link>
    </Card>
  );
}
export function Overview() {
  const { identity, organization, can } = useAdmin();
  const navigate = useNavigate();
  const { result, query } = useList<RecordData>({
    resource: "assets",
    pagination: { pageSize: 6 },
    meta: { organization },
    errorNotification: false,
    queryOptions: { enabled: can(resourceMap.assets, "list") },
  });
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
          onClick={() => window.location.reload()}
        >
          Refresh
        </Button>
      </div>
      <div className="metrics-grid">
        {cards
          .filter(([r]) => can(resourceMap[r], "list"))
          .map(([resource, icon]) => (
            <Metric key={resource} resource={resource} icon={icon} />
          ))}
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
          <ErrorNotice error={query.error} retry={() => query.refetch()} />
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
              loading={query.isLoading}
              dataSource={result.data}
              pagination={false}
              columns={[
                {
                  title: "Asset",
                  render: (_, row) => (
                    <div className="record-identity">
                      <Link to={`/assets/${row.id}`}>{recordTitle(row)}</Link>
                      <span>#{row.id}</span>
                    </div>
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
                    <span className="muted">
                      {String(valueOf(row, "DhLastEvent") ?? "—").replace(
                        "T",
                        " ",
                      )}
                    </span>
                  ),
                },
              ]}
              scroll={{ x: 550 }}
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
  lastHeartbeat?: string;
  message?: string;
}
export function Services() {
  const { identity } = useAdmin();
  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setRows((await request<{ data: ServiceRow[] }>("/api/services")).data);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (identity.level >= 90) void refresh();
    else setLoading(false);
  }, [identity.level]);
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
          <p>Availability reported by the configured administration APIs.</p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
          Refresh
        </Button>
      </div>
      <ErrorNotice error={error} retry={refresh} />
      <Card>
        <Table
          rowKey="service"
          dataSource={rows}
          loading={loading}
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
    </>
  );
}
