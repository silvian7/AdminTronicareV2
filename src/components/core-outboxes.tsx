import type { UseQueryResult } from "@tanstack/react-query";
import { Button, Card, Table, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { coreOutboxLabels, type CoreOutbox } from "../../shared/core-outboxes";
import { formatLatency } from "../../shared/latency";
import { ErrorNotice } from "./fields";

export function CoreOutboxes({
  query,
}: {
  query: UseQueryResult<{ data: CoreOutbox[] }>;
}) {
  const refresh = () => void query.refetch();
  return (
    <Card
      title="Core outboxes"
      className="core-outboxes"
      extra={
        <Button
          icon={<ReloadOutlined />}
          aria-label="Refresh core outboxes"
          onClick={refresh}
          loading={query.isFetching}
        >
          Refresh
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">
        Global queues across all workspaces. Latency is the age of the oldest
        queued message. Updates every minute while this page is in focus.
      </Typography.Paragraph>
      <ErrorNotice error={query.error} retry={refresh} />
      {!query.isError && (
        <Table<CoreOutbox>
          rowKey="destination"
          loading={query.isPending}
          dataSource={query.data?.data ?? []}
          pagination={false}
          columns={[
            {
              title: "Outbox",
              dataIndex: "destination",
              render: (destination: CoreOutbox["destination"]) =>
                coreOutboxLabels[destination],
            },
            { title: "Size (messages)", dataIndex: "size", align: "right" },
            {
              title: "Latency (hh:mm:ss)",
              dataIndex: "latencySeconds",
              align: "right",
              render: formatLatency,
            },
          ]}
          scroll={{ x: 450 }}
        />
      )}
    </Card>
  );
}
