import { useEffect, useRef, useState } from "react";
import { useInvalidate, useList } from "@refinedev/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Form,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router";
import {
  resourceMap,
  translated,
  valueOf,
  type OrganizationMembership,
  type RecordData,
} from "../../shared/resources";
import {
  getSession,
  getSessionEpoch,
  refreshOrganizationSession,
  request,
} from "../api";
import { useAdmin } from "../context";
import { ErrorNotice } from "./fields";

export function useUserOrganizations(userId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["user-organizations", getSessionEpoch(), userId],
    queryFn: () =>
      request<{ data: OrganizationMembership[] }>(
        `/api/users/${encodeURIComponent(userId)}/organizations`,
      ),
    enabled,
    retry: false,
    refetchOnWindowFocus: "always",
  });
}

function roleLevel(row: RecordData | undefined): number | null {
  const raw = row && valueOf(row, "Level");
  if (typeof raw !== "string" || !/^-?\d+$/.test(raw)) return null;
  const level = Number(raw);
  return Number.isInteger(level) && level >= -2147483648 && level <= 2147483647
    ? level
    : null;
}

function referenceTitle(
  rows: readonly RecordData[],
  id: string,
  fallback: string,
) {
  const row = rows.find((entry) => entry.id === id);
  const tag = row && translated(valueOf(row, "Tag")).trim();
  return tag ? `${tag} (#${id})` : `${fallback} #${id}`;
}

export function UserOrganizations({
  user,
  memberships,
}: {
  user: RecordData;
  memberships: ReturnType<typeof useUserOrganizations>;
}) {
  const { identity, can, registerOrganizationChangeGuard } = useAdmin();
  const viewEpoch = getSessionEpoch();
  const { modal, message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invalidate = useInvalidate();
  const [form] = Form.useForm<{ organizationId: string; userTypeId: string }>();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const locked = useRef(false);
  const confirmation = useRef<ReturnType<typeof modal.confirm> | null>(null);
  const cancelGuard = useRef<(() => void) | null>(null);
  const platform = identity.level >= 90;
  const organizations = useList<RecordData>({
    resource: "organizations",
    pagination: { mode: "off" },
    meta: { organization: platform ? "" : identity.organizationId },
    errorNotification: false,
    queryOptions: { enabled: can(resourceMap.organizations, "list") },
  });
  const roles = useList<RecordData>({
    resource: "usertypes",
    pagination: { mode: "off" },
    errorNotification: false,
    queryOptions: { enabled: can(resourceMap.usertypes, "list") },
  });
  const roleRows = roles.query.isError ? [] : roles.result.data;
  const organizationRows = organizations.query.isError
    ? []
    : organizations.result.data;
  const targetLevel = roleLevel(
    roleRows.find((row) => row.id === valueOf(user, "IDUserType")),
  );
  const canManage =
    can(resourceMap.users, "edit") &&
    (platform ||
      (valueOf(user, "Admin") === false &&
        targetLevel !== null &&
        targetLevel < identity.level));
  const rows = memberships.isError ? [] : (memberships.data?.data ?? []);
  const selectableRoles = roleRows.filter((row) => {
    const level = roleLevel(row);
    return level !== null && level < 90 && (platform || level < identity.level);
  });
  const availableOrganizations = (
    platform
      ? organizationRows
      : [
          organizationRows.find(
            (row) => row.id === identity.organizationId,
          ) ?? { id: identity.organizationId },
        ]
  ).filter(
    (row) =>
      row.id &&
      row.id !== "0" &&
      !rows.some(
        (membership) =>
          membership.active && membership.organizationId === row.id,
      ),
  );
  const organizationOptions = availableOrganizations.map((row) => ({
    value: row.id!,
    label: referenceTitle(organizationRows, row.id!, "Organization"),
  }));
  const roleOptions = selectableRoles.map((row) => ({
    value: row.id!,
    label: referenceTitle(roleRows, row.id!, "User type"),
  }));
  const currentMembership = (organizationId: string) =>
    identity.id === user.id &&
    (getSession()?.activeOrganizationId === undefined
      ? identity.organizationId === organizationId
      : getSession()?.activeOrganizationId === organizationId);
  const canRemove = (membership: OrganizationMembership) => {
    const level = roleLevel(
      roleRows.find((row) => row.id === membership.userTypeId),
    );
    return (
      canManage &&
      (platform ||
        (membership.active &&
          membership.organizationId === identity.organizationId &&
          level !== null &&
          level < identity.level))
    );
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      confirmation.current?.destroy();
      cancelGuard.current?.();
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !open && !locked.current)
        void memberships.refetch({ cancelRefetch: false });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [memberships.refetch, open]);
  useEffect(() => {
    if (!open && !saving) return;
    return registerOrganizationChangeGuard(() => {
      if (locked.current) return false;
      return new Promise<boolean>((resolve) => {
        const finish = (discard: boolean) => {
          cancelGuard.current = null;
          confirmation.current = null;
          if (discard) {
            setOpen(false);
            form.resetFields();
          }
          resolve(discard);
        };
        cancelGuard.current = () => resolve(false);
        confirmation.current = modal.confirm({
          title: "Discard unsaved changes?",
          content: "The organization membership has not been added.",
          okText: "Discard",
          cancelText: "Keep editing",
          onOk: () => finish(true),
          onCancel: () => finish(false),
        });
      });
    });
  }, [open, saving, form, modal, registerOrganizationChangeGuard]);

  async function refreshRelatedMemberships(epoch: number) {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["user-organizations", epoch, user.id],
      }),
      ...["users", "usergroups"].map((resource) =>
        invalidate({ resource, invalidates: ["list", "detail"] }),
      ),
      queryClient.invalidateQueries({
        queryKey: ["notification-readiness", epoch],
      }),
      ...(identity.id === user.id
        ? [
            queryClient.invalidateQueries({
              queryKey: ["organization-memberships"],
            }),
          ]
        : []),
    ]);
  }

  async function changeMembership(organizationId: string, userTypeId?: string) {
    if (
      !mounted.current ||
      getSessionEpoch() !== viewEpoch ||
      locked.current ||
      !canManage ||
      memberships.isError ||
      memberships.isFetching
    )
      return;
    const adding = userTypeId !== undefined;
    const existing = rows.find((row) => row.organizationId === organizationId);
    if (
      adding
        ? !organizationOptions.some(
            (option) => option.value === organizationId,
          ) || !roleOptions.some((option) => option.value === userTypeId)
        : !existing || !canRemove(existing)
    )
      return;
    const epoch = getSessionEpoch();
    locked.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await request<{ sessionEnded?: boolean }>(
        `/api/users/${encodeURIComponent(user.id!)}/organizations/${encodeURIComponent(organizationId)}`,
        {
          method: adding ? "PUT" : "DELETE",
          ...(adding ? { body: JSON.stringify({ userTypeId }) } : {}),
        },
      );
      if (getSessionEpoch() !== epoch) return;
      if (response.sessionEnded) {
        message.success("Membership changed. Sign in again to continue.");
        await refreshOrganizationSession().catch(() => {});
        if (!getSession()) navigate("/login", { replace: true });
        return;
      }
      if (mounted.current) {
        setOpen(false);
        form.resetFields();
        message.success(
          adding
            ? "Organization membership added."
            : "Organization membership removed.",
        );
      }
      await refreshRelatedMemberships(epoch);
    } catch (failure) {
      if (
        getSessionEpoch() === epoch &&
        (failure as Error).name !== "AbortError"
      ) {
        if (mounted.current)
          setError(
            (failure as Error).message ||
              "Organization membership could not be changed.",
          );
        // An uncertain reply may follow a committed write. Refresh; never replay it.
        void refreshRelatedMemberships(epoch).catch(() => {});
      }
    } finally {
      locked.current = false;
      if (mounted.current && getSessionEpoch() === epoch) setSaving(false);
    }
  }

  function removeMembership(membership: OrganizationMembership) {
    if (locked.current || !canRemove(membership)) return;
    confirmation.current = modal.confirm({
      title: "Remove organization membership?",
      content: (
        <>
          <p>
            {referenceTitle(
              organizationRows,
              membership.organizationId,
              "Organization",
            )}
          </p>
          <p>
            This removes the user's access to this organization.
            {currentMembership(membership.organizationId)
              ? " Removing your active membership signs you out."
              : " Their other organization memberships remain available."}
          </p>
        </>
      ),
      okText: "Remove",
      okButtonProps: { danger: true },
      onOk: async () => {
        await changeMembership(membership.organizationId);
        confirmation.current = null;
      },
      onCancel: () => {
        confirmation.current = null;
      },
    });
  }

  if (memberships.isError)
    return (
      <ErrorNotice
        error={memberships.error}
        retry={() => void memberships.refetch()}
      />
    );
  return (
    <>
      {error && (
        <Alert type="error" showIcon message={error} className="page-alert" />
      )}
      <div className="table-toolbar">
        <Space wrap>
          <Button
            icon={<ReloadOutlined />}
            loading={memberships.isFetching}
            disabled={saving}
            onClick={() => {
              setError("");
              void memberships.refetch();
            }}
          >
            Refresh
          </Button>
          {canManage && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={
                saving || memberships.isFetching || !memberships.isSuccess
              }
              onClick={() => {
                setError("");
                setOpen(true);
              }}
            >
              Add organization
            </Button>
          )}
        </Space>
      </div>
      <Table<OrganizationMembership>
        rowKey="organizationId"
        loading={memberships.isLoading || saving}
        dataSource={rows}
        scroll={{ x: 640 }}
        pagination={{ pageSize: 10 }}
        locale={{ emptyText: "No organization memberships." }}
        columns={[
          {
            title: "Organization",
            render: (_, row) =>
              referenceTitle(
                organizationRows,
                row.organizationId,
                "Organization",
              ),
          },
          {
            title: "User type",
            render: (_, row) =>
              referenceTitle(roleRows, row.userTypeId, "User type"),
          },
          {
            title: "Status",
            render: (_, row) => (
              <Tag color={row.active ? "green" : "default"}>
                {row.active ? "Enabled" : "Disabled"}
              </Tag>
            ),
          },
          ...(canManage
            ? [
                {
                  title: "",
                  key: "actions",
                  render: (_: unknown, row: OrganizationMembership) =>
                    canRemove(row) ? (
                      <Button
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        disabled={saving || memberships.isFetching}
                        onClick={() => removeMembership(row)}
                      >
                        Remove
                      </Button>
                    ) : null,
                },
              ]
            : []),
        ]}
      />
      <Modal
        title="Add organization"
        open={open}
        onCancel={() => {
          if (!locked.current) {
            setOpen(false);
            form.resetFields();
            setError("");
          }
        }}
        onOk={() => form.submit()}
        okText="Add"
        confirmLoading={saving}
        cancelButtonProps={{ disabled: saving }}
        closable={!saving}
        maskClosable={!saving}
        keyboard={!saving}
        okButtonProps={{
          disabled:
            !memberships.isSuccess ||
            memberships.isFetching ||
            roles.query.isError ||
            roles.query.isLoading ||
            !roleOptions.length ||
            (platform &&
              (organizations.query.isError || organizations.query.isLoading)) ||
            !organizationOptions.length,
        }}
      >
        {error && (
          <Alert type="error" showIcon message={error} className="page-alert" />
        )}
        <Typography.Paragraph>
          Choose the organization and the user's role in that organization.
        </Typography.Paragraph>
        {platform && (
          <ErrorNotice
            error={organizations.query.error}
            retry={() => void organizations.query.refetch()}
          />
        )}
        <ErrorNotice
          error={roles.query.error}
          retry={() => void roles.query.refetch()}
        />
        {roles.query.isSuccess && !roleOptions.length && (
          <Alert
            type="info"
            message="There are no permitted user types available."
            className="page-alert"
          />
        )}
        {(organizations.result.limited || roles.result.limited) && (
          <Alert
            type="warning"
            showIcon
            message="Some organization or user type options may be missing because the service returned a limited list."
            className="page-alert"
          />
        )}
        {!organizationOptions.length &&
          !organizations.query.isLoading &&
          !organizations.query.isError && (
            <Alert
              type="info"
              message="There are no additional organizations available to add."
              className="page-alert"
            />
          )}
        <Form
          form={form}
          layout="vertical"
          disabled={saving}
          onFinish={({ organizationId, userTypeId }) =>
            void changeMembership(organizationId, userTypeId)
          }
        >
          <Form.Item
            name="organizationId"
            label="Organization"
            rules={[{ required: true, message: "Choose an organization." }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Choose organization"
              options={organizationOptions}
              loading={organizations.query.isLoading}
            />
          </Form.Item>
          <Form.Item
            name="userTypeId"
            label="User type"
            rules={[{ required: true, message: "Choose a user type." }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Choose user type"
              options={roleOptions}
              loading={roles.query.isLoading}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
