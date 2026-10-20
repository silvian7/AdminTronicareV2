import { useQuery } from "@tanstack/react-query";
import { Button, Card, Table, Tag, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { serviceLabels } from "../../shared/resources";
import { formatLatency } from "../../shared/latency";
import {
  serviceOutboxLabels,
  type ServiceOutbox,
  type ServiceOutboxStatus,
} from "../../shared/service-outboxes";
import { request } from "../api";
import { ErrorNotice } from "./fields";

interface OutboxRow extends Omit<ServiceOutboxStatus, "outboxes"> {
  destination: string;
  size?: string;
  latencySeconds?: string;
}

export function ServiceOutboxes() {
  const query = useQuery({
    queryKey: ["service-outboxes"],
    queryFn: ({ signal }) =>
      request<{ data: ServiceOutboxStatus[] }>("/api/outboxes", { signal }),
    refetchInterval: 30_000,
  });
  const refresh = () => void query.refetch();
  const rows: OutboxRow[] = query.isError
    ? []
    : (query.data?.data ?? []).flatMap(({ outboxes, ...status }) =>
        status.state === "available"
          ? outboxes.map((outbox: ServiceOutbox) => ({ ...status, ...outbox }))
          : [{ ...status, destination: "" }],
      );
  return (
    <Card
      title="Service outboxes"
      className="service-outboxes"
      extra={
        <Button
          icon={<ReloadOutlined />}
          aria-label="Refresh service outboxes"
          onClick={refresh}
          loading={query.isFetching}
        >
          Refresh
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">
        Global queues across all workspaces. Latency is the queue age reported
        by each service; Actions uses the current forwarding or retry wait.
        Updates every 30 seconds.
      </Typography.Paragraph>
      <ErrorNotice error={query.error} retry={refresh} />
      {!query.isError && (
        <Table<OutboxRow>
          rowKey={(row) => `${row.service}:${row.destination}`}
          loading={query.isPending}
          dataSource={rows}
          pagination={false}
          columns={[
            {
              title: "Service",
              dataIndex: "service",
              render: (service: ServiceOutboxStatus["service"]) =>
                serviceLabels[service],
            },
            {
              title: "Outbox",
              render: (_, row) =>
                row.destination ? (
                  serviceOutboxLabels[row.service][row.destination]
                ) : (
                  <Typography.Text type="secondary">
                    {row.message}
                  </Typography.Text>
                ),
            },
            {
              title: "Status",
              dataIndex: "state",
              render: (state: ServiceOutboxStatus["state"]) => (
                <Tag
                  color={
                    state === "available"
                      ? "cyan"
                      : state === "unconfigured"
                        ? "default"
                        : "gold"
                  }
                >
                  {state === "available"
                    ? "Available"
                    : state === "unconfigured"
                      ? "Not configured"
                      : "Unavailable"}
                </Tag>
              ),
            },
            {
              title: "Queue size",
              dataIndex: "size",
              align: "right",
              render: (value?: string) => value ?? "—",
            },
            {
              title: "Latency (hh:mm:ss)",
              dataIndex: "latencySeconds",
              align: "right",
              render: formatLatency,
            },
          ]}
          scroll={{ x: 750 }}
        />
      )}
    </Card>
  );
}
