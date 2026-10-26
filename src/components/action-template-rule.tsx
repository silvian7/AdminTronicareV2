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
import { VirtualRecordLabel } from "./virtual-indicator";

export function ActionTemplateRule({
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
  const allowed = can(resourceMap.rules, "list");
  const validAsset =
    typeof assetId === "string" &&
    /^[1-9]\d{0,18}$/.test(assetId) &&
    BigInt(assetId) <= 9223372036854775807n;
  const rules = useList<RecordData>({
    resource: "rules",
    filters: [
      { field: "idasset", operator: "eq", value: assetId },
      { field: "istemplate", operator: "eq", value: false },
    ],
    pagination: { mode: "off" },
    meta: { organization },
    errorNotification: false,
    queryOptions: { enabled: allowed && validAsset },
  });
  const rows =
    allowed && validAsset && !rules.query.isError
      ? rules.result.data.filter(
          (row) =>
            valueOf(row, "IDAsset") === assetId &&
            valueOf(row, "IsTemplate") === false &&
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
        loading={validAsset && rules.query.isFetching}
        showSearch
        optionFilterProp="label"
        placeholder={validAsset ? "Choose rule" : "Choose an asset first"}
        options={rows.map((row) => ({
          value: row.id!,
          label: `${recordTitle(row)} · ${row.id}`,
          virtualTag: valueOf(row, "Tag"),
        }))}
        optionRender={(option) => (
          <VirtualRecordLabel
            label={option.label}
            tag={option.data.virtualTag}
          />
        )}
        labelRender={({ value: selected, label }) => (
          <VirtualRecordLabel
            label={label ?? String(selected)}
            tag={valueOf(rows.find((row) => row.id === selected) ?? {}, "Tag")}
          />
        )}
        style={{ width: "100%" }}
      />
      {!allowed && (
        <Typography.Text type="danger">
          Rule read permission is required to choose a destination.
        </Typography.Text>
      )}
      <ErrorNotice
        error={rules.query.error}
        retry={() => void rules.query.refetch()}
      />
      {rules.result.limited && (
        <Typography.Text type="warning">
          The service returned a limited set of rules.
        </Typography.Text>
      )}
    </>
  );
}
