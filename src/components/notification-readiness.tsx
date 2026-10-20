import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Alert,
  Button,
  Card,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import {
  decodeNotificationReadinessBatch,
  notificationReadinessBatchLimit,
  type NotificationReadiness,
} from "../../shared/notification-readiness";
import { getSessionEpoch, request } from "../api";
import { useAdmin } from "../context";

export function useNotificationReadiness(userIds: readonly string[]) {
  const { organization } = useAdmin();
  const ids = [...new Set(userIds)].sort();
  const query = useQuery({
    queryKey: ["notification-readiness", getSessionEpoch(), organization, ids],
    queryFn: async ({ signal }) => {
      const rows: NotificationReadiness[] = [];
      // The regular 25-row page needs one request. Larger pages use sequential
      // bounded batches so one browser does not multiply server concurrency.
      for (
        let offset = 0;
        offset < ids.length;
        offset += notificationReadinessBatchLimit
      ) {
        const batch = ids.slice(
          offset,
          offset + notificationReadinessBatchLimit,
        );
        const value = await request<unknown>(
          `/api/users/notification-readiness?${new URLSearchParams({ ids: batch.join(",") })}`,
          { signal },
        );
        rows.push(...decodeNotificationReadinessBatch(value, batch));
      }
      return rows;
    },
    enabled: ids.length > 0,
    retry: false,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
  });
  const byUser = useMemo(
    () =>
      new Map(
        (query.isError ? [] : (query.data ?? [])).map((row) => [
          row.userId,
          row,
        ]),
      ),
    [query.isError, query.data],
  );
  return { query, byUser };
}

export function NotificationRegistrationTag({
  value,
  loading = false,
}: {
  value?: NotificationReadiness;
  loading?: boolean;
}) {
  const status = !value || value.state === "unavailable" ? undefined : value;
  return (
    <Tooltip title="Push registrations only. Phone notification permissions and delivery are not confirmed.">
      <Tag
        color={
          status?.notificationReadiness === "registered"
            ? "green"
            : status
              ? "gold"
              : "default"
        }
      >
        {loading
          ? "Checking…"
          : !status
            ? "Unavailable"
            : status.notificationReadiness === "no_registered_device"
              ? "No registration"
              : status.notificationReadiness === "device_limit_exceeded"
                ? `Too many registrations (${status.registeredDeviceCount})`
                : `Registered (${status.registeredDeviceCount})`}
      </Tag>
    </Tooltip>
  );
}

export function NotificationReadinessCard({ userId }: { userId: string }) {
  const { query, byUser } = useNotificationReadiness([userId]);
  const row = byUser.get(userId);
  const available = row?.state === "available" ? row : undefined;
  return (
    <Card
      title="Push notifications"
      className="notification-readiness"
      style={{ marginBottom: 16 }}
      extra={
        <Button
          aria-label="Refresh push registration status"
          icon={<ReloadOutlined />}
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh
        </Button>
      }
    >
      {query.isPending ? (
        <Skeleton active paragraph={{ rows: 1 }} />
      ) : (
        <Space direction="vertical" style={{ width: "100%" }}>
          <NotificationRegistrationTag value={row} />
          {!available ? (
            <Alert
              type="info"
              showIcon
              message="Registration status unavailable"
              description="Refresh to try again. An unavailable status does not mean that this user has no registration."
            />
          ) : available.notificationReadiness === "no_registered_device" ? (
            <Alert
              type="warning"
              showIcon
              message="No active push registration"
              description="No active mobile registration is available for push delivery. Ask this user to open the mobile app and check their notification settings, then refresh this status."
            />
          ) : available.notificationReadiness === "device_limit_exceeded" ? (
            <Alert
              type="warning"
              showIcon
              message="Push registration limit exceeded"
              description="There are more active registrations than push delivery supports. Review this user's mobile registrations before relying on push alerts."
            />
          ) : null}
          {available?.lastRegistrationAt && (
            <Typography.Text type="secondary">
              Last registration:{" "}
              <time dateTime={available.lastRegistrationAt}>
                {new Date(available.lastRegistrationAt).toLocaleString()}
              </time>
            </Typography.Text>
          )}
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Registration does not confirm phone notification permissions or
            guarantee delivery. Updates every 30 seconds while this page is in
            focus.
          </Typography.Paragraph>
        </Space>
      )}
    </Card>
  );
}
