import { useCallback, useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import {
  decodeQuarantinedMessage,
  decodeQuarantinedMessages,
  type QuarantineDestination,
  type QuarantinedMessage,
  type QuarantinedMessageDetail,
  type QuarantineState,
} from "../../shared/quarantined-messages";
import {
  DISPLAY_TIME_ZONE,
  formatDisplayDateTime,
} from "../../shared/date-time";
import { getSessionEpoch, request } from "../api";
import { useAdmin } from "../context";
import { LastRefreshed, useOperationalRefresh } from "./operational-freshness";
import "./quarantined-messages.css";

const endpoint = "/api/core/quarantined-messages";
const destinations: Record<QuarantineDestination, string> = {
  RULES: "Rules",
  ASSETS: "Assets",
  MQTT_INFORMATION: "MQTT information",
  EXTERNAL_HISTORY: "External history",
};
const states: Record<QuarantineState, string> = {
  AMBIGUOUS: "Uncertain delivery",
  PERMANENT_FAILURE: "Permanent failure",
};
const deferredStates = {
  PENDING: "Pending",
  LEASED: "In progress",
  CONFIRMED: "Confirmed",
  NEEDS_REVIEW: "Needs review",
  EXHAUSTED: "Exhausted",
} as const;
const outcomes = {
  RUNNING: "Running",
  DELIVERED: "Delivered",
  RETRYABLE_FAILURE: "Retryable failure",
  PERMANENT_FAILURE: "Permanent failure",
  AMBIGUOUS: "Uncertain delivery",
  LEASE_EXPIRED: "Lease expired",
  LEASE_LOST: "Lease lost",
} as const;

function time(value: string | null) {
  return value ? (
    <time dateTime={value} title={DISPLAY_TIME_ZONE}>
      {formatDisplayDateTime(value)}
    </time>
  ) : (
    "Not recorded"
  );
}

function reason(value: string | null) {
  return value === "HISTORY_TYPE_RETAINED"
    ? "Unsupported history retained"
    : (value ?? "Not recorded");
}

function Status({ message }: { message: QuarantinedMessage }) {
  return (
    <Tag
      color={
        message.state === "AMBIGUOUS"
          ? "gold"
          : message.errorCode === "HISTORY_TYPE_RETAINED"
            ? "default"
            : "red"
      }
    >
      {states[message.state]}
    </Tag>
  );
}

function DeferredStatus({ message }: { message: QuarantinedMessage }) {
  const delivery = message.deferredDelivery;
  if (!delivery) return <span>No deferred delivery recorded</span>;
  return (
    <Space direction="vertical" size={4}>
      <Tag
        color={
          !delivery.matchesCurrentSource
            ? "default"
            : delivery.state === "CONFIRMED"
              ? "green"
              : ["NEEDS_REVIEW", "EXHAUSTED"].includes(delivery.state)
                ? "gold"
                : "blue"
        }
      >
        {deferredStates[delivery.state]}
      </Tag>
      {!delivery.matchesCurrentSource && <span>Earlier source version</span>}
    </Space>
  );
}

function MessageDetails({ data }: { data: QuarantinedMessageDetail }) {
  const message = data.message;
  return (
    <div className="quarantine-details">
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="Message ID">{message.id}</Descriptions.Item>
        <Descriptions.Item label="Message UUID">
          <span className="quarantine-identifier">{message.messageUuid}</span>
        </Descriptions.Item>
        <Descriptions.Item label="Destination">
          {destinations[message.destination]}
        </Descriptions.Item>
        <Descriptions.Item label="Quarantine status">
          <Status message={message} />
        </Descriptions.Item>
        <Descriptions.Item label="Reason">
          {reason(message.errorCode)}
        </Descriptions.Item>
        <Descriptions.Item label="Origin item ID">
          {message.originItemId}
        </Descriptions.Item>
        <Descriptions.Item label="Created">
          {time(message.createdAt)}
        </Descriptions.Item>
        <Descriptions.Item label="Quarantined">
          {time(message.quarantinedAt)}
        </Descriptions.Item>
        <Descriptions.Item label="Updated">
          {time(message.updatedAt)}
        </Descriptions.Item>
        <Descriptions.Item label="Attempts">
          {message.attemptCount}
        </Descriptions.Item>
        <Descriptions.Item label="Owner acknowledgement">
          {message.acknowledgedAt ? (
            <Space direction="vertical" size={4}>
              <span>Owner acknowledgement recorded</span>
              {time(message.acknowledgedAt)}
            </Space>
          ) : (
            "No owner acknowledgement recorded"
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Contract version">
          {message.contractVersion}
        </Descriptions.Item>
        <Descriptions.Item label="Source version">
          {message.version}
        </Descriptions.Item>
        <Descriptions.Item label="Payload SHA-256">
          <span className="quarantine-identifier">{message.payloadSha256}</span>
        </Descriptions.Item>
      </Descriptions>
      {!data.recoveryDetailsAvailable &&
        message.destination === "EXTERNAL_HISTORY" &&
        message.state === "AMBIGUOUS" && (
          <Alert
            className="quarantine-section"
            type="info"
            showIcon
            message="Recovery status is unavailable here"
            description="History recovery may continue independently of this retained outcome."
          />
        )}
      {data.recoveryDetailsAvailable && (
        <section className="quarantine-section" aria-label="Deferred delivery">
          <Typography.Title level={5}>Deferred delivery</Typography.Title>
          {message.deferredDelivery ? (
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="Recorded status">
                <DeferredStatus message={message} />
              </Descriptions.Item>
              <Descriptions.Item label="Source version">
                {message.deferredDelivery.sourceVersion}
              </Descriptions.Item>
              <Descriptions.Item label="Attempts">
                {message.deferredDelivery.attemptCount}
              </Descriptions.Item>
              <Descriptions.Item label="Failure code">
                {reason(message.deferredDelivery.failureCode)}
              </Descriptions.Item>
              <Descriptions.Item label="Updated">
                {time(message.deferredDelivery.updatedAt)}
              </Descriptions.Item>
            </Descriptions>
          ) : (
            <Typography.Paragraph type="secondary">
              No deferred delivery recorded.
            </Typography.Paragraph>
          )}
        </section>
      )}
      <section className="quarantine-section" aria-label="Delivery attempts">
        <Typography.Title level={5}>Delivery attempts</Typography.Title>
        {data.attemptsHasMore && (
          <Alert
            type="info"
            showIcon
            className="page-alert"
            message={`Only the latest ${data.attemptLimit} delivery attempts are shown. Earlier attempts are not included.`}
          />
        )}
        <Table
          rowKey="attemptNumber"
          dataSource={data.attempts}
          pagination={false}
          size="small"
          scroll={{ x: 1100, y: 360 }}
          locale={{ emptyText: "No delivery attempts recorded." }}
          columns={[
            { title: "Attempt", dataIndex: "attemptNumber", width: 85 },
            {
              title: "Started",
              dataIndex: "startedAt",
              width: 175,
              render: time,
            },
            {
              title: "Completed",
              dataIndex: "completedAt",
              width: 175,
              render: time,
            },
            {
              title: "Outcome",
              width: 175,
              dataIndex: "outcome",
              render: (value: keyof typeof outcomes) => outcomes[value],
            },
            {
              title: "Protocol status",
              width: 115,
              dataIndex: "protocolStatus",
              render: (value: number | null) => value ?? "Not recorded",
            },
            {
              title: "Duration",
              width: 100,
              dataIndex: "durationMs",
              render: (value: number | null) =>
                value === null ? "Not recorded" : `${value} ms`,
            },
            {
              title: "Reason",
              dataIndex: "errorCode",
              width: 220,
              render: reason,
            },
          ]}
        />
      </section>
    </div>
  );
}

function QuarantineView({ refreshVersion }: { refreshVersion: number }) {
  const epoch = getSessionEpoch();
  const destinationId = useId();
  const stateId = useId();
  const [destination, setDestination] = useState<QuarantineDestination | "">(
    "",
  );
  const [state, setState] = useState<QuarantineState | "">("");
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<{
    id: string;
    version: number;
  } | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const cursor = pages.at(-1);
  const query = useQuery({
    queryKey: [
      "core-quarantined-messages",
      epoch,
      destination,
      state,
      cursor,
      reload,
    ],
    queryFn: async ({ signal }) => {
      const parameters = new URLSearchParams();
      if (destination) parameters.set("destination", destination);
      if (state) parameters.set("state", state);
      if (cursor) parameters.set("cursor", cursor);
      const search = parameters.size ? `?${parameters}` : "";
      return decodeQuarantinedMessages(
        await request<unknown>(`${endpoint}${search}`, { signal }),
        {
          destination: destination || undefined,
          state: state || undefined,
        },
      );
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const detail = useQuery({
    queryKey: [
      "core-quarantined-message",
      epoch,
      selected?.id,
      selected?.version,
    ],
    queryFn: async ({ signal }) =>
      decodeQuarantinedMessage(
        await request<unknown>(`${endpoint}/${selected!.id}`, { signal }),
        selected!.id,
      ),
    enabled: selected !== null,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const reset = useCallback(() => {
    setPages([null]);
    setSelected(null);
  }, []);
  const refresh = useCallback(async () => {
    reset();
    setReload((version) => version + 1);
  }, [reset]);
  useOperationalRefresh(true, refresh, 60_000);
  useEffect(() => {
    if (refreshVersion) void refresh();
  }, [refreshVersion, refresh]);
  const data = query.isError ? undefined : query.data;
  const open = (message: QuarantinedMessage) => {
    const version = selectionVersion + 1;
    setSelectionVersion(version);
    setSelected({ id: message.id, version });
  };
  return (
    <>
      <Card
        title="Outgoing quarantined messages"
        role="region"
        aria-label="Outgoing quarantined messages"
        className="quarantined-messages"
        extra={
          <Button
            icon={<ReloadOutlined aria-hidden="true" />}
            aria-label="Refresh quarantined messages"
            loading={query.isFetching}
            onClick={() => void refresh()}
          >
            Refresh
          </Button>
        }
      >
        <Typography.Paragraph type="secondary">
          Global Core outgoing delivery quarantine across all workspaces.
          Messages are listed newest first. Times are shown in Brussels time.
        </Typography.Paragraph>
        <LastRefreshed
          dataUpdatedAt={query.dataUpdatedAt}
          isFetching={query.isFetching}
          isError={query.isError}
        />
        <div className="quarantine-filters">
          <div className="quarantine-filter">
            <label htmlFor={destinationId}>Destination</label>
            <Select
              id={destinationId}
              value={destination}
              onChange={(value: QuarantineDestination | "") => {
                reset();
                setDestination(value);
              }}
              options={[
                { value: "", label: "All destinations" },
                ...Object.entries(destinations).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
          </div>
          <div className="quarantine-filter">
            <label htmlFor={stateId}>Quarantine status</label>
            <Select
              id={stateId}
              value={state}
              onChange={(value: QuarantineState | "") => {
                reset();
                setState(value);
              }}
              options={[
                { value: "", label: "All statuses" },
                ...Object.entries(states).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
          </div>
        </div>
        {query.isError ? (
          <Alert
            type="error"
            showIcon
            message="Quarantined messages unavailable"
            description={query.error.message}
            action={
              <Button
                aria-label="Retry quarantined messages"
                onClick={() => void refresh()}
              >
                Retry
              </Button>
            }
          />
        ) : query.isPending ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : data ? (
          <>
            {data.data.length ? (
              <Table<QuarantinedMessage>
                rowKey="id"
                dataSource={data.data}
                pagination={false}
                size="small"
                scroll={{ x: 1300, y: 520 }}
                columns={[
                  {
                    title: "Message",
                    width: 210,
                    dataIndex: "id",
                    render: (id: string, message) => (
                      <Button
                        type="link"
                        className="quarantine-identifier"
                        onClick={() => open(message)}
                        aria-label={`View quarantined message ${id}`}
                      >
                        {id}
                      </Button>
                    ),
                  },
                  {
                    title: "Destination",
                    width: 150,
                    dataIndex: "destination",
                    render: (value: QuarantineDestination) =>
                      destinations[value],
                  },
                  {
                    title: "Quarantine status",
                    width: 165,
                    render: (_, message) => <Status message={message} />,
                  },
                  {
                    title: "Reason",
                    dataIndex: "errorCode",
                    width: 220,
                    render: reason,
                  },
                  {
                    title: "Quarantined",
                    width: 185,
                    dataIndex: "quarantinedAt",
                    render: time,
                  },
                  {
                    title: "Attempts",
                    width: 85,
                    dataIndex: "attemptCount",
                    align: "right",
                  },
                  ...(data.recoveryDetailsAvailable
                    ? [
                        {
                          title: "Deferred delivery",
                          width: 185,
                          render: (_: unknown, message: QuarantinedMessage) => (
                            <DeferredStatus message={message} />
                          ),
                        },
                      ]
                    : []),
                  {
                    title: "Owner acknowledgement",
                    width: 220,
                    render: (_, message) =>
                      message.acknowledgedAt
                        ? "Owner acknowledgement recorded"
                        : "Not recorded",
                  },
                ]}
              />
            ) : (
              <Empty description="No quarantined messages match these filters." />
            )}
            <div className="quarantine-pagination">
              <Typography.Text type="secondary">
                Page {pages.length} · Up to {data.limit} messages per page
              </Typography.Text>
              <Space>
                <Button
                  aria-label="Newer quarantined messages"
                  disabled={pages.length === 1 || query.isFetching}
                  onClick={() => {
                    setSelected(null);
                    setPages((value) => value.slice(0, -1));
                  }}
                >
                  Newer
                </Button>
                <Button
                  aria-label="Older quarantined messages"
                  disabled={
                    !data.hasMore || !data.nextCursor || query.isFetching
                  }
                  onClick={() => {
                    setSelected(null);
                    setPages((value) => [...value, data.nextCursor]);
                  }}
                >
                  Older
                </Button>
              </Space>
            </div>
          </>
        ) : null}
      </Card>
      <Drawer
        title="Outgoing quarantined message"
        open={selected !== null}
        onClose={() => setSelected(null)}
        width="min(800px, 100vw)"
        destroyOnHidden
      >
        {detail.isError ? (
          <Alert
            type="error"
            showIcon
            message="Message details unavailable"
            description={detail.error.message}
            action={
              <Button
                aria-label="Retry quarantined message details"
                onClick={() => void detail.refetch()}
              >
                Retry
              </Button>
            }
          />
        ) : detail.isPending ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : detail.data ? (
          <MessageDetails data={detail.data} />
        ) : null}
      </Drawer>
    </>
  );
}

export function QuarantinedMessages({
  refreshVersion,
}: {
  refreshVersion: number;
}) {
  const { identity } = useAdmin();
  if (
    identity.level < 90 ||
    identity.mustChangePassword ||
    identity.caregiverReadOnly
  )
    return null;
  return (
    <QuarantineView key={getSessionEpoch()} refreshVersion={refreshVersion} />
  );
}
