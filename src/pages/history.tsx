import { useState } from "react";
import { useInvalidate } from "@refinedev/core";
import { Button, Card, Form, Input, Radio, Table, Typography } from "antd";
import { useSearchParams } from "react-router";
import { SearchOutlined } from "@ant-design/icons";
import { request } from "../api";
import {
  ReferenceSelect,
  ErrorNotice,
  SensorHistoryIdentity,
  SensorHistoryValue,
  SensorLastReading,
} from "../components/fields";
import { resourceMap, type RecordData } from "../../shared/resources";
import { useAdmin } from "../context";

interface HistoryResponse {
  data: RecordData[];
  snapshot: string | null;
  highWaterId: string | null;
  hasMore: boolean;
}
export function SensorHistory() {
  const { organization, can } = useAdmin();
  const invalidate = useInvalidate();
  const [params, setParams] = useSearchParams();
  const [target, setTarget] = useState(
    params.has("idasset") ? "asset" : "sensor",
  );
  const [form] = Form.useForm();
  const [pages, setPages] = useState<HistoryResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [baseQuery, setBaseQuery] = useState<Record<string, string>>();
  const rows = pages.flatMap((p) => p.data);
  const last = pages.at(-1);
  async function load(query: Record<string, string>, append = false) {
    setLoading(true);
    setError(null);
    try {
      const result = await request<HistoryResponse>(
        `/api/history?${new URLSearchParams(query)}`,
      );
      if (!append && can(resourceMap.sensortypes, "show"))
        await invalidate({
          resource: "sensortypes",
          invalidates: ["resourceAll"],
          invalidationFilters: {
            predicate: ({ meta }) =>
              meta?.equipmentTypeReference === true &&
              meta?.organization === organization,
          },
        });
      setPages((previous) => (append ? [...previous, result] : [result]));
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }
  function next() {
    const row = last?.data.at(-1);
    if (!last || !row || !baseQuery) return;
    if (!last.snapshot || !last.highWaterId) {
      setError(
        new Error(
          "The service did not provide a continuation token. Narrow the date range.",
        ),
      );
      return;
    }
    void load(
      {
        ...baseQuery,
        afterevent: String(row.m_dhDhLastEvent),
        afterid: String(row.m_nIDSensorHistory),
        highwaterid: last.highWaterId,
        snapshot: last.snapshot,
      },
      true,
    );
  }
  const columns = [
    {
      title: "Sensor",
      dataIndex: "m_nIDSensor",
      width: 240,
      render: (_: unknown, row: RecordData) => (
        <SensorHistoryIdentity row={row} />
      ),
    },
    {
      title: "Value",
      key: "value",
      render: (_: unknown, row: RecordData) => <SensorHistoryValue row={row} />,
    },
    {
      title: "Event time",
      dataIndex: "m_dhDhLastEvent",
      render: (_: unknown, row: RecordData) => <SensorLastReading row={row} />,
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ACTIVITY</span>
          <h1>Sensor history</h1>
          <p>Inspect recorded readings for a sensor or asset.</p>
        </div>
      </div>
      <Card className="form-section">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            id: params.get("idsensor") ?? params.get("idasset"),
            filter: "1",
          }}
          onFinish={(values) => {
            const query: Record<string, string> = {
              [target === "sensor" ? "idsensor" : "idasset"]: values.id,
              filter: values.filter,
            };
            if (values.start) query.dhstart = `${values.start}:00Z`;
            if (values.end) query.dhend = `${values.end}:00Z`;
            setBaseQuery(query);
            setParams({
              [target === "sensor" ? "idsensor" : "idasset"]: values.id,
            });
            setPages([]);
            void load(query);
          }}
        >
          <div className="history-filters">
            <Form.Item label="Look up">
              <Radio.Group
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  form.setFieldValue("id", undefined);
                }}
                options={[
                  { label: "Sensor", value: "sensor" },
                  { label: "Asset", value: "asset" },
                ]}
                optionType="button"
              />
            </Form.Item>
            <Form.Item
              name="id"
              label={target === "sensor" ? "Sensor" : "Asset"}
              rules={[{ required: true, message: "Choose a record." }]}
            >
              <ReferenceSelect
                resource={target === "sensor" ? "sensors" : "assets"}
                allowZero={false}
              />
            </Form.Item>
            <Form.Item name="start" label="From (UTC)">
              <Input type="datetime-local" />
            </Form.Item>
            <Form.Item name="end" label="Until (UTC)">
              <Input type="datetime-local" />
            </Form.Item>
            <Form.Item name="filter" label="Readings">
              <Radio.Group
                options={[
                  { label: "Changes", value: "0" },
                  { label: "All", value: "1" },
                ]}
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SearchOutlined />}
              loading={loading}
            >
              Load history
            </Button>
          </div>
        </Form>
      </Card>
      <ErrorNotice error={error} />
      <Card
        title="Readings"
        extra={
          <Typography.Text type="secondary">
            {rows.length} loaded
          </Typography.Text>
        }
      >
        <Table
          rowKey={(r) => String(r.m_nIDSensorHistory)}
          columns={columns}
          dataSource={rows}
          loading={loading}
          pagination={{ pageSize: 25 }}
          scroll={{ x: 650 }}
          locale={{
            emptyText: "Choose a sensor or asset and load its history.",
          }}
        />
        {last?.hasMore && (
          <div className="load-more">
            <Button loading={loading} onClick={next}>
              Load next 100 readings
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
