import { useState } from "react";
import { useList, useOne } from "@refinedev/core";
import {
  Input,
  InputNumber,
  Select,
  Switch,
  Space,
  Button,
  Tabs,
  Alert,
  Typography,
  Tag,
  Tooltip,
} from "antd";
import { ShareAltOutlined } from "@ant-design/icons";
import { TemplateIndicator } from "./template-indicator";
import { VirtualIndicator, VirtualRecordLabel } from "./virtual-indicator";
import { Link } from "react-router";
import {
  canonical,
  fieldLabel,
  recordTitle,
  referenceResource,
  resourceMap,
  translated,
  valueOf,
  type Field,
  type RecordData,
} from "../../shared/resources";
import { useAdmin } from "../context";
import {
  DISPLAY_TIME_ZONE,
  formatDisplayClock,
  formatDisplayDateTime,
} from "../../shared/date-time";
import { hubLastEventTime } from "../../shared/hub-status";
import { sensorLastReadingTime } from "../../shared/sensor-reading";
import { linkedHubAssetIds } from "../../shared/hub-assets";
import {
  millisecondsToSeconds,
  ruleDurationLabels,
} from "../../shared/rule-durations";
import {
  ruleScheduleLabels,
  utcScheduleDate,
} from "../../shared/rule-schedule";
import {
  parseTranslations,
  setTranslation,
  translationLanguage,
  translationText,
} from "../../shared/translations";

export function ReferenceSelect({
  id,
  resource,
  value,
  onChange,
  allowZero = true,
  disabled = false,
  organizationOverride,
}: {
  id?: string;
  resource: string;
  value?: string;
  onChange?: (v: string) => void;
  allowZero?: boolean;
  disabled?: boolean;
  organizationOverride?: string;
}) {
  const { organization, identity, can } = useAdmin();
  const { result, query } = useList<RecordData>({
    resource,
    pagination: { mode: "off" },
    meta: {
      organization:
        organizationOverride ??
        (resource === "organizations" && identity.level >= 90
          ? ""
          : organization),
    },
    queryOptions: { enabled: can(resourceMap[resource], "list") },
    errorNotification: false,
  });
  const rows = (
    can(resourceMap[resource], "list") && !query.isError
      ? (result.data ?? [])
      : []
  ).filter((row) => {
    if (resource !== "usertypes" || identity.level >= 90) return true;
    const level = row.m_nLevel;
    return (
      typeof level === "string" &&
      /^-?\d+$/.test(level) &&
      Number.isSafeInteger(Number(level)) &&
      Number(level) >= -2147483648 &&
      Number(level) <= 2147483647 &&
      Number(level) < identity.level
    );
  });
  const options: { value: string; label: string; virtualTag?: unknown }[] = [
    ...(allowZero && resource !== "usertypes"
      ? [{ value: "0", label: "Unassigned" }]
      : []),
    ...rows.map((row) => {
      const title =
        resource === "organizations"
          ? translated(valueOf(row, "Tag")).trim()
          : recordTitle(row);
      return {
        value: row.id!,
        label: title ? `${title} · ${row.id}` : `ID ${row.id}`,
        virtualTag: valueOf(row, "Tag"),
      };
    }),
    ...(value && value !== "0" && !rows.some((r) => r.id === value)
      ? [{ value, label: `ID ${value}` }]
      : []),
  ];
  return (
    <>
      <Select
        id={id}
        value={value}
        onChange={onChange}
        disabled={disabled}
        options={options}
        optionRender={(option) => (
          <VirtualRecordLabel
            label={option.label}
            tag={option.data.virtualTag}
          />
        )}
        labelRender={({ value: selected, label }) => (
          <VirtualRecordLabel
            label={label ?? String(selected)}
            tag={
              options.find((option) => option.value === selected)?.virtualTag
            }
          />
        )}
        showSearch
        optionFilterProp="label"
        loading={query.isLoading}
        style={{ width: "100%" }}
        status={query.isError ? "error" : undefined}
        placeholder={`Choose ${resourceMap[resource].singular.toLowerCase()}`}
        virtual
      />
      {query.isError && (
        <Typography.Text type="danger">
          Options unavailable.{" "}
          <Button type="link" size="small" onClick={() => query.refetch()}>
            Retry
          </Button>
        </Typography.Text>
      )}
      {result.limited && (
        <Typography.Text type="warning">
          The service returned a limited set of options.
        </Typography.Text>
      )}
    </>
  );
}
function TranslationInput({
  id,
  value = "",
  onChange,
  maxLength,
}: {
  id?: string;
  value?: string;
  onChange?: (v: string) => void;
  maxLength?: number;
}) {
  const messages = parseTranslations(value)?.messages;
  const [multilingual, setMultilingual] = useState(false);
  if (!multilingual && !messages)
    return (
      <Space.Compact style={{ width: "100%" }}>
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          maxLength={maxLength}
        />
        <Button
          onClick={() => {
            setMultilingual(true);
            onChange?.(
              JSON.stringify({
                messages: [
                  { lang: "en", text: value },
                  { lang: "fr", text: "" },
                  { lang: "nl", text: "" },
                ],
              }),
            );
          }}
        >
          Languages
        </Button>
      </Space.Compact>
    );
  const current = messages ?? [{ lang: "en", text: value }];
  return (
    <div className="translation-input">
      <Tabs
        destroyOnHidden
        size="small"
        items={["en", "fr", "nl"].map((lang) => ({
          key: lang,
          label: { en: "English", fr: "French", nl: "Dutch" }[lang],
          children: (
            <Input.TextArea
              id={id}
              aria-label={`${id} (${lang})`}
              autoSize={{ minRows: 2, maxRows: 4 }}
              value={
                translationText(
                  current.find(
                    (entry) =>
                      translationLanguage(entry) === lang &&
                      translationText(entry) !== undefined,
                  ),
                ) ?? ""
              }
              onChange={(e) => {
                onChange?.(setTranslation(value, lang, e.target.value));
              }}
            />
          ),
        }))}
      />
    </div>
  );
}
export function FieldInput({
  field,
  resource,
  value,
  onChange,
}: {
  field: Field;
  resource: string;
  value?: unknown;
  onChange?: (value: unknown) => void;
}) {
  const name = canonical(field.key);
  const target = referenceResource[name];
  if (target)
    return (
      <ReferenceSelect
        id={field.key}
        resource={target}
        value={value == null ? undefined : String(value)}
        onChange={onChange}
        allowZero={!field.minimum || BigInt(field.minimum) <= 0n}
      />
    );
  if (name === "Rights")
    return (
      <Select
        id={field.key}
        mode="multiple"
        value={typeof value === "string" ? [...value] : []}
        onChange={(v) => onChange?.(v.join(""))}
        options={[
          { value: "r", label: "Read" },
          { value: "c", label: "Create" },
          { value: "u", label: "Update" },
          { value: "d", label: "Delete" },
        ]}
      />
    );
  if (field.enum)
    return (
      <Select
        id={field.key}
        value={value == null ? undefined : String(value)}
        onChange={onChange}
        options={field.enum.map((v) => ({
          value: String(v),
          label:
            name === "ValueType"
              ? ((
                  {
                    1: "Boolean",
                    2: "Integer",
                    3: "Time on",
                    4: "Real",
                  } as Record<string, string>
                )[String(v)] ?? String(v))
              : String(v),
        }))}
      />
    );
  if (field.type === "boolean")
    return (
      <Switch
        id={field.key}
        checked={value === true}
        onChange={onChange}
        aria-label={fieldLabel(field.key)}
      />
    );
  if (resource === "rules" && ruleDurationLabels[name])
    return (
      <Input
        id={field.key}
        inputMode="decimal"
        value={value == null ? "" : String(value)}
        onChange={(e) =>
          onChange?.(e.target.value === "" ? undefined : e.target.value)
        }
      />
    );
  if (field.type === "integer" || field.type === "number")
    return (
      <InputNumber
        id={field.key}
        stringMode
        value={value == null ? null : String(value)}
        onChange={(v) => onChange?.(v == null ? undefined : String(v))}
        precision={field.type === "integer" ? 0 : undefined}
        style={{ width: "100%" }}
      />
    );
  if (
    ["Tag", "Label"].includes(name) &&
    ["rules", "actions", "ruletypes"].includes(resource)
  )
    return (
      <TranslationInput
        id={field.key}
        value={String(value ?? "")}
        onChange={onChange}
        maxLength={field.maxLength}
      />
    );
  if (name.startsWith("Time") && !name.includes("24"))
    return (
      <Input
        id={field.key}
        type="time"
        step={resource === "rules" && ruleScheduleLabels[name] ? "0.001" : "1"}
        value={String(value ?? "")}
        onChange={(e) =>
          onChange?.(
            resource === "rules" &&
              ruleScheduleLabels[name] &&
              e.target.value === ""
              ? undefined
              : e.target.value.length === 5
                ? `${e.target.value}:00`
                : e.target.value,
          )
        }
      />
    );
  if (name.startsWith("Dt") || name === "DateNaissance")
    return (
      <Input
        id={field.key}
        type="date"
        value={String(value ?? "").replace(/^0000-00-00$/, "")}
        onChange={(e) => onChange?.(e.target.value)}
      />
    );
  if (/BodyText|Observations/.test(name))
    return (
      <Input.TextArea
        id={field.key}
        autoSize={{ minRows: 3, maxRows: 8 }}
        value={String(value ?? "")}
        onChange={(e) => onChange?.(e.target.value)}
        maxLength={field.maxLength}
        showCount
      />
    );
  return (
    <Input
      id={field.key}
      value={value == null ? "" : String(value)}
      onChange={(e) => onChange?.(e.target.value)}
      maxLength={field.maxLength}
      type={/Email/i.test(name) ? "email" : "text"}
    />
  );
}
export function FieldValue({
  field,
  value,
  primary = false,
}: {
  field: Field;
  value: unknown;
  primary?: boolean;
}) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    /^0000-00-00/.test(String(value))
  )
    return <span className="muted">—</span>;
  const name = canonical(field.key);
  const equipmentType = equipmentTypeReferences[name];
  if (typeof value === "boolean")
    return <Tag color={value ? "cyan" : "default"}>{value ? "Yes" : "No"}</Tag>;
  if (!primary && equipmentType)
    return <ReferenceTag resource={equipmentType} value={value} />;
  if (!primary && referenceResource[name] && String(value) !== "0")
    return (
      <Link to={`/${referenceResource[name]}/${value}`}>#{String(value)}</Link>
    );
  if (typeof value === "object")
    return <pre className="record-value">{JSON.stringify(value, null, 2)}</pre>;
  if (field.type === "integer")
    return <span className="numeric-value">{String(value)}</span>;
  if (name.startsWith("Dt") || name === "DateNaissance") {
    const raw = String(value);
    const parts = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return <span>{parts ? `${parts[3]}/${parts[2]}/${parts[1]}` : raw}</span>;
  }
  if (/^(Dh|Created|Modified|LastLogin|LastLogout)/.test(name)) {
    const raw = String(value);
    // These legacy fields are wall-clock values, rather than UTC instants.
    const localParts = /local datetime/i.test(field.description ?? "")
      ? raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?$/)
      : null;
    return (
      <span title={DISPLAY_TIME_ZONE}>
        {localParts
          ? `${localParts[3]}/${localParts[2]}/${localParts[1]}, ${localParts[4]}${localParts[5] ?? ""}`
          : formatDisplayDateTime(raw)}
      </span>
    );
  }
  return <span className="record-text">{translated(value)}</span>;
}
type TypeResource =
  | "assettypes"
  | "usertypes"
  | "hubtypes"
  | "devicetypes"
  | "sensortypes"
  | "organizationstypes"
  | "actiontypes"
  | "ruletypes";
const equipmentTypeReferences: Partial<Record<string, TypeResource>> = {
  IDAssetType: "assettypes",
  IDHubType: "hubtypes",
  IDDeviceType: "devicetypes",
  IDSensorType: "sensortypes",
  IDActionType: "actiontypes",
  IDRuleType: "ruletypes",
};
const referenceId = (value: unknown) =>
  typeof value === "string"
    ? value
    : typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : "";
const validReferenceId = (id: string) =>
  /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n;
function useReferenceRecord(
  resource:
    TypeResource | "organizations" | "assets" | "devices" | "sensors" | "rules",
  value: unknown,
) {
  const { organization, can } = useAdmin();
  const id = referenceId(value);
  const validId = validReferenceId(id);
  const allowed = can(resourceMap[resource], "show");
  const { result, query } = useOne<RecordData>({
    resource,
    id: validId ? id : "0",
    meta: {
      organization,
      ...(resource === "devices" ? { deviceReference: true } : {}),
      ...(resource === "sensors" ? { sensorReference: true } : {}),
      ...(resource === "rules" ? { ruleReference: true } : {}),
    },
    queryOptions: {
      enabled: allowed && validId,
      meta: {
        equipmentTypeReference: [
          "assettypes",
          "hubtypes",
          "devicetypes",
          "sensortypes",
          "actiontypes",
          "ruletypes",
        ].includes(resource),
        organizationReference: resource === "organizations",
        organizationTypeReference: resource === "organizationstypes",
        userTypeReference: resource === "usertypes",
        assetReference: resource === "assets",
        deviceReference: resource === "devices",
        sensorReference: resource === "sensors",
        ruleReference: resource === "rules",
        organization,
      },
    },
    errorNotification: false,
  });
  const record =
    allowed && validId && !query.isError && result?.id === id
      ? result
      : undefined;
  return { id, allowed, validId, record };
}
export function useSharedHubType(row: RecordData): boolean {
  const { record: type } = useReferenceRecord(
    "hubtypes",
    valueOf(row, "IDHubType"),
  );
  return valueOf(type ?? {}, "IsSingleAsset") === false;
}

export function SharedGatewayIndicator({
  row,
  typeOnly = false,
}: {
  row: RecordData;
  typeOnly?: boolean;
}) {
  const shared = useSharedHubType(row);
  if (!shared && (typeOnly || row._sharedGateway !== true)) return null;
  return (
    <Tooltip title="Shared gateway" trigger={["hover", "focus"]}>
      <span tabIndex={0} data-no-row-navigation>
        <ShareAltOutlined
          aria-label="Shared gateway"
          style={{ color: "#1677ff" }}
        />
      </span>
    </Tooltip>
  );
}

function ReferenceIdentity({
  resource,
  value,
  showId = true,
}: {
  resource: "organizations" | "assets" | "rules";
  value: unknown;
  showId?: boolean;
}) {
  const { id, record } = useReferenceRecord(resource, value);
  if (value === null || value === undefined || value === "")
    return <span className="muted">—</span>;
  return (
    <div className="record-identity">
      {record && <VirtualIndicator value={valueOf(record, "Tag")} />}
      {record && (
        <>
          <Link to={`/${resource}/${id}`}>
            {translated(valueOf(record, "Tag")) || "—"}
          </Link>
          <Link to={`/${resource}/${id}`}>
            {translated(valueOf(record, "Label")) || "—"}
          </Link>
        </>
      )}
      {(showId || !record) && <span>#{String(value)}</span>}
      {resource === "rules" && record && (
        <TemplateIndicator
          resource="rules"
          value={valueOf(record, "IsTemplate")}
        />
      )}
    </div>
  );
}
export function OrganizationIdentity({ value }: { value: unknown }) {
  return <ReferenceIdentity resource="organizations" value={value} />;
}
export function AssetIdentity({
  value,
  showId = true,
}: {
  value: unknown;
  showId?: boolean;
}) {
  return <ReferenceIdentity resource="assets" value={value} showId={showId} />;
}
export function HubAssetIdentity({
  row,
  showId = true,
  linkedDevices,
}: {
  row: RecordData;
  showId?: boolean;
  linkedDevices?: ReturnType<typeof useList<RecordData>>;
}) {
  const { organization, can } = useAdmin();
  const shared = useSharedHubType(row);
  const hubId = referenceId(row.id);
  const hubOrganization = referenceId(valueOf(row, "IDOrganization"));
  const allowed =
    can(resourceMap.devices, "list") && can(resourceMap.assets, "show");
  const enabled =
    shared &&
    allowed &&
    validReferenceId(hubId) &&
    (!organization || organization === hubOrganization) &&
    (hubOrganization === "0" || validReferenceId(hubOrganization));
  const ownDevices = useList<RecordData>({
    resource: "devices",
    filters: [{ field: "idhub", operator: "eq", value: hubId }],
    pagination: { mode: "off" },
    meta: { organization },
    errorNotification: false,
    queryOptions: {
      enabled: enabled && !linkedDevices,
      meta: { hubAssetCount: !linkedDevices, organization },
    },
  });
  const { result, query } = linkedDevices ?? ownDevices;
  if (!shared)
    return <AssetIdentity value={valueOf(row, "IDAsset")} showId={showId} />;
  if (!enabled || query.isError || query.isPlaceholderData || !query.isSuccess)
    return (
      <span className="muted" title="Linked asset count unavailable">
        {enabled && query.isPending ? "…" : "—"}
      </span>
    );
  const assets = linkedHubAssetIds(row, result.data);
  return (
    <span
      className="numeric-value"
      title={
        result.limited
          ? "Linked assets (the device list is limited)"
          : "Linked assets"
      }
    >
      ({assets.length}
      {result.limited ? "+" : ""})
    </span>
  );
}
export function RuleIdentity({ value }: { value: unknown }) {
  return <ReferenceIdentity resource="rules" value={value} />;
}
export function DeviceIdentity({ value }: { value: unknown }) {
  const {
    id,
    allowed,
    validId,
    record: device,
  } = useReferenceRecord("devices", value);
  const { record: deviceType } = useReferenceRecord(
    "devicetypes",
    device ? valueOf(device, "IDDeviceType") : undefined,
  );
  if (value === null || value === undefined || value === "")
    return <span className="muted">—</span>;
  if (String(value) === "0") return <span className="numeric-value">0</span>;
  const tag = deviceType ? translated(valueOf(deviceType, "Tag")) : "";
  const hasTag = typeof tag === "string" && !!tag.trim();
  const deviceLink = `/devices/${id}`;
  return (
    <div className="record-identity">
      {device && <VirtualIndicator value={valueOf(device, "Tag")} />}
      {hasTag && (
        <Link to={deviceLink} title={`Device #${id}`}>
          {tag}
        </Link>
      )}
      {allowed && validId && !hasTag ? (
        <Link to={deviceLink}>#{String(value)}</Link>
      ) : (
        <span>#{String(value)}</span>
      )}
    </div>
  );
}
export function SensorTypeTag({ value }: { value: unknown }) {
  const {
    id,
    allowed,
    validId,
    record: sensor,
  } = useReferenceRecord("sensors", value);
  const { record: sensorType } = useReferenceRecord(
    "sensortypes",
    sensor ? valueOf(sensor, "IDSensorType") : undefined,
  );
  if (value === null || value === undefined || value === "")
    return <span className="muted">—</span>;
  if (String(value) === "0") return <span className="numeric-value">0</span>;
  const tag = sensorType ? translated(valueOf(sensorType, "Tag")) : "";
  const label =
    typeof tag === "string" && tag.trim() ? tag : `#${String(value)}`;
  return (
    <Space size={6} wrap>
      {allowed && validId ? (
        <Link to={`/sensors/${id}`} title={`Sensor #${id}`}>
          {label}
        </Link>
      ) : (
        <span>{label}</span>
      )}
      {sensor && <VirtualIndicator value={valueOf(sensor, "Tag")} />}
    </Space>
  );
}
export function SensorHistoryIdentity({ row }: { row: RecordData }) {
  const { can } = useAdmin();
  const { record: sensorType } = useReferenceRecord(
    "sensortypes",
    valueOf(row, "IDSensorType"),
  );
  const rawSensorId = valueOf(row, "IDSensor");
  const sensorId = referenceId(rawSensorId);
  const canOpen =
    validReferenceId(sensorId) && can(resourceMap.sensors, "show");
  const names = sensorType
    ? ["Tag", "Label"].map(
        (name) => translated(valueOf(sensorType, name)) || "—",
      )
    : [];
  return (
    <div className="record-identity">
      <VirtualIndicator value={valueOf(row, "Tag")} />
      {names.map((name, index) =>
        canOpen ? (
          <Link
            key={index}
            to={`/sensors/${sensorId}`}
            title={`Sensor #${sensorId}`}
          >
            {name}
          </Link>
        ) : (
          <div key={index} className="record-name">
            {name}
          </div>
        ),
      )}
      <span>
        {rawSensorId === null || rawSensorId === undefined || rawSensorId === ""
          ? "—"
          : `#${String(rawSensorId)}`}
      </span>
    </div>
  );
}
export function ReferenceTag({
  resource,
  value,
  showId = false,
}: {
  resource: TypeResource | "organizations" | "assets";
  value: unknown;
  showId?: boolean;
}) {
  const { id, allowed, validId, record } = useReferenceRecord(resource, value);
  if (value === null || value === undefined || value === "")
    return <span className="muted">—</span>;
  const tag = record ? translated(valueOf(record, "Tag")) : "";
  if (String(value) === "0") return <span className="numeric-value">0</span>;
  const label =
    typeof tag === "string" && tag.trim()
      ? showId
        ? `${tag} (#${id})`
        : tag
      : `#${String(value)}`;
  return (
    <Space size={6} wrap>
      {allowed && validId ? (
        <Link
          to={`/${resource}/${id}`}
          title={`${resourceMap[resource].singular} #${id}`}
        >
          {label}
        </Link>
      ) : (
        <span>{label}</span>
      )}
      {record && <VirtualIndicator value={valueOf(record, "Tag")} />}
    </Space>
  );
}
export function SensorCurrentValue({ row }: { row: RecordData }) {
  return <SensorReadingValue row={row} />;
}
function LocalEventTime({ timestamp }: { timestamp: number | null }) {
  if (timestamp === null) return <span className="muted">—</span>;
  const date = new Date(timestamp);
  return (
    <time
      className="numeric-value"
      dateTime={date.toISOString()}
      title={DISPLAY_TIME_ZONE}
    >
      {formatDisplayDateTime(date)}
    </time>
  );
}
export function AssetLastEvent({ value }: { value: unknown }) {
  // Current Assets event timestamps use UTC, including legacy values without a zone.
  return <LocalEventTime timestamp={hubLastEventTime(value)} />;
}
export function UserDateTime({ value }: { value: unknown }) {
  // Users timestamps are UTC even when the wire value omits the timezone suffix.
  return <LocalEventTime timestamp={hubLastEventTime(value)} />;
}
export function RuleDurationSeconds({ value }: { value: unknown }) {
  const seconds = millisecondsToSeconds(value);
  if (seconds === undefined) return <span className="muted">—</span>;
  return (
    <span className="numeric-value" title={`${String(value)} milliseconds`}>
      {seconds}
    </span>
  );
}
export function RuleScheduleTime({ value }: { value: unknown }) {
  const date = utcScheduleDate(value, new Date());
  if (!date) return <span className="muted">—</span>;
  const localDate = formatDisplayDateTime(date, {
    timeZoneName: "shortOffset",
  });
  return (
    <time
      className="numeric-value"
      dateTime={date.toISOString()}
      title={`${DISPLAY_TIME_ZONE}: ${localDate}`}
    >
      {formatDisplayClock(date, {
        ...(date.getUTCMilliseconds() ? { fractionalSecondDigits: 3 } : {}),
      })}
    </time>
  );
}
export function SensorLastReading({ row }: { row: RecordData }) {
  return (
    <LocalEventTime
      timestamp={sensorLastReadingTime(valueOf(row, "DhLastEvent"))}
    />
  );
}
export function SensorHistoryValue({ row }: { row: RecordData }) {
  return <SensorReadingValue row={row} history />;
}
function SensorReadingValue({
  row,
  history = false,
}: {
  row: RecordData;
  history?: boolean;
}) {
  const { record: sensorType } = useReferenceRecord(
    "sensortypes",
    valueOf(row, "IDSensorType"),
  );
  const valueType = sensorType ? String(valueOf(sensorType, "ValueType")) : "";
  const boolean = valueOf(row, "ValueBool");
  const integer = valueOf(row, "ValueInt");
  const real = valueOf(row, "ValueReal");
  const present = (value: unknown) =>
    value !== null && value !== undefined && value !== "";
  const renderValue = (name: string, value: unknown) =>
    history && name === "ValueBool" && typeof value === "boolean" ? (
      <Tag color={value ? "cyan" : "default"}>{value ? "True" : "False"}</Tag>
    ) : (
      <FieldValue
        field={resourceMap.sensors.fields.find(
          (f) => canonical(f.key) === name,
        )!}
        value={value}
      />
    );
  if (valueType === "1") return renderValue("ValueBool", boolean);
  if (valueType === "2") return renderValue("ValueInt", integer);
  if (valueType === "3")
    return (
      <span>
        {typeof boolean === "boolean" ? (boolean ? "On" : "Off") : "—"}
        {" · "}
        {renderValue("ValueInt", integer)}
        {present(integer) && " s"}
      </span>
    );
  if (valueType === "4") return renderValue("ValueReal", real);
  if (history)
    return (
      <span
        className="muted"
        title={
          sensorType
            ? "Unsupported sensor value type"
            : "Sensor type unavailable"
        }
      >
        —
      </span>
    );
  const values = [
    { name: "ValueBool", label: "Boolean", value: boolean },
    { name: "ValueInt", label: "Integer", value: integer },
    { name: "ValueReal", label: "Real", value: real },
  ].filter(({ value }) => present(value));
  if (!values.length) return <span className="muted">—</span>;
  return (
    <Space direction="vertical" size={0}>
      {values.map(({ name, label, value }) => (
        <span key={name}>
          {label}: {renderValue(name, value)}
        </span>
      ))}
    </Space>
  );
}
export const ErrorNotice = ({
  error,
  retry,
}: {
  error?: { message?: string } | null;
  retry?: () => void;
}) =>
  error ? (
    <Alert
      type="error"
      showIcon
      message={error.message ?? "This view could not be loaded."}
      className="page-alert"
      action={
        retry ? (
          <Button size="small" onClick={retry}>
            Retry
          </Button>
        ) : undefined
      }
    />
  ) : null;
