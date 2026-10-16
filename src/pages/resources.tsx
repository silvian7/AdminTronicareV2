import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDefaultSortOrder, useTable } from "@refinedev/antd";
import { focusManager, useQueryClient } from "@tanstack/react-query";
import {
  useList,
  useOne,
  useCreate,
  useUpdate,
  useDelete,
  useInvalidate,
  type HttpError,
  type CrudFilter,
} from "@refinedev/core";
import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Result,
  Row,
  Select,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SaveOutlined,
  FilterOutlined,
} from "@ant-design/icons";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
  useBlocker,
} from "react-router";
import {
  canonical,
  editableFields,
  fieldLabel,
  hiddenField,
  recordTitle,
  referenceResource,
  resourceMap,
  responseKey,
  translated,
  valueOf,
  type Field,
  type Resource,
  type RecordData,
  type AssetAssignmentKind,
} from "../../shared/resources";
import { useAdmin } from "../context";
import {
  ErrorNotice,
  AssetIdentity,
  AssetLastEvent,
  DeviceIdentity,
  FieldInput,
  FieldValue,
  OrganizationIdentity,
  ReferenceSelect,
  SensorCurrentValue,
  SensorLastReading,
  SensorTypeTag,
  ReferenceTag,
  RuleIdentity,
  RuleDurationSeconds,
  RuleScheduleTime,
  UserDateTime,
} from "../components/fields";
import { getSessionEpoch, request } from "../api";
import { HubStatus } from "../components/hub-status";
import { useRecordRow } from "../components/record-row";
import {
  millisecondsToSeconds,
  ruleDurationLabels,
  secondsToMilliseconds,
} from "../../shared/rule-durations";
import {
  localTimeToUtc,
  ruleScheduleLabels,
  utcTimeToLocal,
} from "../../shared/rule-schedule";

function validateRuleDuration(field: Field, value: unknown): Promise<void> {
  if (value === undefined || value === null || value === "")
    return Promise.resolve();
  const milliseconds = secondsToMilliseconds(value);
  if (milliseconds === undefined)
    return Promise.reject(
      new Error("Enter seconds with at most 3 decimal places."),
    );
  if (
    (field.minimum !== undefined &&
      BigInt(milliseconds) < BigInt(field.minimum)) ||
    (field.maximum !== undefined &&
      BigInt(milliseconds) > BigInt(field.maximum))
  )
    return Promise.reject(
      new Error(
        `Enter a value from ${millisecondsToSeconds(field.minimum)} to ${millisecondsToSeconds(field.maximum)} seconds.`,
      ),
    );
  return Promise.resolve();
}
const queryLabels: Record<string, string> = {
  idasset: "Asset ID",
  idorganization: "Organization ID",
  iduser: "User ID",
  idusergroup: "Group ID",
  idhub: "Hub ID",
  iddevice: "Device ID",
  idsensor: "Sensor ID",
  idrule: "Rule ID",
  idaction: "Action ID",
  istemplate: "Templates",
  isread: "Read status",
  fromdate: "From date",
  todate: "To date",
  serialnr: "Serial number",
  levelmin: "Minimum level",
  levelmax: "Maximum level",
  includeusergroups: "Include groups",
  idusertype: "User type ID",
};
function PageHeading({
  resource,
  title,
  extra,
  subtitle,
}: {
  resource: Resource;
  title: string;
  extra?: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{resource.group.toUpperCase()}</span>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <Space wrap>{extra}</Space>
    </div>
  );
}
function displayedField(resource: Resource, field: Field) {
  return (
    !hiddenField(field.key) &&
    !(
      ["actions", "rules"].includes(resource.name) &&
      canonical(field.key) === "Level"
    )
  );
}
function selectedColumns(resource: Resource) {
  const priority = [
    "Label",
    "Tag",
    ...(resource.name === "organizations" ? ["IDOrganizationType"] : []),
    "Login",
    "First_name",
    "Last_name",
    "SerialNr",
    "IDHubType",
    "IDDeviceType",
    "IDSensorType",
    ...(resource.name === "actions" ? ["IDActionType"] : []),
    ...(resource.name === "rules" ? ["IDRuleType"] : []),
    "IDOrganization",
    "IDAsset",
    "IDHub",
    "IDDevice",
    "IDUserType",
    "Rights",
    "ValueBool",
    "ValueInt",
    "ValueReal",
    "DhLastEvent",
    "Enabled",
    "PauseRules",
    "Level",
    ...(resource.name === "rules" ? ["Output"] : []),
    "IsRead",
    "IsAck",
    "ResultSuccess",
    ...(resource.name === "organizations" ? [] : ["Kind"]),
    "Data",
    "dhCreated",
  ];
  return priority
    .flatMap((name) =>
      resource.fields.filter(
        (f) =>
          canonical(f.key) === name &&
          f.key !== resource.primaryKey &&
          displayedField(resource, f),
      ),
    )
    .slice(0, resource.name === "devices" ? 8 : 7);
}
const equipmentTypeResources: Partial<Record<string, string>> = {
  assets: "assettypes",
  hubs: "hubtypes",
  devices: "devicetypes",
  sensors: "sensortypes",
  actions: "actiontypes",
  rules: "ruletypes",
};
const organizationIdentityResources = new Set([
  "assets",
  "users",
  "usergroups",
  "hubs",
  "devices",
]);
const assetIdentityResources = new Set([
  "hubs",
  "sensors",
  "devices",
  "rules",
  "actions",
]);
function useRefreshRecordReferences(resource: string) {
  const { organization, can } = useAdmin();
  const invalidate = useInvalidate();
  return useCallback(async () => {
    const references: { resource: string; marker: string }[] = [];
    if (organizationIdentityResources.has(resource))
      references.push({
        resource: "organizations",
        marker: "organizationReference",
      });
    if (resource === "organizations")
      references.push({
        resource: "organizationstypes",
        marker: "organizationTypeReference",
      });
    if (resource === "users")
      references.push({ resource: "usertypes", marker: "userTypeReference" });
    if (assetIdentityResources.has(resource))
      references.push({ resource: "assets", marker: "assetReference" });
    if (resource === "sensors")
      references.push(
        { resource: "devices", marker: "deviceReference" },
        { resource: "devicetypes", marker: "equipmentTypeReference" },
      );
    if (resource === "rules")
      references.push(
        { resource: "sensors", marker: "sensorReference" },
        { resource: "sensortypes", marker: "equipmentTypeReference" },
      );
    if (resource === "actions")
      references.push({ resource: "rules", marker: "ruleReference" });
    const equipmentTypeResource = equipmentTypeResources[resource];
    if (equipmentTypeResource)
      references.push({
        resource: equipmentTypeResource,
        marker: "equipmentTypeReference",
      });
    await Promise.all(
      references
        .filter((reference) => can(resourceMap[reference.resource], "show"))
        .map((reference) =>
          invalidate({
            resource: reference.resource,
            invalidates: ["resourceAll"],
            invalidationFilters: {
              predicate: ({ meta }) =>
                meta?.[reference.marker] === true &&
                meta?.organization === organization,
            },
          }),
        ),
    );
  }, [resource, organization, can, invalidate]);
}
export function ResourceList({ resource }: { resource: Resource }) {
  const { organization, can } = useAdmin();
  const recordRow = useRecordRow(resource.name);
  const canViewDeviceSensors =
    resource.name === "devices" &&
    can(resource, "show") &&
    can(resourceMap.sensors, "list");
  const refreshRecordReferences = useRefreshRecordReferences(resource.name);
  const navigate = useNavigate();
  const [showFilters, setShowFilters] = useState(false);
  const [statusNow, setStatusNow] = useState(() => Date.now());
  useEffect(() => {
    if (!["assets", "hubs", "devices"].includes(resource.name)) return;
    setStatusNow(Date.now());
    const timer = window.setInterval(() => setStatusNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [resource.name]);
  const {
    tableProps,
    tableQuery,
    filters,
    sorters,
    setFilters,
    setCurrentPage,
    result,
  } = useTable<RecordData>({
    resource: resource.name,
    pagination: { pageSize: 25 },
    meta: { organization },
    syncWithLocation: true,
    errorNotification: false,
    queryOptions: {
      enabled: can(resource, "list"),
      refetchOnWindowFocus: "always",
    },
  });
  useEffect(
    () =>
      focusManager.subscribe((focused) => {
        if (!focused || !can(resource, "list")) return;
        setStatusNow(Date.now());
        void refreshRecordReferences();
      }),
    [resource, can, refreshRecordReferences],
  );
  useEffect(() => {
    if (!can(resource, "list")) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setStatusNow(Date.now());
      void tableQuery.refetch({ cancelRefetch: false });
      void refreshRecordReferences();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [resource, can, tableQuery.refetch, refreshRecordReferences]);
  const active = (key: string) =>
    filters.find(
      (f): f is CrudFilter & { field: string; value: unknown } =>
        "field" in f && f.field === key,
    )?.value;
  const filter = (key: string, value: unknown) => {
    if (String(active(key) ?? "") === String(value ?? "")) return;
    setFilters([{ field: key, operator: "eq", value }], "merge");
    setCurrentPage(1);
  };
  const activeSearch = String(active("_q") ?? "");
  const [search, setSearch] = useState(activeSearch);
  useEffect(() => setSearch(activeSearch), [activeSearch]);
  const [filterDrafts, setFilterDrafts] = useState<Record<string, string>>({});
  const appliedFilterValues = JSON.stringify(
    resource.query.map((field) => [field.key, String(active(field.key) ?? "")]),
  );
  useEffect(() => setFilterDrafts({}), [appliedFilterValues]);
  const columns = useMemo(
    () => [
      ...(["sensors", "devices"].includes(resource.name)
        ? [
            {
              title: "ID",
              key: "id",
              dataIndex: "id",
              width: 180,
              render: (id: string) =>
                resource.name === "devices" ? (
                  <Link to={`/devices/${id}`}>{id}</Link>
                ) : (
                  id
                ),
            },
          ]
        : [
            {
              title: resource.singular,
              key: "record",
              width: 240,
              render: (_: unknown, row: RecordData) => {
                const tag = ["assets", "organizations"].includes(resource.name)
                  ? translated(valueOf(row, "Tag"))
                  : "";
                const label = translated(valueOf(row, "Label"));
                const path = `/${resource.name}/${row.id}`;
                return (
                  <div className="record-identity">
                    {tag ? (
                      <>
                        <Link to={path}>{tag}</Link>
                        {label && <Link to={path}>{label}</Link>}
                      </>
                    ) : (
                      <Link to={path}>{recordTitle(row)}</Link>
                    )}
                    <span>#{row.id}</span>
                  </div>
                );
              },
            },
          ]
      ).filter(
        (column) => resource.name !== "users" || column.key !== "record",
      ),
      ...(["assets", "hubs", "devices"].includes(resource.name)
        ? [
            {
              title: "Status",
              key: "status",
              dataIndex: "status",
              width: 80,
              sorter: true,
              defaultSortOrder: getDefaultSortOrder("status", sorters),
              render: (_: unknown, row: RecordData) => (
                <HubStatus
                  value={valueOf(row, "DhLastEvent")}
                  now={statusNow}
                />
              ),
            },
          ]
        : []),
      ...selectedColumns(resource)
        .filter((f) => !["Label", "Tag"].includes(canonical(f.key)))
        .map((f) => ({
          title:
            (resource.name === "actions" &&
              canonical(f.key) === "IDActionType") ||
            (resource.name === "rules" && canonical(f.key) === "IDRuleType")
              ? "Type"
              : fieldLabel(f.key),
          dataIndex: f.key,
          key: f.key,
          sorter: true,
          ellipsis: !(
            (organizationIdentityResources.has(resource.name) &&
              canonical(f.key) === "IDOrganization") ||
            (assetIdentityResources.has(resource.name) &&
              canonical(f.key) === "IDAsset") ||
            (resource.name === "sensors" && canonical(f.key) === "IDDevice") ||
            (resource.name === "actions" &&
              canonical(f.key) === "IDActionType") ||
            (resource.name === "rules" && canonical(f.key) === "IDRuleType")
          ),
          render: (value: unknown) =>
            resource.name === "usergroups" &&
            canonical(f.key) === "IDOrganization" ? (
              <ReferenceTag resource="organizations" value={value} />
            ) : organizationIdentityResources.has(resource.name) &&
              canonical(f.key) === "IDOrganization" ? (
              <OrganizationIdentity value={value} />
            ) : resource.name === "assets" &&
              canonical(f.key) === "DhLastEvent" ? (
              <AssetLastEvent value={value} />
            ) : assetIdentityResources.has(resource.name) &&
              canonical(f.key) === "IDAsset" ? (
              <AssetIdentity value={value} />
            ) : resource.name === "sensors" &&
              canonical(f.key) === "IDDevice" ? (
              <DeviceIdentity value={value} />
            ) : resource.name === "organizations" &&
              canonical(f.key) === "IDOrganizationType" ? (
              <ReferenceTag resource="organizationstypes" value={value} />
            ) : resource.name === "users" &&
              canonical(f.key) === "IDUserType" ? (
              <ReferenceTag resource="usertypes" value={value} />
            ) : (
              <FieldValue field={f} value={value} />
            ),
        })),
      ...(canViewDeviceSensors
        ? [
            {
              title: "",
              key: "sensors",
              width: 120,
              render: (_: unknown, row: RecordData) => (
                <Link to={`/devices/${row.id}?tab=sensors`}>View sensors</Link>
              ),
            },
          ]
        : []),
    ],
    [resource, canViewDeviceSensors, statusNow, sorters],
  );
  if (!can(resource, "list"))
    return <Result status="403" title="Access unavailable" />;
  return (
    <>
      <PageHeading
        resource={resource}
        title={resource.label}
        subtitle={`Browse and manage ${resource.label.toLowerCase()}.`}
        extra={
          <>
            <Button
              icon={<ReloadOutlined />}
              onClick={async () => {
                await tableQuery.refetch();
                await refreshRecordReferences();
              }}
              loading={tableQuery.isFetching}
            >
              Refresh
            </Button>
            {can(resource, "create") && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => navigate(`/${resource.name}/new`)}
              >
                Add {resource.singular.toLowerCase()}
              </Button>
            )}
          </>
        }
      />
      <ErrorNotice
        error={tableQuery.error}
        retry={() => tableQuery.refetch()}
      />
      {!tableQuery.error && result.limited && (
        <Alert
          className="page-alert"
          showIcon
          type="warning"
          message="The service returned a limited collection. Search and totals apply to the loaded records; narrow the service filters to find additional records."
        />
      )}
      <Card className="table-card">
        <div className="table-toolbar">
          <Input.Search
            aria-label={`Search ${resource.label.toLowerCase()}`}
            placeholder={`Search ${resource.label.toLowerCase()}`}
            allowClear
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value) filter("_q", "");
            }}
            onSearch={(v) => filter("_q", v)}
            prefix={<SearchOutlined />}
            style={{ maxWidth: 360 }}
          />
          <Space>
            <Typography.Text type="secondary">
              {tableQuery.error
                ? "Results unavailable"
                : `${result.total ?? 0} loaded matches`}
            </Typography.Text>
            {resource.query.some(
              (f) => !["limit", "offset", "reverseorder"].includes(f.key),
            ) && (
              <Button
                icon={<FilterOutlined />}
                onClick={() => setShowFilters(!showFilters)}
              >
                Filters
              </Button>
            )}
          </Space>
        </div>
        {showFilters && (
          <div className="filter-grid">
            {resource.query
              .filter(
                (f) => !["limit", "offset", "reverseorder"].includes(f.key),
              )
              .map((field) => (
                <label key={field.key}>
                  {queryLabels[field.key] ?? field.key}
                  {["istemplate", "isread", "includeusergroups"].includes(
                    field.key,
                  ) ? (
                    <Select
                      allowClear
                      value={active(field.key) as string | undefined}
                      onChange={(v) => filter(field.key, v)}
                      options={[
                        { value: "true", label: "Yes" },
                        { value: "false", label: "No" },
                      ]}
                      placeholder="Any"
                    />
                  ) : (
                    <Input
                      value={
                        filterDrafts[field.key] ??
                        String(active(field.key) ?? "")
                      }
                      onChange={(e) => {
                        const value = e.target.value;
                        setFilterDrafts((drafts) => ({
                          ...drafts,
                          [field.key]: value,
                        }));
                      }}
                      placeholder="Any"
                      onBlur={(e) => filter(field.key, e.target.value)}
                      onPressEnter={(e) =>
                        filter(field.key, e.currentTarget.value)
                      }
                    />
                  )}
                </label>
              ))}
            <Button
              onClick={() => {
                setFilters([], "replace");
                setFilterDrafts({});
                setSearch("");
                setCurrentPage(1);
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
        {!tableQuery.error && (
          <Table
            {...tableProps}
            rowKey="id"
            onRow={recordRow}
            columns={columns}
            scroll={{ x: 950 }}
            size="middle"
            pagination={{
              ...tableProps.pagination,
              showSizeChanger: true,
              pageSizeOptions: [10, 25, 50, 100],
            }}
            locale={{
              emptyText: (
                <Empty
                  description={`No ${resource.label.toLowerCase()} match this view.`}
                />
              ),
            }}
          />
        )}
      </Card>
    </>
  );
}
function AddGroupMember({
  groupId,
  organization,
  members,
  disabled,
  saving,
  onAdd,
}: {
  groupId: string;
  organization: string;
  members: RecordData[];
  disabled: boolean;
  saving: boolean;
  onAdd: (userId: string) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<string>();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { result, query } = useList<RecordData>({
    resource: "users",
    pagination: { mode: "off" },
    meta: { organization },
    errorNotification: false,
  });
  const candidates = (query.isError ? [] : (result.data ?? [])).filter(
    (user) =>
      valueOf(user, "IDOrganization") === organization &&
      valueOf(user, "Deleted") !== true &&
      !members.some((member) => member.id === user.id),
  );
  const canAdd =
    !!selected &&
    candidates.some((user) => user.id === selected) &&
    !disabled &&
    !saving &&
    !query.isFetching &&
    !query.isError;
  async function addMember() {
    if (!canAdd || !selected) return;
    const epoch = getSessionEpoch();
    const added = await onAdd(selected);
    if (added && mounted.current && getSessionEpoch() === epoch)
      setSelected(undefined);
  }
  return (
    <>
      <ErrorNotice error={query.error} retry={() => query.refetch()} />
      <div className="membership-add group-member-add">
        <div style={{ flex: 1 }}>
          <label htmlFor={`group-${groupId}-member`}>User to add</label>
          <Select
            id={`group-${groupId}-member`}
            value={selected}
            onChange={setSelected}
            options={candidates.map((user) => ({
              value: user.id!,
              label: `${recordTitle(user)} · ${user.id}`,
            }))}
            showSearch
            optionFilterProp="label"
            placeholder="Choose user"
            loading={query.isFetching}
            disabled={disabled || saving || query.isFetching || query.isError}
            style={{ width: "100%" }}
          />
          {result.limited && (
            <Typography.Text type="warning">
              The service returned a limited set of users.
            </Typography.Text>
          )}
        </div>
        <Button
          type="primary"
          aria-label="Add member"
          aria-busy={saving}
          loading={saving}
          disabled={!canAdd}
          onClick={addMember}
        >
          Add member
        </Button>
      </div>
    </>
  );
}
function RelatedList({
  resource,
  filterName,
  filterValue,
  memberOrganization,
  memberGroupLabel,
}: {
  resource: string;
  filterName: string;
  filterValue: string;
  memberOrganization?: string;
  memberGroupLabel?: string;
}) {
  const { organization, can } = useAdmin();
  const recordRow = useRecordRow(resource);
  const r = resourceMap[resource];
  const groupMembers = resource === "users" && filterName === "idusergroup";
  const validMemberOrganization =
    typeof memberOrganization === "string" &&
    /^(0|[1-9]\d{0,18})$/.test(memberOrganization) &&
    BigInt(memberOrganization) <= 9223372036854775807n;
  const identifyById =
    resource === "devices" ||
    (resource === "users" &&
      ["idorganization", "idusergroup"].includes(filterName));
  const { modal, message } = App.useApp();
  const invalidate = useInvalidate();
  const [membershipSaving, setMembershipSaving] = useState(false);
  const [membershipError, setMembershipError] = useState("");
  const membershipBusy = useRef<symbol | null>(null);
  const membershipMounted = useRef(false);
  const membershipConfirmation = useRef<{ destroy: () => void } | null>(null);
  const membershipView = `${resource}:${filterName}:${filterValue}:${memberOrganization}:${organization}`;
  const currentMembershipView = useRef(membershipView);
  currentMembershipView.current = membershipView;
  useEffect(() => {
    membershipMounted.current = true;
    return () => {
      membershipMounted.current = false;
      membershipConfirmation.current?.destroy();
    };
  }, []);
  useEffect(() => {
    membershipConfirmation.current?.destroy();
    membershipConfirmation.current = null;
    membershipBusy.current = null;
    setMembershipSaving(false);
    setMembershipError("");
  }, [membershipView]);
  const canEditMembers =
    groupMembers && validMemberOrganization && can(r, "edit");
  const deletion = useDelete();
  const refreshRecordReferences = useRefreshRecordReferences(resource);
  const { result, query } = useList<RecordData>({
    resource,
    filters: [{ field: filterName, operator: "eq", value: filterValue }],
    pagination: { mode: "off" },
    meta: {
      organization:
        groupMembers && validMemberOrganization
          ? memberOrganization
          : organization,
    },
    errorNotification: false,
    queryOptions: { enabled: can(r, "list") },
  });
  async function changeMember(userId: string, action: "add" | "remove") {
    if (
      !canEditMembers ||
      !membershipMounted.current ||
      membershipBusy.current ||
      currentMembershipView.current !== membershipView ||
      query.isFetching ||
      query.isError ||
      (action === "remove" &&
        !result.data?.some(
          (user) =>
            user.id === userId &&
            valueOf(user, "IDOrganization") === memberOrganization,
        ))
    )
      return false;
    const epoch = getSessionEpoch();
    const operation = Symbol();
    const current = () =>
      membershipMounted.current &&
      currentMembershipView.current === membershipView &&
      membershipBusy.current === operation &&
      getSessionEpoch() === epoch;
    membershipBusy.current = operation;
    setMembershipSaving(true);
    setMembershipError("");
    try {
      await request("/api/memberships", {
        method: "POST",
        body: JSON.stringify({ userId, groupId: filterValue, action }),
      });
      if (getSessionEpoch() !== epoch) return false;
      await Promise.all(
        ["users", "usergroups"].map((name) =>
          invalidate({ resource: name, invalidates: ["list"] }),
        ),
      );
      if (current())
        message.success(action === "add" ? "Member added." : "Member removed.");
      return true;
    } catch (e) {
      if (current())
        setMembershipError(
          (e as Error).message ?? "Membership changes failed.",
        );
      return false;
    } finally {
      if (current()) setMembershipSaving(false);
      if (membershipBusy.current === operation) membershipBusy.current = null;
    }
  }
  if (!can(r, "list"))
    return (
      <Alert type="info" message="You do not have access to these records." />
    );
  if (query.error)
    return <ErrorNotice error={query.error} retry={() => query.refetch()} />;
  return (
    <>
      <ErrorNotice error={query.error} retry={() => query.refetch()} />
      {membershipError && (
        <Alert
          type="error"
          showIcon
          message={membershipError}
          className="page-alert"
        />
      )}
      {result.limited && (
        <Alert
          type="warning"
          message="This collection is limited by the service."
        />
      )}
      {canEditMembers && (
        <AddGroupMember
          key={`${filterValue}:${memberOrganization}:${organization}`}
          groupId={filterValue}
          organization={memberOrganization!}
          members={result.data ?? []}
          disabled={query.isFetching}
          saving={membershipSaving}
          onAdd={(userId) => changeMember(userId, "add")}
        />
      )}
      {resource === "sensors" && (
        <div className="table-toolbar">
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={query.isFetching}
            onClick={async () => {
              await query.refetch();
              await refreshRecordReferences();
            }}
          >
            Refresh
          </Button>
        </div>
      )}
      <Table
        rowKey="id"
        onRow={recordRow}
        loading={query.isLoading}
        dataSource={result.data}
        pagination={{ pageSize: 10 }}
        columns={[
          ...(resource === "sensors"
            ? []
            : [
                {
                  title: identifyById ? "ID" : r.singular,
                  render: (_: unknown, row: RecordData) => (
                    <Link to={`/${resource}/${row.id}`}>
                      {identifyById ? row.id : recordTitle(row)}
                    </Link>
                  ),
                },
              ]),
          ...(resource === "rules" || identifyById
            ? []
            : [{ title: "ID", dataIndex: "id" }]),
          ...selectedColumns(r)
            .filter((f) => !["Tag", "Label"].includes(canonical(f.key)))
            .slice(
              0,
              resource === "rules"
                ? 5
                : ["actions", "sensors"].includes(resource)
                  ? 4
                  : 3,
            )
            .map((f) => ({
              title:
                (resource === "actions" &&
                  canonical(f.key) === "IDActionType") ||
                (resource === "rules" && canonical(f.key) === "IDRuleType")
                  ? "Type"
                  : fieldLabel(f.key),
              dataIndex: f.key,
              render: (v: unknown) =>
                resource === "assets" &&
                canonical(f.key) === "IDOrganization" ? (
                  <ReferenceTag resource="organizations" value={v} />
                ) : assetIdentityResources.has(resource) &&
                  canonical(f.key) === "IDAsset" ? (
                  <AssetIdentity value={v} />
                ) : resource === "assets" &&
                  canonical(f.key) === "DhLastEvent" ? (
                  <AssetLastEvent value={v} />
                ) : resource === "sensors" &&
                  canonical(f.key) === "IDDevice" ? (
                  <DeviceIdentity value={v} />
                ) : (
                  <FieldValue field={f} value={v} />
                ),
            })),
          ...(resource === "rules" ? [{ title: "ID", dataIndex: "id" }] : []),
          ...(canEditMembers
            ? [
                {
                  title: "Actions",
                  key: "membership-actions",
                  render: (_: unknown, user: RecordData) =>
                    valueOf(user, "IDOrganization") === memberOrganization ? (
                      <Button
                        danger
                        aria-label="Remove member"
                        disabled={membershipSaving || query.isFetching}
                        onClick={() => {
                          const epoch = getSessionEpoch();
                          membershipConfirmation.current = modal.confirm({
                            title: "Remove this member?",
                            content: `${recordTitle(user)} (#${user.id}) will be removed from ${memberGroupLabel || "this user group"}.`,
                            okText: "Remove member",
                            okButtonProps: { danger: true },
                            onOk: () =>
                              epoch === getSessionEpoch() &&
                              currentMembershipView.current === membershipView
                                ? changeMember(user.id!, "remove")
                                : undefined,
                          });
                        }}
                      >
                        Remove member
                      </Button>
                    ) : null,
                },
              ]
            : []),
          ...(resource === "sensors"
            ? [
                {
                  title: "Last reported value",
                  key: "currentValue",
                  render: (_: unknown, row: RecordData) => (
                    <SensorCurrentValue row={row} />
                  ),
                },
                {
                  title: "Last reading",
                  key: "lastReading",
                  width: 220,
                  render: (_: unknown, row: RecordData) => (
                    <SensorLastReading row={row} />
                  ),
                },
                ...(can(r, "edit") || can(r, "delete")
                  ? [
                      {
                        title: "Actions",
                        key: "actions",
                        render: (_: unknown, row: RecordData) => (
                          <Space wrap>
                            {can(r, "edit") && (
                              <Link to={`/sensors/${row.id}/edit`}>Edit</Link>
                            )}
                            {can(r, "delete") && (
                              <Button
                                danger
                                size="small"
                                disabled={deletion.mutation.isPending}
                                onClick={() =>
                                  modal.confirm({
                                    title: "Delete this sensor?",
                                    content: `${recordTitle(row)} (#${row.id}). The service will check dependencies. This operation cannot be undone from this screen.`,
                                    okText: "Delete",
                                    okButtonProps: { danger: true },
                                    onOk: async () => {
                                      await deletion.mutateAsync({
                                        resource: "sensors",
                                        id: row.id!,
                                        successNotification: false,
                                      });
                                      message.success("Sensor deleted.");
                                      await query.refetch();
                                    },
                                  })
                                }
                              >
                                Delete
                              </Button>
                            )}
                          </Space>
                        ),
                      },
                    ]
                  : []),
              ]
            : []),
          ...(resource === "devices" &&
          can(r, "show") &&
          can(resourceMap.sensors, "list")
            ? [
                {
                  title: "",
                  key: "sensors",
                  render: (_: unknown, row: RecordData) => (
                    <Link to={`/devices/${row.id}?tab=sensors`}>
                      View sensors
                    </Link>
                  ),
                },
              ]
            : []),
        ]}
        scroll={{ x: resource === "sensors" ? 1000 : 600 }}
      />
    </>
  );
}
function AssetAssignments({
  assetId,
  kind,
  assetOrganization,
}: {
  assetId: string;
  kind: AssetAssignmentKind;
  assetOrganization?: string;
}) {
  const { organization, can } = useAdmin();
  const recordRow = useRecordRow(kind);
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const related = resourceMap[kind];
  const noun = kind === "users" ? "user" : "group";
  const scopedOrganization = assetOrganization ?? organization;
  const canRead = can(related, "list");
  const canEdit = can(resourceMap.assets, "edit");
  const [selected, setSelected] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const busy = useRef(false);
  const confirmation = useRef<{ destroy: () => void } | null>(null);
  const viewKey = `${assetId}:${kind}:${organization}:${scopedOrganization}`;
  const currentView = useRef(viewKey);
  currentView.current = viewKey;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      confirmation.current?.destroy();
    };
  }, []);
  useEffect(() => {
    setSelected(undefined);
    setError("");
  }, [viewKey]);
  const linked = useList<RecordData>({
    resource: kind,
    filters: [{ field: "idasset", operator: "eq", value: assetId }],
    pagination: { mode: "off" },
    meta: { organization: scopedOrganization },
    errorNotification: false,
    queryOptions: { enabled: canRead },
  });
  async function refreshVisibility(epoch: number) {
    if (getSessionEpoch() !== epoch) return;
    // A first fetch can still be pending without cached data. Cancel it so a
    // pre-change response cannot win against the authoritative refetch.
    await queryClient.cancelQueries({ queryKey: ["data"] });
    if (getSessionEpoch() !== epoch) return;
    // Assignment changes also affect asset and equipment visibility. Discard
    // inactive records before they can be displayed during later navigation.
    queryClient.removeQueries({ queryKey: ["data"], type: "inactive" });
    await queryClient.invalidateQueries({ queryKey: ["data"] });
    if (getSessionEpoch() !== epoch) return;
    queryClient.removeQueries({
      queryKey: ["data"],
      predicate: (query) => {
        const status = (query.state.error as HttpError | null)?.statusCode;
        return status === 403 || status === 404;
      },
    });
  }
  async function change(relatedId: string, action: "add" | "remove") {
    if (
      !mounted.current ||
      busy.current ||
      !canRead ||
      !canEdit ||
      currentView.current !== viewKey ||
      linked.query.isFetching ||
      linked.query.isError
    )
      return;
    const epoch = getSessionEpoch();
    const current = () =>
      mounted.current &&
      currentView.current === viewKey &&
      getSessionEpoch() === epoch;
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      await request(
        `/api/assets/${encodeURIComponent(assetId)}/assignments/${kind}/${encodeURIComponent(relatedId)}`,
        { method: action === "add" ? "POST" : "DELETE" },
      );
      if (getSessionEpoch() !== epoch) return;
      await refreshVisibility(epoch);
      if (current()) {
        setSelected(undefined);
        // Use the refetched list: imported duplicate links may still exist
        // after the service removes one assignment.
        message.success(
          `${kind === "users" ? "User" : "Group"} assignment updated.`,
        );
      }
    } catch (e) {
      if ([403, 404, 409].includes((e as HttpError).statusCode))
        await refreshVisibility(epoch);
      if (current())
        setError((e as Error).message ?? "Assignment changes failed.");
    } finally {
      busy.current = false;
      if (current()) setSaving(false);
    }
  }
  if (!canRead)
    return (
      <Alert type="info" message="You do not have access to these records." />
    );
  if (linked.query.error)
    return (
      <ErrorNotice
        error={linked.query.error}
        retry={() => linked.query.refetch()}
      />
    );
  return (
    <>
      {error && (
        <Alert type="error" showIcon message={error} className="page-alert" />
      )}
      {canEdit ? (
        <div className="membership-add">
          <div style={{ flex: 1 }}>
            <label htmlFor={`asset-${assetId}-${kind}-assignment`}>
              {kind === "users" ? "User to assign" : "Group to assign"}
            </label>
            <ReferenceSelect
              id={`asset-${assetId}-${kind}-assignment`}
              resource={kind}
              organizationOverride={scopedOrganization}
              value={selected}
              onChange={setSelected}
              allowZero={false}
              disabled={saving || linked.query.isFetching}
            />
          </div>
          <Button
            type="primary"
            loading={saving}
            disabled={
              saving ||
              linked.query.isFetching ||
              !selected ||
              linked.result.data?.some((row) => row.id === selected)
            }
            onClick={() => selected && change(selected, "add")}
          >
            Assign {noun}
          </Button>
        </div>
      ) : (
        <Alert
          className="page-alert"
          type="info"
          message="Your permissions or the Assets service's write settings do not allow assignment changes."
        />
      )}
      {linked.result.limited && (
        <Alert
          type="warning"
          message="This collection is limited by the service."
        />
      )}
      <Table
        rowKey="id"
        onRow={recordRow}
        dataSource={linked.result.data}
        loading={linked.query.isLoading}
        pagination={{ pageSize: 10 }}
        columns={[
          {
            title: related.singular,
            render: (_, row) => (
              <Link to={`/${kind}/${row.id}`}>{recordTitle(row)}</Link>
            ),
          },
          { title: "ID", dataIndex: "id" },
          ...(canEdit
            ? [
                {
                  title: "",
                  render: (_: unknown, row: RecordData) => (
                    <Button
                      danger
                      disabled={saving || linked.query.isFetching}
                      onClick={() => {
                        const epoch = getSessionEpoch();
                        confirmation.current = modal.confirm({
                          title: `Remove this ${noun} assignment?`,
                          content: `${recordTitle(row)} may lose access to this asset and its equipment. Other assignments can still grant access.`,
                          okText: "Remove assignment",
                          okButtonProps: { danger: true },
                          onOk: () =>
                            epoch === getSessionEpoch() &&
                            currentView.current === viewKey
                              ? change(row.id!, "remove")
                              : undefined,
                        });
                      }}
                    >
                      Remove
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
        scroll={{ x: 600 }}
      />
    </>
  );
}
function Memberships({ userId }: { userId: string }) {
  const { organization, can } = useAdmin();
  const recordRow = useRecordRow("usergroups");
  const { message, modal } = App.useApp();
  const [group, setGroup] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const linked = useList<RecordData>({
    resource: "usergroups",
    filters: [{ field: "iduser", operator: "eq", value: userId }],
    pagination: { mode: "off" },
    meta: { organization },
    errorNotification: false,
    queryOptions: { enabled: can(resourceMap.usergroups, "list") },
  });
  async function change(groupId: string, action: "add" | "remove") {
    setSaving(true);
    setError("");
    try {
      await request("/api/memberships", {
        method: "POST",
        body: JSON.stringify({ userId, groupId, action }),
      });
      await linked.query.refetch();
      setGroup(undefined);
      message.success(
        action === "add" ? "Membership added." : "Membership removed.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  if (!can(resourceMap.usergroups, "list"))
    return (
      <Alert type="info" message="You do not have access to these records." />
    );
  if (linked.query.error)
    return (
      <ErrorNotice
        error={linked.query.error}
        retry={() => linked.query.refetch()}
      />
    );
  return (
    <>
      <ErrorNotice
        error={linked.query.error}
        retry={() => linked.query.refetch()}
      />
      {error && <Alert type="error" message={error} className="page-alert" />}
      {can(resourceMap.users, "edit") && (
        <div className="membership-add">
          <ReferenceSelect
            resource="usergroups"
            value={group}
            onChange={setGroup}
            allowZero={false}
          />
          <Button
            type="primary"
            onClick={() => group && change(group, "add")}
            disabled={!group || linked.result.data?.some((r) => r.id === group)}
            loading={saving}
          >
            Add membership
          </Button>
        </div>
      )}
      <Table
        rowKey="id"
        onRow={recordRow}
        dataSource={linked.result.data}
        loading={linked.query.isLoading}
        columns={[
          {
            title: "User group",
            render: (_, row) => (
              <Link to={`/usergroups/${row.id}`}>{recordTitle(row)}</Link>
            ),
          },
          { title: "ID", dataIndex: "id" },
          {
            title: "",
            render: (_, row) =>
              can(resourceMap.users, "edit") ? (
                <Button
                  danger
                  disabled={saving}
                  onClick={() =>
                    modal.confirm({
                      title: "Remove this membership?",
                      content: `${recordTitle(row)} will no longer be assigned to this user.`,
                      okText: "Remove membership",
                      okButtonProps: { danger: true },
                      onOk: () => change(row.id!, "remove"),
                    })
                  }
                >
                  Remove
                </Button>
              ) : null,
          },
        ]}
      />
    </>
  );
}
export function ResourceDetail({ resource }: { resource: Resource }) {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const viewingDeviceSensors =
    resource.name === "devices" && params.get("tab") === "sensors";
  const { organization, can } = useAdmin();
  const refreshRecordReferences = useRefreshRecordReferences(resource.name);
  const navigate = useNavigate();
  const { modal, message } = App.useApp();
  const deletion = useDelete();
  const { result: record, query } = useOne<RecordData>({
    resource: resource.name,
    id,
    meta: { organization },
    errorNotification: false,
    queryOptions: { enabled: can(resource, "show") },
  });
  const canReadRuleActions =
    resource.name === "rules" &&
    can(resource, "show") &&
    can(resourceMap.actions, "list") &&
    query.isSuccess &&
    record?.id === id;
  const ruleActions = useList<RecordData>({
    resource: "actions",
    filters: [{ field: "idrule", operator: "eq", value: id }],
    pagination: { mode: "off" },
    meta: { organization },
    errorNotification: false,
    queryOptions: { enabled: canReadRuleActions },
  });
  const ruleActionsCount =
    canReadRuleActions &&
    ruleActions.query.isSuccess &&
    !ruleActions.query.isPlaceholderData &&
    typeof ruleActions.result.total === "number"
      ? `${ruleActions.result.total}${ruleActions.result.limited ? "+" : ""}`
      : undefined;
  const userName =
    resource.name === "users" && record
      ? ["First_name", "Last_name"]
          .map((name) => String(valueOf(record, name) ?? "").trim())
          .filter(Boolean)
          .join(" ")
      : "";
  const title = record ? userName || recordTitle(record) : resource.singular;
  function selectDeviceTab(tab: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (tab === "sensors") next.set("tab", "sensors");
      else next.delete("tab");
      return next;
    });
  }
  const tabs = [
    {
      key: "details",
      label: "Details",
      children: (
        <Descriptions
          bordered
          column={{ xs: 1, sm: 1, md: 2 }}
          items={resource.fields
            .filter(
              (f) =>
                displayedField(resource, f) &&
                !(
                  ["actions", "rules"].includes(resource.name) &&
                  canonical(f.key) === "AssetTag"
                ),
            )
            .map((f) => ({
              key: f.key,
              styles:
                ["rules", "actions"].includes(resource.name) &&
                f.key === resource.primaryKey
                  ? { content: { whiteSpace: "nowrap" as const } }
                  : undefined,
              label:
                f.key === resource.primaryKey
                  ? "ID"
                  : resource.name === "sensors" &&
                      canonical(f.key) === "DhLastEvent"
                    ? "Last reading"
                    : resource.name === "rules" &&
                        ruleScheduleLabels[canonical(f.key)]
                      ? ruleScheduleLabels[canonical(f.key)]
                      : resource.name === "rules" &&
                          ruleDurationLabels[canonical(f.key)]
                        ? ruleDurationLabels[canonical(f.key)]
                        : fieldLabel(f.key),
              children:
                ["assets", "users", "usergroups", "devices"].includes(
                  resource.name,
                ) && canonical(f.key) === "IDOrganization" ? (
                  <ReferenceTag
                    resource="organizations"
                    value={record?.[f.key]}
                    showId={["usergroups", "devices"].includes(resource.name)}
                  />
                ) : resource.name === "users" &&
                  canonical(f.key) === "IDUserType" ? (
                  <ReferenceTag resource="usertypes" value={record?.[f.key]} />
                ) : resource.name === "users" && f.key.startsWith("m_dh") ? (
                  <UserDateTime value={record?.[f.key]} />
                ) : resource.name === "rules" &&
                  ruleScheduleLabels[canonical(f.key)] ? (
                  <RuleScheduleTime value={record?.[f.key]} />
                ) : resource.name === "rules" &&
                  ruleDurationLabels[canonical(f.key)] ? (
                  <RuleDurationSeconds value={record?.[f.key]} />
                ) : resource.name === "rules" &&
                  canonical(f.key) === "DhReset" &&
                  valueOf(record ?? {}, "ResetPending") !== true ? (
                  <span className="muted">—</span>
                ) : resource.name === "assets" &&
                  canonical(f.key) === "DhLastEvent" ? (
                  <AssetLastEvent value={record?.[f.key]} />
                ) : resource.name === "sensors" &&
                  canonical(f.key) === "DhLastEvent" ? (
                  <SensorLastReading row={record ?? {}} />
                ) : resource.name === "rules" &&
                  canonical(f.key) === "IDSensor" ? (
                  <SensorTypeTag value={record?.[f.key]} />
                ) : resource.name === "actions" &&
                  canonical(f.key) === "IDRule" ? (
                  <RuleIdentity value={record?.[f.key]} />
                ) : ["actions", "rules", "devices"].includes(resource.name) &&
                  canonical(f.key) === "IDAsset" ? (
                  <AssetIdentity value={record?.[f.key]} />
                ) : (
                  <FieldValue
                    field={f}
                    value={record?.[f.key]}
                    primary={f.key === resource.primaryKey}
                  />
                ),
            }))}
        />
      ),
    },
  ];
  if (resource.name === "assets")
    tabs.push({
      key: "assignments",
      label: "Assignments",
      children: (
        <>
          <Tabs
            items={[
              {
                key: "users",
                label: "Users",
                children: (
                  <AssetAssignments
                    key={`${id}:${organization}:users`}
                    assetId={id!}
                    kind="users"
                    assetOrganization={
                      record &&
                      String(valueOf(record, "IDOrganization") ?? organization)
                    }
                  />
                ),
              },
              {
                key: "groups",
                label: "User groups",
                children: (
                  <AssetAssignments
                    key={`${id}:${organization}:usergroups`}
                    assetId={id!}
                    kind="usergroups"
                    assetOrganization={
                      record &&
                      String(valueOf(record, "IDOrganization") ?? organization)
                    }
                  />
                ),
              },
              {
                key: "hubs",
                label: "Hubs",
                children: (
                  <RelatedList
                    resource="hubs"
                    filterName="idasset"
                    filterValue={id!}
                  />
                ),
              },
            ]}
          />
        </>
      ),
    });
  if (resource.name === "assets")
    tabs.push({
      key: "equipment",
      label: "Equipment",
      children: (
        <Tabs
          items={[
            {
              key: "devices",
              label: "Devices",
              children: (
                <RelatedList
                  resource="devices"
                  filterName="idasset"
                  filterValue={id!}
                />
              ),
            },
            {
              key: "sensors",
              label: "Sensors",
              children: (
                <RelatedList
                  resource="sensors"
                  filterName="idasset"
                  filterValue={id!}
                />
              ),
            },
            {
              key: "rules",
              label: "Rules",
              children: (
                <RelatedList
                  resource="rules"
                  filterName="idasset"
                  filterValue={id!}
                />
              ),
            },
          ]}
        />
      ),
    });
  if (resource.name === "users")
    tabs.push({
      key: "groups",
      label: "Group memberships",
      children: <Memberships userId={id!} />,
    });
  if (resource.name === "usergroups")
    tabs.push({
      key: "users",
      label: "Members",
      children: (
        <RelatedList
          resource="users"
          filterName="idusergroup"
          filterValue={id!}
          memberOrganization={String(
            valueOf(record ?? {}, "IDOrganization") ?? "",
          )}
          memberGroupLabel={record ? recordTitle(record) : undefined}
        />
      ),
    });
  if (resource.name === "hubs")
    tabs.push({
      key: "devices",
      label: "Devices",
      children: (
        <RelatedList resource="devices" filterName="idhub" filterValue={id!} />
      ),
    });
  if (resource.name === "devices")
    tabs.push({
      key: "sensors",
      label: "Sensors",
      children: (
        <RelatedList
          resource="sensors"
          filterName="iddevice"
          filterValue={id!}
        />
      ),
    });
  if (resource.name === "rules")
    tabs.push({
      key: "actions",
      label:
        ruleActionsCount === undefined
          ? "Actions"
          : `Actions (${ruleActionsCount})`,
      children: (
        <RelatedList resource="actions" filterName="idrule" filterValue={id!} />
      ),
    });
  if (resource.name === "organizations")
    tabs.push(
      {
        key: "users",
        label: "Users",
        children: (
          <RelatedList
            resource="users"
            filterName="idorganization"
            filterValue={id!}
          />
        ),
      },
      {
        key: "assets",
        label: "Assets",
        children: (
          <RelatedList
            resource="assets"
            filterName="idorganization"
            filterValue={id!}
          />
        ),
      },
    );
  if (!can(resource, "show"))
    return <Result status="403" title="Access unavailable" />;
  if (query.error)
    return <ErrorNotice error={query.error} retry={() => query.refetch()} />;
  return (
    <>
      <Breadcrumb
        items={[
          { title: <Link to={`/${resource.name}`}>{resource.label}</Link> },
          { title: record ? title : "Details" },
        ]}
      />
      <PageHeading
        resource={resource}
        title={title}
        subtitle={
          resource.name === "assets"
            ? `Asset ID: ${record?.id ?? id}`
            : `Record #${id}`
        }
        extra={
          !viewingDeviceSensors && (
            <>
              <Button
                icon={<ReloadOutlined />}
                onClick={async () => {
                  const refreshed = await query.refetch();
                  if (
                    canReadRuleActions &&
                    refreshed.isSuccess &&
                    refreshed.data?.data.id === id
                  )
                    await ruleActions.query.refetch();
                  await refreshRecordReferences();
                }}
              >
                Refresh
              </Button>
              {resource.name === "sensors" && (
                <Button
                  onClick={() => navigate(`/sensor-history?idsensor=${id}`)}
                >
                  View history
                </Button>
              )}
              {resource.name === "devices" &&
                can(resourceMap.sensors, "list") && (
                  <Button onClick={() => selectDeviceTab("sensors")}>
                    View sensors
                  </Button>
                )}
              {can(resource, "edit") && (
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => navigate(`/${resource.name}/${id}/edit`)}
                >
                  Edit
                </Button>
              )}
              {can(resource, "delete") && (
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    modal.confirm({
                      title: `Delete this ${resource.singular.toLowerCase()}?`,
                      content: `${record ? recordTitle(record) : id}. The service will check dependencies. This operation cannot be undone from this screen.`,
                      okText: "Delete",
                      okButtonProps: { danger: true },
                      onOk: async () => {
                        await deletion.mutateAsync({
                          resource: resource.name,
                          id: id!,
                          successNotification: false,
                        });
                        message.success("Record deleted.");
                        navigate(`/${resource.name}`);
                      },
                    })
                  }
                >
                  Delete
                </Button>
              )}
            </>
          )
        }
      />
      <ErrorNotice error={query.error} retry={() => query.refetch()} />
      <Card>
        {query.isLoading ? (
          <Skeleton active />
        ) : record ? (
          <Tabs
            items={tabs}
            activeKey={
              resource.name === "devices"
                ? viewingDeviceSensors
                  ? "sensors"
                  : "details"
                : undefined
            }
            onChange={resource.name === "devices" ? selectDeviceTab : undefined}
            destroyOnHidden
          />
        ) : (
          <Empty description="Record unavailable" />
        )}
      </Card>
    </>
  );
}
export function ResourceEditor({
  resource,
  mode,
}: {
  resource: Resource;
  mode: "create" | "edit";
}) {
  const { id } = useParams();
  const { organization, identity, can } = useAdmin();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const [params] = useSearchParams();
  const [form] = Form.useForm();
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [scheduleReference, setScheduleReference] = useState(() => new Date());
  const originalRuleSchedule = useRef<Record<string, unknown>>({});
  const saved = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !saved.current &&
      currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const confirmation = modal.confirm({
      title: "Discard unsaved changes?",
      okText: "Discard",
      cancelText: "Keep editing",
      onOk: () => blocker.proceed(),
      onCancel: () => blocker.reset(),
    });
    return () => confirmation.destroy();
  }, [blocker, modal]);
  const initialized = useRef("");
  const create = useCreate<RecordData, HttpError, Record<string, unknown>>();
  const update = useUpdate<RecordData, HttpError, Record<string, unknown>>();
  const detail = useOne<RecordData>({
    resource: resource.name,
    id: id ?? "0",
    meta: { organization },
    queryOptions: {
      enabled:
        mode === "edit" && can(resource, "show") && can(resource, "edit"),
    },
    errorNotification: false,
  });
  const fields = editableFields(resource, mode).filter(
    (f) => identity.level >= 90 || canonical(f.key) !== "Admin",
  );
  const saving = create.mutation.isPending || update.mutation.isPending;
  useEffect(() => {
    const key = `${resource.name}:${id ?? "new"}:${mode}`;
    if (initialized.current === key) return;
    if (!can(resource, mode) || (mode === "edit" && !can(resource, "show")))
      return;
    if (detail.query.error) return;
    if (mode === "edit" && !detail.result) return;
    initialized.current = key;
    saved.current = false;
    form.resetFields();
    const reference = new Date();
    if (resource.name === "rules") {
      setScheduleReference(reference);
      originalRuleSchedule.current = {};
    }
    const initial: Record<string, unknown> = {};
    if (mode === "edit")
      for (const f of fields) {
        const value = detail.result?.[responseKey(resource, f.key)];
        if (value !== undefined)
          initial[f.key] =
            resource.name === "rules" && ruleScheduleLabels[canonical(f.key)]
              ? utcTimeToLocal(value, reference)
              : resource.name === "rules" &&
                  ruleDurationLabels[canonical(f.key)]
                ? millisecondsToSeconds(value)
                : value;
        if (resource.name === "rules" && ruleScheduleLabels[canonical(f.key)])
          originalRuleSchedule.current[f.key] = value;
      }
    else
      for (const f of fields) {
        if (canonical(f.key) === "IDOrganization" && organization)
          initial[f.key] = organization;
        if (
          canonical(f.key) === "IsTemplate" &&
          params.get("template") === "true"
        )
          initial[f.key] = true;
      }
    form.setFieldsValue(initial);
    setDirty(false);
    setError("");
  }, [detail.result, resource, id, mode, form, organization, params, fields]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const leave = () => {
    const go = () =>
      navigate(
        mode === "edit" ? `/${resource.name}/${id}` : `/${resource.name}`,
      );
    go();
  };
  if (!can(resource, mode) || (mode === "edit" && !can(resource, "show")))
    return (
      <Result
        status="403"
        title="Changes are unavailable"
        subTitle="Your permissions or the service's write settings do not allow this operation."
      />
    );
  if (mode === "edit" && detail.query.error)
    return (
      <ErrorNotice
        error={detail.query.error}
        retry={() => detail.query.refetch()}
      />
    );
  const groups: { name: string; fields: Field[] }[] = [
    { name: "General", fields: [] },
    { name: "Relationships", fields: [] },
    { name: "Configuration", fields: [] },
  ];
  for (const f of fields)
    groups[
      referenceResource[canonical(f.key)]
        ? 1
        : /^(Tag|Label|Login|First_name|Last_name|Email|SerialNr|SerialCode)$/.test(
              canonical(f.key),
            )
          ? 0
          : 2
    ].fields.push(f);
  return (
    <>
      <Breadcrumb
        items={[
          { title: <Link to={`/${resource.name}`}>{resource.label}</Link> },
          { title: mode === "create" ? "New record" : "Edit" },
        ]}
      />
      <PageHeading
        resource={resource}
        title={`${mode === "create" ? "Add" : "Edit"} ${resource.singular.toLowerCase()}`}
        extra={
          <Button icon={<ArrowLeftOutlined />} onClick={leave}>
            Back
          </Button>
        }
      />
      <ErrorNotice
        error={detail.query.error}
        retry={() => detail.query.refetch()}
      />
      {error && (
        <Alert className="page-alert" type="error" showIcon message={error} />
      )}
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onValuesChange={() => setDirty(true)}
        onFinish={async (values) => {
          setError("");
          const changed: Record<string, unknown> = {};
          for (const field of fields) {
            const duration =
              resource.name === "rules" &&
              ruleDurationLabels[canonical(field.key)];
            const schedule =
              resource.name === "rules" &&
              ruleScheduleLabels[canonical(field.key)];
            const stored = schedule
              ? originalRuleSchedule.current[field.key]
              : detail.result?.[responseKey(resource, field.key)];
            const value = schedule
              ? localTimeToUtc(values[field.key], scheduleReference, stored)
              : duration
                ? secondsToMilliseconds(values[field.key])
                : values[field.key];
            if (value === undefined) continue;
            const original = schedule
              ? localTimeToUtc(
                  utcTimeToLocal(stored, scheduleReference),
                  scheduleReference,
                  stored,
                )
              : duration
                ? secondsToMilliseconds(millisecondsToSeconds(stored))
                : stored;
            if (mode === "create" || value !== original)
              changed[field.key] = value;
          }
          if (!Object.keys(changed).length) {
            message.info("There are no changes to save.");
            return;
          }
          try {
            const result =
              mode === "create"
                ? await create.mutateAsync({
                    resource: resource.name,
                    values: changed,
                    successNotification: false,
                    errorNotification: false,
                  })
                : await update.mutateAsync({
                    resource: resource.name,
                    id: id!,
                    values: changed,
                    successNotification: false,
                    errorNotification: false,
                  });
            saved.current = true;
            setDirty(false);
            message.success(`${resource.singular} saved.`);
            navigate(`/${resource.name}/${result.data.id}`);
          } catch (e) {
            const err = e as HttpError;
            setError(err.message);
            if (err.errors)
              form.setFields(
                Object.entries(err.errors).map(([name, errors]) => ({
                  name,
                  errors: Array.isArray(errors)
                    ? errors.map(String)
                    : [String(errors)],
                })),
              );
          }
        }}
      >
        {mode === "edit" && detail.query.isLoading ? (
          <Card>
            <Skeleton active />
          </Card>
        ) : (
          groups
            .filter((g) => g.fields.length)
            .map((group) => (
              <Card
                className="form-section"
                title={group.name}
                key={group.name}
              >
                {resource.name === "rules" &&
                  group.name === "Configuration" && (
                    <Alert
                      className="page-alert"
                      type="info"
                      message={`Times use your browser's local timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone}), using UTC date ${scheduleReference.toISOString().slice(0, 10)} for daylight saving adjustments. They are saved in UTC; all-day mode ignores the daily time window.`}
                    />
                  )}
                <Row gutter={24}>
                  {group.fields.map((field) => (
                    <Col xs={24} md={12} key={field.key}>
                      <Form.Item
                        name={field.key}
                        label={
                          (resource.name === "rules" &&
                            (ruleScheduleLabels[canonical(field.key)] ||
                              ruleDurationLabels[canonical(field.key)])) ||
                          fieldLabel(field.key)
                        }
                        extra={
                          resource.name === "rules" &&
                          canonical(field.key) === "ResetDelayMs"
                            ? "Time the input must remain normal before the rule resets. 0 resets immediately; maximum 7 days."
                            : undefined
                        }
                        rules={[
                          ...(field.required
                            ? [
                                {
                                  required: true,
                                  message: "This field is required.",
                                },
                              ]
                            : []),
                          ...(field.maxLength
                            ? [
                                {
                                  validator: (_: unknown, value: unknown) =>
                                    typeof value === "string" &&
                                    value.length > field.maxLength!
                                      ? Promise.reject(
                                          new Error(
                                            `Use at most ${field.maxLength} characters (including translations).`,
                                          ),
                                        )
                                      : Promise.resolve(),
                                },
                              ]
                            : []),
                          ...(field.type === "integer" &&
                          !(
                            resource.name === "rules" &&
                            ruleDurationLabels[canonical(field.key)]
                          )
                            ? [
                                {
                                  validator: (_: unknown, value: unknown) =>
                                    value !== undefined &&
                                    value !== null &&
                                    value !== "" &&
                                    !/^-?\d+$/.test(String(value))
                                      ? Promise.reject(
                                          new Error("Enter a whole number."),
                                        )
                                      : Promise.resolve(),
                                },
                              ]
                            : []),
                          ...(resource.name === "rules" &&
                          ruleScheduleLabels[canonical(field.key)]
                            ? [
                                {
                                  validator: (_: unknown, value: unknown) =>
                                    value === undefined ||
                                    localTimeToUtc(
                                      value,
                                      scheduleReference,
                                      originalRuleSchedule.current[field.key],
                                    ) !== undefined
                                      ? Promise.resolve()
                                      : Promise.reject(
                                          new Error(
                                            "Enter a valid local time for the schedule date.",
                                          ),
                                        ),
                                },
                              ]
                            : []),
                          ...(resource.name === "rules" &&
                          ruleDurationLabels[canonical(field.key)]
                            ? [
                                {
                                  validator: (_: unknown, value: unknown) =>
                                    validateRuleDuration(field, value),
                                },
                              ]
                            : []),
                        ]}
                      >
                        <FieldInput field={field} resource={resource.name} />
                      </Form.Item>
                    </Col>
                  ))}
                </Row>
              </Card>
            ))
        )}
        <div className="form-footer">
          <Typography.Text type="secondary">
            {dirty ? "Unsaved changes" : "Changes are saved when you submit."}
          </Typography.Text>
          <Space>
            <Button onClick={leave}>Cancel</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={saving}
              icon={<SaveOutlined />}
              disabled={mode === "edit" && !detail.result}
            >
              Save {resource.singular.toLowerCase()}
            </Button>
          </Space>
        </div>
      </Form>
    </>
  );
}
