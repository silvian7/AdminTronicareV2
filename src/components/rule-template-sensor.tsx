import { useList } from "@refinedev/core";
import { Select, Typography } from "antd";
import {
  recordTitle,
  resourceMap,
  valueOf,
  type RecordData,
} from "../../shared/resources";
import { useAdmin } from "../context";
import { ErrorNotice } from "./fields";

export function RuleTemplateSensor({
  id,
  assetId,
  value,
  onChange,
  disabled = false,
}: {
  id?: string;
  assetId?: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}) {
  const { organization, can } = useAdmin();
  const allowed = can(resourceMap.sensors, "list");
  const validAsset =
    typeof assetId === "string" &&
    /^[1-9]\d{0,18}$/.test(assetId) &&
    BigInt(assetId) <= 9223372036854775807n;
  const sensors = useList<RecordData>({
    resource: "sensors",
    filters: [{ field: "idasset", operator: "eq", value: assetId }],
    pagination: { mode: "off" },
    meta: { organization },
    errorNotification: false,
    queryOptions: { enabled: allowed && validAsset },
  });
  const rows =
    allowed && validAsset && !sensors.query.isError
      ? sensors.result.data.filter(
          (row) =>
            valueOf(row, "IDAsset") === assetId &&
            typeof row.id === "string" &&
            /^[1-9]\d{0,18}$/.test(row.id) &&
            BigInt(row.id) <= 9223372036854775807n,
        )
      : [];
  return (
    <>
      <Select
        id={id}
        value={value}
        onChange={onChange}
        disabled={disabled || !allowed || !validAsset}
        loading={validAsset && sensors.query.isFetching}
        showSearch
        optionFilterProp="label"
        placeholder={validAsset ? "Choose sensor" : "Choose an asset first"}
        options={rows.map((row) => ({
          value: row.id!,
          label: `${recordTitle(row)} · ${row.id}`,
        }))}
        style={{ width: "100%" }}
      />
      {!allowed && (
        <Typography.Text type="danger">
          Sensor read permission is required to choose a destination.
        </Typography.Text>
      )}
      <ErrorNotice
        error={sensors.query.error}
        retry={() => void sensors.query.refetch()}
      />
      {sensors.result.limited && (
        <Typography.Text type="warning">
          The service returned a limited set of sensors.
        </Typography.Text>
      )}
    </>
  );
}
