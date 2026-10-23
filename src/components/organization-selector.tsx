import { useRef, useState } from "react";
import { useList } from "@refinedev/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, Space, Tag, Tooltip, Typography } from "antd";
import { useNavigate } from "react-router";
import {
  resourceMap,
  translated,
  valueOf,
  type RecordData,
} from "../../shared/resources";
import {
  getSession,
  getSessionEpoch,
  loadOrganizationMemberships,
  switchOrganization,
} from "../api";
import { useAdmin } from "../context";

export function OrganizationSelector({
  organizations,
  onBusyChange,
}: {
  organizations: readonly RecordData[];
  onBusyChange: (busy: boolean) => void;
}) {
  const session = getSession()!;
  const { identity, can, confirmOrganizationChange } = useAdmin();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const memberships = useQuery({
    queryKey: ["organization-memberships", getSessionEpoch()],
    queryFn: loadOrganizationMemberships,
    initialData: session.organizationMemberships,
    enabled: !busy,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: "always",
  });
  const roles = useList<RecordData>({
    resource: "usertypes",
    pagination: { mode: "off" },
    errorNotification: false,
    queryOptions: { enabled: can(resourceMap.usertypes, "list") },
  });
  const roleTitle = (id: string) => {
    const role =
      !roles.query.isError && roles.result.data.find((row) => row.id === id);
    return role
      ? translated(valueOf(role, "Tag")).trim() ||
          translated(valueOf(role, "Label")).trim() ||
          `Role #${id}`
      : `Role #${id}`;
  };
  const active = session.activeOrganizationId;
  const options = [
    ...(active === null
      ? [
          {
            value: "__global",
            label: "Global platform session",
            description: roleTitle(identity.userTypeId),
            disabled: true,
          },
        ]
      : []),
    ...(memberships.isError ? [] : (memberships.data ?? []))
      .filter((membership) => membership.active)
      .map((membership) => {
        const organization = organizations.find(
          (row) => row.id === membership.organizationId,
        );
        return {
          value: membership.organizationId,
          label: organization
            ? translated(valueOf(organization, "Tag")).trim() ||
              `Organization #${membership.organizationId}`
            : `Organization #${membership.organizationId}`,
          description: roleTitle(membership.userTypeId),
          disabled: false,
        };
      }),
  ];
  if (
    typeof active === "string" &&
    !options.some((option) => option.value === active)
  )
    options.unshift({
      value: active,
      label: `Organization #${active}`,
      description: roleTitle(identity.userTypeId),
      disabled: true,
    });

  async function choose(organizationId: string) {
    if (locked.current || organizationId === active) return;
    locked.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      if (!(await confirmOrganizationChange())) return;
      const next = await switchOrganization(organizationId);
      navigate(
        next.identity.mustChangePassword
          ? "/account"
          : next.identity.level >= 90
            ? "/services"
            : "/",
        { replace: true },
      );
    } catch (failure) {
      if (getSession()) {
        setError(
          (failure as Error).message ||
            "The organization could not be changed.",
        );
        void queryClient.invalidateQueries({ queryKey: ["data"] });
      }
    } finally {
      locked.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <div className="active-organization-control">
      <Typography.Text className="workspace-label">
        Active organization
      </Typography.Text>
      <Select
        aria-label="Active organization"
        className="organization-picker active-organization-picker"
        value={
          active === null ? "__global" : (active ?? identity.organizationId)
        }
        options={options}
        showSearch
        optionFilterProp="label"
        optionRender={(option) => (
          <Space direction="vertical" size={0}>
            <span>{option.data.label}</span>
            <Typography.Text type="secondary">
              {option.data.description}
            </Typography.Text>
          </Space>
        )}
        loading={busy || memberships.isFetching}
        disabled={
          busy ||
          memberships.isError ||
          options.filter((option) => !option.disabled).length <
            (active === null ? 1 : 2)
        }
        onChange={(value) => void choose(value)}
      />
      <Tooltip title={`Current role: ${roleTitle(identity.userTypeId)}`}>
        <Tag className="organization-role">
          {roleTitle(identity.userTypeId)}
        </Tag>
      </Tooltip>
      {!busy && (error || memberships.isError) && (
        <Tooltip title={error || "Organization memberships are unavailable."}>
          <Button
            size="small"
            danger
            disabled={busy}
            onClick={() => {
              setError("");
              void memberships.refetch();
            }}
          >
            Retry
          </Button>
        </Tooltip>
      )}
      {error && (
        <span className="organization-switch-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
