import { useEffect, useState } from "react";
import { useList, useLogout } from "@refinedev/core";
import {
  Alert,
  Button,
  Layout,
  Result,
  Select,
  Space,
  Spin,
  Typography,
} from "antd";
import { LogoutOutlined, UserOutlined } from "@ant-design/icons";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useAdmin } from "../context";
import { getSession } from "../api";
import { OrganizationSelector } from "../components/organization-selector";
import {
  resourceMap,
  translated,
  valueOf,
  type RecordData,
} from "../../shared/resources";
import "./care.css";
import { careSubjectUrl, validCareId, useCareOrganizationTags } from "./api";

export function CareLayout() {
  const { identity, organization, setOrganization, can } = useAdmin();
  const { mutate: logout } = useLogout();
  const [busy, setBusy] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const selectedSubject = /^\/care\/subjects\/([1-9]\d*)(?:\/|$)/.exec(
    location.pathname,
  )?.[1];
  const organizations = useList<RecordData>({
    resource: "organizations",
    pagination: { mode: "off" },
    errorNotification: false,
    queryOptions: { enabled: can(resourceMap.organizations, "list") },
  });
  const visibleOrganizations = organizations.query.isError
    ? []
    : (organizations.result.data ?? []);
  const organizationTags = useCareOrganizationTags();
  const tagRows =
    !organizationTags.isError && !organizationTags.isPlaceholderData
      ? (organizationTags.data?.organizations ?? [])
      : [];
  const organizationRows = [
    ...new Map([
      ...visibleOrganizations.map((row) => [row.id, row] as const),
      ...tagRows.map(
        ({ organizationId, tag }) =>
          [
            organizationId,
            {
              id: organizationId,
              m_nIDOrganization: organizationId,
              m_sTag: tag,
            },
          ] as const,
      ),
    ]).values(),
  ];
  const activeOrganization = organizationRows.find(
    (row) => row.id === identity.organizationId,
  );
  const activeOrganizationTag =
    activeOrganization && translated(valueOf(activeOrganization, "Tag")).trim();
  const canRead =
    identity.level >= 90 ||
    identity.permissions.some(
      (permission) =>
        permission.entity.toLowerCase() === "assets" &&
        permission.rights.toLowerCase().includes("r"),
    );
  useEffect(() => {
    const handler = () => navigate("/login", { replace: true });
    window.addEventListener("session-expired", handler);
    return () => window.removeEventListener("session-expired", handler);
  }, [navigate]);
  if (identity.mustChangePassword && location.pathname !== "/care/account")
    return <Navigate to="/care/account" replace />;
  return (
    <Layout className="care-layout">
      <a href="#care-main" className="care-skip">
        Skip to content
      </a>
      <header className="care-header">
        <Link
          to="/care"
          className="care-brand"
          aria-label="TroniCare caregiver overview"
        >
          <span className="brand-mark" aria-hidden="true">
            T
          </span>
          <span>
            TroniCare<small>CAREGIVER PORTAL</small>
          </span>
        </Link>
        <nav aria-label="Caregiver navigation">
          <Link
            to="/care"
            aria-current={location.pathname === "/care" ? "page" : undefined}
          >
            Overview
          </Link>
          {validCareId(selectedSubject) && (
            <>
              <Link
                to={careSubjectUrl(selectedSubject)}
                aria-current={
                  !location.pathname.endsWith("/trends") ? "page" : undefined
                }
              >
                Reports
              </Link>
              <Link
                to={`${careSubjectUrl(selectedSubject)}/trends`}
                aria-current={
                  location.pathname.endsWith("/trends") ? "page" : undefined
                }
              >
                Trends
              </Link>
            </>
          )}
          <Link
            to="/care/account"
            aria-current={
              location.pathname === "/care/account" ? "page" : undefined
            }
          >
            <UserOutlined aria-hidden="true" /> My account
          </Link>
          {!identity.caregiverReadOnly && <Link to="/">Administration</Link>}
        </nav>
        <Space wrap>
          <Typography.Text>{identity.name}</Typography.Text>
          <Button
            icon={<LogoutOutlined aria-hidden="true" />}
            onClick={() => logout()}
          >
            Sign out
          </Button>
        </Space>
      </header>
      <div className="care-context">
        {Array.isArray(getSession()?.organizationMemberships) ? (
          <OrganizationSelector
            organizations={organizationRows}
            onBusyChange={setBusy}
            showLabel={false}
          />
        ) : (
          <Typography.Text>
            {activeOrganizationTag ||
              `Organization #${identity.organizationId}`}
          </Typography.Text>
        )}
        {identity.level >= 90 && !identity.caregiverReadOnly && (
          <Select
            aria-label="Filter organization"
            value={organization}
            style={{ minWidth: 220 }}
            showSearch
            optionFilterProp="label"
            loading={organizations.query.isLoading}
            options={[
              { value: "", label: "All accessible organizations" },
              ...organizationRows
                .filter((row) => row.id && row.id !== "0")
                .map((row) => ({
                  value: row.id!,
                  label:
                    translated(valueOf(row, "Tag")).trim() ||
                    `Organization #${row.id}`,
                })),
            ]}
            onChange={(id) => {
              setOrganization(id);
              navigate("/care");
            }}
          />
        )}
      </div>
      <main id="care-main" className="care-main" tabIndex={-1}>
        {!canRead && location.pathname !== "/care/account" ? (
          <Result
            status="403"
            title="Caregiver access unavailable"
            subTitle="This account does not have permission to view assets."
          />
        ) : busy ? (
          <Spin tip="Switching organization">
            <div className="care-switching" />
          </Spin>
        ) : (
          <Outlet />
        )}
        {identity.mustChangePassword && (
          <Alert
            type="info"
            showIcon
            message="Update your password to continue."
          />
        )}
      </main>
      <footer className="care-footer">
        TroniCare · Observations and stored reports
      </footer>
    </Layout>
  );
}
