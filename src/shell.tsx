import { useEffect, useState } from "react";
import {
  Layout,
  Menu,
  Select,
  Space,
  Button,
  Avatar,
  Dropdown,
  Typography,
  Alert,
  Drawer,
} from "antd";
import {
  AppstoreOutlined,
  TeamOutlined,
  ApartmentOutlined,
  SettingOutlined,
  SafetyOutlined,
  HistoryOutlined,
  LogoutOutlined,
  UserOutlined,
  MenuOutlined,
  DeploymentUnitOutlined,
} from "@ant-design/icons";
import { useList, useLogout } from "@refinedev/core";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import {
  resources,
  resourceMap,
  recordTitle,
  type RecordData,
} from "../shared/resources";
import { useAdmin } from "./context";

const groupIcons: Record<string, React.ReactNode> = {
  "People & assets": <TeamOutlined />,
  Equipment: <ApartmentOutlined />,
  Automation: <DeploymentUnitOutlined />,
  Activity: <HistoryOutlined />,
  Configuration: <SettingOutlined />,
  Access: <SafetyOutlined />,
};
export function Shell() {
  const { identity, organization, setOrganization, can } = useAdmin();
  const { mutate: logout } = useLogout();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobile, setMobile] = useState(false);
  const organizations = useList<RecordData>({
    resource: "organizations",
    pagination: { mode: "off" },
    queryOptions: { enabled: can(resourceMap.organizations, "list") },
    errorNotification: false,
  });
  useEffect(() => {
    const handler = () => navigate("/login", { replace: true });
    window.addEventListener("session-expired", handler);
    return () => window.removeEventListener("session-expired", handler);
  }, [navigate]);
  const nav = [
    { key: "/", icon: <AppstoreOutlined />, label: "Overview" },
    ...Object.entries(groupIcons)
      .map(([group, icon]) => ({
        key: group,
        label: group,
        icon,
        children: resources
          .filter((r) => r.group === group && can(r, "list"))
          .map((r) => ({ key: `/${r.name}`, label: r.label })),
      }))
      .filter((g) => g.children.length),
    ...(can(resourceMap.sensors, "list")
      ? [
          {
            key: "/sensor-history",
            icon: <HistoryOutlined />,
            label: "Sensor history",
          },
        ]
      : []),
    ...(identity.level >= 90
      ? [
          {
            key: "/services",
            icon: <DeploymentUnitOutlined />,
            label: "Service status",
          },
        ]
      : []),
  ];
  const sidebar = (
    <>
      <Link to="/" className="brand">
        <span className="brand-mark">T</span>
        <span>
          tronicare<small>ADMINISTRATION</small>
        </span>
      </Link>
      <Menu
        theme="dark"
        mode="inline"
        items={nav}
        selectedKeys={[`/${location.pathname.split("/")[1]}`]}
        defaultOpenKeys={["People & assets", "Equipment"]}
        onClick={({ key }) => {
          navigate(key);
          setMobile(false);
        }}
      />
      <div className="sidebar-footer">
        Platform workspace<span>Administration v2</span>
      </div>
    </>
  );
  return (
    <Layout className="app-layout">
      <Layout.Sider
        width={238}
        breakpoint="lg"
        collapsedWidth="0"
        trigger={null}
        className="desktop-sidebar"
      >
        {sidebar}
      </Layout.Sider>
      <Drawer
        placement="left"
        open={mobile}
        onClose={() => setMobile(false)}
        width={260}
        styles={{ body: { padding: 0, background: "#102d42" } }}
      >
        {sidebar}
      </Drawer>
      <Layout>
        <Layout.Header className="topbar">
          <Space size="middle">
            <Button
              icon={<MenuOutlined />}
              onClick={() => setMobile(true)}
              className="mobile-menu"
              aria-label="Open navigation"
            />
            <Typography.Text className="workspace-label">
              Workspace
            </Typography.Text>
            <Select
              aria-label="Organization"
              className="organization-picker"
              value={organization}
              showSearch
              optionFilterProp="label"
              loading={organizations.query.isLoading}
              disabled={identity.level < 90}
              onChange={(id) => {
                setOrganization(id);
                navigate("/");
              }}
              options={[
                ...(identity.level >= 90
                  ? [{ value: "", label: "All accessible organizations" }]
                  : []),
                ...(organizations.result.data ?? []).map((r) => ({
                  value: r.id!,
                  label: recordTitle(r),
                })),
                ...(!organizations.result.data?.some(
                  (r) => r.id === identity.organizationId,
                ) && identity.level < 90
                  ? [
                      {
                        value: identity.organizationId,
                        label: `Organization ${identity.organizationId}`,
                      },
                    ]
                  : []),
              ]}
            />
          </Space>
          <Dropdown
            menu={{
              items: [
                {
                  key: "account",
                  icon: <UserOutlined />,
                  label: "My account",
                  onClick: () => navigate("/account"),
                },
                {
                  key: "logout",
                  icon: <LogoutOutlined />,
                  label: "Sign out",
                  onClick: () => logout(),
                },
              ],
            }}
          >
            <Button
              type="text"
              className="account-button"
              aria-label="Account menu"
            >
              <Avatar
                size="small"
                style={{ background: "#e5f3f3", color: "#087f8c" }}
              >
                {identity.name[0]}
              </Avatar>
              <span>{identity.name}</span>
            </Button>
          </Dropdown>
        </Layout.Header>
        <Layout.Content className="main-content">
          {identity.mustChangePassword && (
            <Alert
              className="page-alert"
              type="warning"
              showIcon
              message="Set a new password to enable changes"
              action={<Link to="/account">Change password</Link>}
            />
          )}
          <div key={organization}>
            <Outlet />
          </div>
        </Layout.Content>
        <Layout.Footer className="app-footer">
          Tronicare administration{" "}
          <span>Connected to your configured services</span>
        </Layout.Footer>
      </Layout>
    </Layout>
  );
}
