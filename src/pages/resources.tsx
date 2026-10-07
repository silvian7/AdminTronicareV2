import { useEffect, useMemo, useRef, useState } from "react";
import { useTable } from "@refinedev/antd";
import { useQueryClient } from "@tanstack/react-query";
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
  valueOf,
  type Field,
  type Resource,
  type RecordData,
  type AssetAssignmentKind,
} from "../../shared/resources";
import { useAdmin } from "../context";
import {
  ErrorNotice,
  FieldInput,
  FieldValue,
  ReferenceSelect,
} from "../components/fields";
import { getSessionEpoch, request } from "../api";

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
function selectedColumns(resource: Resource) {
  const priority = [
    "Label",
    "Tag",
    "Login",
    "First_name",
    "Last_name",
    "SerialNr",
    "IDHubType",
    "IDDeviceType",
    "IDSensorType",
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
    "IsRead",
    "IsAck",
    "ResultSuccess",
    "Kind",
    "Data",
    "dhCreated",
  ];
  return priority
    .flatMap((name) =>
      resource.fields.filter(
        (f) =>
          canonical(f.key) === name &&
          f.key !== resource.primaryKey &&
          !hiddenField(f.key),
      ),
    )
    .slice(0, resource.name === "devices" ? 8 : 7);
}
const equipmentTypeResources: Partial<Record<string, string>> = {
  hubs: "hubtypes",
  devices: "devicetypes",
  sensors: "sensortypes",
};
function useRefreshEquipmentTypes(resource: string) {
  const { organization, can } = useAdmin();
  const invalidate = useInvalidate();
  return async () => {
    const typeResource = equipmentTypeResources[resource];
    if (!typeResource || !can(resourceMap[typeResource], "show")) return;
    await invalidate({
      resource: typeResource,
      invalidates: ["resourceAll"],
      invalidationFilters: {
        predicate: ({ meta }) =>
          meta?.equipmentTypeReference === true &&
          meta?.organization === organization,
      },
    });
  };
}
export function ResourceList({ resource }: { resource: Resource }) {
  const { organization, can } = useAdmin();
  const refreshEquipmentTypes = useRefreshEquipmentTypes(resource.name);
  const navigate = useNavigate();
  const [showFilters, setShowFilters] = useState(false);
  const {
    tableProps,
    tableQuery,
    filters,
    setFilters,
    setCurrentPage,
    result,
  } = useTable<RecordData>({
    resource: resource.name,
    pagination: { pageSize: 25 },
    meta: { organization },
    syncWithLocation: true,
    errorNotification: false,
    queryOptions: { enabled: can(resource, "list") },
  });
  const active = (key: string) =>
    filters.find(
      (f): f is CrudFilter & { field: string; value: unknown } =>
        "field" in f && f.field === key,
    )?.value;
  const filter = (key: string, value: unknown) => {
    setFilters([{ field: key, operator: "eq", value }], "merge");
    setCurrentPage(1);
  };
  const [search, setSearch] = useState(String(active("_q") ?? ""));
  const columns = useMemo(
    () => [
      {
        title: resource.singular,
        key: "record",
        width: 240,
        render: (_: unknown, row: RecordData) => (
          <div className="record-identity">
            <Link to={`/${resource.name}/${row.id}`}>{recordTitle(row)}</Link>
            <span>#{row.id}</span>
          </div>
        ),
      },
      ...selectedColumns(resource)
        .filter((f) => !["Label", "Tag"].includes(canonical(f.key)))
        .map((f) => ({
          title: fieldLabel(f.key),
          dataIndex: f.key,
          key: f.key,
          sorter: true,
          ellipsis: true,
          render: (value: unknown) => <FieldValue field={f} value={value} />,
        })),
      {
        title: "",
        key: "open",
        width: 80,
        render: (_: unknown, row: RecordData) => (
          <Button
            type="link"
            onClick={() => navigate(`/${resource.name}/${row.id}`)}
          >
            View
          </Button>
        ),
      },
    ],
    [resource, navigate],
  );
  if (!can(resource, "list"))
    return <Result status="403" title="Access unavailable" />;
  if (tableQuery.error)
    return (
      <ErrorNotice
        error={tableQuery.error}
        retry={() => tableQuery.refetch()}
      />
    );
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
                await refreshEquipmentTypes();
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
      {result.limited && (
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
              {result.total ?? 0} loaded matches
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
                      defaultValue={String(active(field.key) ?? "")}
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
                setSearch("");
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
        <Table
          {...tableProps}
          rowKey="id"
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
      </Card>
    </>
  );
}
function RelatedList({
  resource,
  filterName,
  filterValue,
}: {
  resource: string;
  filterName: string;
  filterValue: string;
}) {
  const { organization, can } = useAdmin();
  const r = resourceMap[resource];
  const { result, query } = useList<RecordData>({
    resource,
    filters: [{ field: filterName, operator: "eq", value: filterValue }],
    pagination: { mode: "off" },
    meta: { organization },
    errorNotification: false,
    queryOptions: { enabled: can(r, "list") },
  });
  if (!can(r, "list"))
    return (
      <Alert type="info" message="You do not have access to these records." />
    );
  if (query.error)
    return <ErrorNotice error={query.error} retry={() => query.refetch()} />;
  return (
    <>
      <ErrorNotice error={query.error} retry={() => query.refetch()} />
      {result.limited && (
        <Alert
          type="warning"
          message="This collection is limited by the service."
        />
      )}
      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={result.data}
        pagination={{ pageSize: 10 }}
        columns={[
          {
            title: r.singular,
            render: (_, row) => (
              <Link to={`/${resource}/${row.id}`}>{recordTitle(row)}</Link>
            ),
          },
          { title: "ID", dataIndex: "id" },
          ...selectedColumns(r)
            .filter((f) => !["Tag", "Label"].includes(canonical(f.key)))
            .slice(0, 3)
            .map((f) => ({
              title: fieldLabel(f.key),
              dataIndex: f.key,
              render: (v: unknown) => <FieldValue field={f} value={v} />,
            })),
        ]}
        scroll={{ x: 600 }}
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
  const { organization, can } = useAdmin();
  const refreshEquipmentTypes = useRefreshEquipmentTypes(resource.name);
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
  const tabs = [
    {
      key: "details",
      label: "Details",
      children: (
        <Descriptions
          bordered
          column={{ xs: 1, sm: 1, md: 2 }}
          items={resource.fields
            .filter((f) => !hiddenField(f.key))
            .map((f) => ({
              key: f.key,
              label: f.key === resource.primaryKey ? "ID" : fieldLabel(f.key),
              children: (
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
      label: "Actions",
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
          { title: record ? recordTitle(record) : "Details" },
        ]}
      />
      <PageHeading
        resource={resource}
        title={record ? recordTitle(record) : resource.singular}
        subtitle={`Record #${id}`}
        extra={
          <>
            <Button
              icon={<ReloadOutlined />}
              onClick={async () => {
                await query.refetch();
                await refreshEquipmentTypes();
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
        }
      />
      <ErrorNotice error={query.error} retry={() => query.refetch()} />
      <Card>
        {query.isLoading ? (
          <Skeleton active />
        ) : record ? (
          <Tabs items={tabs} destroyOnHidden />
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
    const initial: Record<string, unknown> = {};
    if (mode === "edit")
      for (const f of fields) {
        const value = detail.result?.[responseKey(resource, f.key)];
        if (value !== undefined) initial[f.key] = value;
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
            const value = values[field.key];
            if (value === undefined) continue;
            const original = detail.result?.[responseKey(resource, field.key)];
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
                      message="Schedules use UTC. The times you enter are saved unchanged; all-day mode ignores the daily time window."
                    />
                  )}
                <Row gutter={24}>
                  {group.fields.map((field) => (
                    <Col xs={24} md={12} key={field.key}>
                      <Form.Item
                        name={field.key}
                        label={fieldLabel(field.key)}
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
                          ...(field.type === "integer"
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
