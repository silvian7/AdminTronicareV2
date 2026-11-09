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
  decodeIncomingQuarantinedMessage,
  decodeIncomingQuarantinedMessages,
  type IncomingQuarantineSource,
  type IncomingQuarantinedMessage,
  type IncomingQuarantinedMessageDetail,
} from "../../shared/incoming-quarantined-messages";
import {
  DISPLAY_TIME_ZONE,
  formatDisplayDateTime,
} from "../../shared/date-time";
import { getSessionEpoch, request } from "../api";
import { useAdmin } from "../context";
import { LastRefreshed, useOperationalRefresh } from "./operational-freshness";
import "./quarantined-messages.css";

const endpoint = "/api/quarantine/incoming";
const sources: Record<IncomingQuarantineSource, string> = {
  CORE_TELEMETRY: "Core telemetry",
  MQTT_INGRESS: "MQTT ingress",
  BRIDGE_CORE_DELIVERY: "Bridge Core delivery batches",
  BRIDGE_CORE_DELIVERY_ITEM: "Bridge Core delivery items",
};
const statuses = {
  REJECTED: "Rejected",
  BLOCKED: "Blocked",
  PERMANENT_FAILURE: "Permanent failure",
} as const;
const routes = {
  PRIMARY: "Primary",
  MIRROR: "Mirror",
  PRIMARY_AND_MIRROR: "Primary and mirror",
} as const;
const outcomes = {
  RUNNING: "Running",
  PARSED: "Parsed",
  NO_OUTPUT: "No output",
  RETRY_WAIT: "Waiting to retry",
  PERMANENT_FAILURE: "Permanent failure",
  LEASE_EXPIRED: "Lease expired",
  LEASE_LOST: "Lease lost",
  PROCESSED: "Processed",
  DISCARDED: "Discarded",
  REJECTED: "Rejected",
  BLOCKED: "Blocked",
  RETRY_SCHEDULED: "Retry scheduled",
  SUCCEEDED: "Succeeded",
} as const;
const components = {
  PARSER: "Parser",
  CORE_PROCESSING: "Core processing",
  CORE_PRIMARY: "Core primary",
  CORE_MIRROR: "Core mirror",
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

function Status({ message }: { message: IncomingQuarantinedMessage }) {
  return (
    <Tag color={message.state === "BLOCKED" ? "gold" : "red"}>
      {statuses[message.state]}
    </Tag>
  );
}

function MessageDetails({ data }: { data: IncomingQuarantinedMessageDetail }) {
  const message = data.message;
  return (
    <div className="quarantine-details">
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="Message ID">{message.id}</Descriptions.Item>
        <Descriptions.Item label="Source">
          {sources[message.source]}
        </Descriptions.Item>
        {message.disposition !== null && (
          <Descriptions.Item label="Mode">
            <Tag color={message.disposition === "SHADOW" ? "blue" : "green"}>
              {message.disposition === "SHADOW" ? "Shadow" : "Active"}
            </Tag>
          </Descriptions.Item>
        )}
        <Descriptions.Item label="Quarantine status">
          <Status message={message} />
        </Descriptions.Item>
        <Descriptions.Item label="Outcome code">
          {message.outcomeCode ?? "Not recorded"}
        </Descriptions.Item>
        <Descriptions.Item label="Error code">
          {message.errorCode ?? "Not recorded"}
        </Descriptions.Item>
        <Descriptions.Item label="Parent ID">
          {message.parentId ?? "Not recorded"}
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
        <Descriptions.Item label="Items">
          {message.itemCount ?? "Not recorded"}
        </Descriptions.Item>
        <Descriptions.Item label="Parser family">
          {message.parserFamily ?? "Not recorded"}
        </Descriptions.Item>
        <Descriptions.Item label="Route">
          {message.route ? routes[message.route] : "Not recorded"}
        </Descriptions.Item>
        <Descriptions.Item label="Source version">
          {message.version}
        </Descriptions.Item>
      </Descriptions>
      {!data.payloadAvailable && (
        <Typography.Paragraph type="secondary" className="quarantine-section">
          Message contents are unavailable in this view.
        </Typography.Paragraph>
      )}
      <section className="quarantine-section" aria-label="Processing attempts">
        <Typography.Title level={5}>Processing attempts</Typography.Title>
        {data.attemptsHasMore && (
          <Alert
            type="info"
            showIcon
            className="page-alert"
            message={`Only the latest ${data.attemptLimit} processing attempts are shown. Earlier attempts are not included.`}
          />
        )}
        <Table
          rowKey={(attempt) =>
            `${attempt.component}:${attempt.attemptNumber}:${attempt.startedAt}`
          }
          dataSource={data.attempts}
          pagination={false}
          size="small"
          scroll={{ x: 1550, y: 360 }}
          locale={{ emptyText: "No processing attempts recorded." }}
          columns={[
            { title: "Attempt", dataIndex: "attemptNumber", width: 85 },
            {
              title: "Component",
              dataIndex: "component",
              width: 145,
              render: (value: keyof typeof components) => components[value],
            },
            {
              title: "Started",
              dataIndex: "startedAt",
              width: 185,
              render: time,
            },
            {
              title: "Completed",
              dataIndex: "completedAt",
              width: 185,
              render: time,
            },
            {
              title: "Outcome",
              dataIndex: "outcome",
              width: 175,
              render: (value: keyof typeof outcomes) => outcomes[value],
            },
            {
              title: "Outcome code",
              dataIndex: "outcomeCode",
              width: 200,
              render: (value: string | null) => value ?? "Not recorded",
            },
            {
              title: "Error code",
              dataIndex: "errorCode",
              width: 200,
              render: (value: string | null) => value ?? "Not recorded",
            },
            {
              title: "Protocol status",
              dataIndex: "protocolStatus",
              width: 115,
              render: (value: number | null) => value ?? "Not recorded",
            },
            {
              title: "Duration",
              dataIndex: "durationMs",
              width: 100,
              render: (value: number | null) =>
                value === null ? "Not recorded" : `${value} ms`,
            },
          ]}
        />
      </section>
    </div>
  );
}

function IncomingView({ refreshVersion }: { refreshVersion: number }) {
  const epoch = getSessionEpoch();
  const sourceId = useId();
  const statusId = useId();
  const [source, setSource] =
    useState<IncomingQuarantineSource>("CORE_TELEMETRY");
  const [state, setState] = useState<keyof typeof statuses | "">("");
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [reload, setReload] = useState(0);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [selected, setSelected] = useState<{
    id: string;
    version: number;
  } | null>(null);
  const cursor = pages.at(-1);
  const query = useQuery({
    queryKey: [
      "incoming-quarantined-messages",
      epoch,
      source,
      state,
      cursor,
      reload,
    ],
    queryFn: async ({ signal }) => {
      const parameters = new URLSearchParams({ source });
      if (state) parameters.set("state", state);
      if (cursor) parameters.set("cursor", cursor);
      return decodeIncomingQuarantinedMessages(
        await request<unknown>(`${endpoint}?${parameters}`, { signal }),
        source,
        state || undefined,
      );
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const detail = useQuery({
    queryKey: [
      "incoming-quarantined-message",
      epoch,
      source,
      selected?.id,
      selected?.version,
    ],
    queryFn: async ({ signal }) =>
      decodeIncomingQuarantinedMessage(
        await request<unknown>(
          `${endpoint}/${selected!.id}?${new URLSearchParams({ source })}`,
          { signal },
        ),
        source,
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
  const open = (message: IncomingQuarantinedMessage) => {
    const version = selectionVersion + 1;
    setSelectionVersion(version);
    setSelected({ id: message.id, version });
  };
  return (
    <>
      <Card
        title="Incoming quarantined messages"
        role="region"
        aria-label="Incoming quarantined messages"
        className="quarantined-messages"
        extra={
          <Button
            icon={<ReloadOutlined aria-hidden="true" />}
            aria-label="Refresh incoming quarantined messages"
            loading={query.isFetching}
            onClick={() => void refresh()}
          >
            Refresh
          </Button>
        }
      >
        <Typography.Paragraph type="secondary">
          Global incoming quarantine across all workspaces. Inspect retained
          ingestion outcomes and processing attempts. Newest record IDs first.
          Times are shown in Brussels time.
        </Typography.Paragraph>
        <LastRefreshed
          dataUpdatedAt={query.dataUpdatedAt}
          isFetching={query.isFetching}
          isError={query.isError}
        />
        <div className="quarantine-filters">
          <div className="quarantine-filter quarantine-filter-wide">
            <label htmlFor={sourceId}>Incoming source</label>
            <Select
              id={sourceId}
              value={source}
              onChange={(value: IncomingQuarantineSource) => {
                reset();
                setState("");
                setSource(value);
              }}
              options={Object.entries(sources).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </div>
          <div className="quarantine-filter">
            <label htmlFor={statusId}>Incoming quarantine status</label>
            <Select
              id={statusId}
              value={state}
              onChange={(value: keyof typeof statuses | "") => {
                reset();
                setState(value);
              }}
              options={[
                { value: "", label: "All statuses" },
                ...Object.entries(statuses)
                  .filter(
                    ([value]) =>
                      source === "CORE_TELEMETRY" ||
                      value === "PERMANENT_FAILURE",
                  )
                  .map(([value, label]) => ({ value, label })),
              ]}
            />
          </div>
        </div>
        {query.isError ? (
          <Alert
            type="error"
            showIcon
            message="Incoming quarantined messages unavailable"
            description={query.error.message}
            action={
              <Button
                aria-label="Retry incoming quarantined messages"
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
            {data.scanLimited && (
              <Alert
                type="info"
                showIcon
                className="page-alert"
                message="Checked a bounded range of retained records. Load older to continue."
              />
            )}
            {data.data.length ? (
              <Table<IncomingQuarantinedMessage>
                rowKey="id"
                dataSource={data.data}
                pagination={false}
                size="small"
                scroll={{ x: 1500, y: 520 }}
                columns={[
                  {
                    title: "Message",
                    dataIndex: "id",
                    width: 210,
                    render: (id: string, message) => (
                      <Button
                        type="link"
                        className="quarantine-identifier"
                        aria-label={`View incoming quarantined message ${id}`}
                        onClick={() => open(message)}
                      >
                        {id}
                      </Button>
                    ),
                  },
                  {
                    title: "Quarantine status",
                    width: 165,
                    render: (_, message) => <Status message={message} />,
                  },
                  ...(["MQTT_INGRESS", "BRIDGE_CORE_DELIVERY_ITEM"].includes(
                    source,
                  )
                    ? [
                        {
                          title: "Mode",
                          width: 110,
                          render: (
                            _: unknown,
                            message: IncomingQuarantinedMessage,
                          ) =>
                            message.disposition === null ? (
                              "Not recorded"
                            ) : (
                              <Tag
                                color={
                                  message.disposition === "SHADOW"
                                    ? "blue"
                                    : "green"
                                }
                              >
                                {message.disposition === "SHADOW"
                                  ? "Shadow"
                                  : "Active"}
                              </Tag>
                            ),
                        },
                      ]
                    : []),
                  {
                    title: "Outcome code",
                    dataIndex: "outcomeCode",
                    width: 220,
                    render: (value: string | null) => value ?? "Not recorded",
                  },
                  {
                    title: "Error code",
                    dataIndex: "errorCode",
                    width: 220,
                    render: (value: string | null) => value ?? "Not recorded",
                  },
                  {
                    title: "Quarantined",
                    dataIndex: "quarantinedAt",
                    width: 185,
                    render: time,
                  },
                  {
                    title: "Attempts",
                    dataIndex: "attemptCount",
                    width: 85,
                    align: "right",
                  },
                  {
                    title: "Parser family",
                    dataIndex: "parserFamily",
                    width: 180,
                    render: (value: string | null) => value ?? "Not recorded",
                  },
                  {
                    title: "Route",
                    dataIndex: "route",
                    width: 170,
                    render: (value: keyof typeof routes | null) =>
                      value ? routes[value] : "Not recorded",
                  },
                ]}
              />
            ) : (
              <Empty
                description={
                  data.hasMore
                    ? "No quarantined messages in this checked range."
                    : "No quarantined messages found."
                }
              />
            )}
            <div className="quarantine-pagination">
              <Typography.Text type="secondary">
                Page {pages.length} · Up to {data.limit} messages per page
              </Typography.Text>
              <Space>
                <Button
                  aria-label="Newer incoming quarantined messages"
                  disabled={pages.length === 1 || query.isFetching}
                  onClick={() => {
                    setSelected(null);
                    setPages((value) => value.slice(0, -1));
                  }}
                >
                  Newer
                </Button>
                <Button
                  aria-label="Older incoming quarantined messages"
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
        title="Incoming quarantined message"
        open={selected !== null}
        onClose={() => setSelected(null)}
        width="min(800px, 100vw)"
        destroyOnHidden
      >
        {detail.isError ? (
          <Alert
            type="error"
            showIcon
            message="Incoming message details unavailable"
            description={detail.error.message}
            action={
              <Button
                aria-label="Retry incoming quarantined message details"
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

export function IncomingQuarantinedMessages({
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
    <IncomingView key={getSessionEpoch()} refreshVersion={refreshVersion} />
  );
}
