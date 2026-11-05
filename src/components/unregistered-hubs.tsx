import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Empty, Skeleton, Space, Table, Tag } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import {
  decodeUnregisteredHubs,
  type UnregisteredHub,
} from "../../shared/unregistered-hubs";
import { formatDisplayDateTime } from "../../shared/date-time";
import { getSessionEpoch, request } from "../api";
import { useAdmin } from "../context";
import { LastRefreshed, useOperationalRefresh } from "./operational-freshness";

const dateTime = (value: string) => (
  <time dateTime={value}>{formatDisplayDateTime(value)}</time>
);

export function UnregisteredHubs({
  refreshVersion,
}: {
  refreshVersion: number;
}) {
  const { identity } = useAdmin();
  const enabled =
    identity.level >= 90 &&
    !identity.mustChangePassword &&
    !identity.caregiverReadOnly;
  const query = useQuery({
    queryKey: ["core-unregistered-hubs", getSessionEpoch()],
    queryFn: async ({ signal }) =>
      decodeUnregisteredHubs(
        await request<unknown>("/api/core/unregistered-hubs", { signal }),
      ),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  useOperationalRefresh(enabled, query.refetch, 60_000);
  useEffect(() => {
    if (enabled && refreshVersion) void query.refetch({ cancelRefetch: false });
  }, [enabled, refreshVersion, query.refetch]);
  if (!enabled) return null;

  const data = query.isError ? undefined : query.data;
  const refresh = () => void query.refetch({ cancelRefetch: false });
  return (
    <Card
      title="Unregistered hubs"
      className="unregistered-hubs"
      role="region"
      aria-label="Unregistered hubs"
      extra={
        <Button
          icon={<ReloadOutlined aria-hidden="true" />}
          aria-label="Refresh unregistered hubs"
          loading={query.isFetching}
          onClick={refresh}
        >
          Refresh
        </Button>
      }
    >
      <p className="muted">
        Across the platform, based on retained REJECTED / UNKNOWN_HUB events.
        Registered hubs disappear from this list automatically.
      </p>
      <LastRefreshed
        dataUpdatedAt={query.dataUpdatedAt}
        isFetching={query.isFetching}
        isError={query.isError}
      />
      {query.isError ? (
        <Alert
          type="error"
          showIcon
          message="Unregistered hubs unavailable"
          description={query.error.message}
          action={
            <Button aria-label="Retry unregistered hubs" onClick={refresh}>
              Retry
            </Button>
          }
        />
      ) : query.isPending ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : data ? (
        <>
          {data.messagesLimited && (
            <Alert
              className="page-alert"
              type="info"
              showIcon
              message="Counts cover the latest 10,000 retained unknown-hub rejections. Older rejections are not included."
            />
          )}
          {data.hasMore && (
            <Alert
              className="page-alert"
              type="info"
              showIcon
              message="Only the 100 most recently seen unregistered hubs are shown."
            />
          )}
          {data.data.length ? (
            <Table<UnregisteredHub>
              rowKey={(row) => JSON.stringify([row.hubKind, row.serialNumber])}
              dataSource={data.data}
              pagination={{
                pageSize: 5,
                hideOnSinglePage: true,
                showSizeChanger: false,
              }}
              size="small"
              scroll={{ x: 900 }}
              columns={[
                {
                  title: "Hub type",
                  dataIndex: "hubKind",
                  width: 180,
                  render: (kind: string, row) => (
                    <Space direction="vertical" size={4} align="start">
                      <span>{kind}</span>
                      {row.hubTypeStatus !== "registered" && (
                        <Tag color="warning">
                          {row.hubTypeStatus === "unregistered"
                            ? "Unknown type"
                            : "Ambiguous type"}
                        </Tag>
                      )}
                    </Space>
                  ),
                },
                {
                  title: "Serial number",
                  dataIndex: "serialNumber",
                  width: 220,
                },
                {
                  title: "First received",
                  dataIndex: "firstSeenAt",
                  render: dateTime,
                },
                {
                  title: "Last received",
                  dataIndex: "lastSeenAt",
                  render: dateTime,
                },
                {
                  title: "Rejections",
                  dataIndex: "rejectionCount",
                  align: "right",
                  width: 110,
                },
              ]}
            />
          ) : (
            <Empty description="No unregistered hubs found in the checked rejections." />
          )}
        </>
      ) : null}
    </Card>
  );
}
