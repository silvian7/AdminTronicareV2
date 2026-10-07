import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { Refine, Authenticated } from "@refinedev/core";
import { useNotificationProvider } from "@refinedev/antd";
import routerProvider from "@refinedev/react-router";
import { App as AntApp, ConfigProvider, Result, Button } from "antd";
import {
  createBrowserRouter,
  RouterProvider,
  Routes,
  Route,
  Navigate,
} from "react-router";
import {
  authProvider,
  dataProvider,
  getSession,
  getSessionRevision,
  subscribeSessionChange,
} from "./api";
import { resources, canAccess, type Operation } from "../shared/resources";
import { AdminProvider } from "./context";
import { Shell } from "./shell";
import { Login, Account } from "./pages/auth";
import { Overview, Services } from "./pages/overview";
import {
  ResourceList,
  ResourceDetail,
  ResourceEditor,
} from "./pages/resources";
import { SensorHistory } from "./pages/history";
import "antd/dist/reset.css";
import "./styles.css";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 15000,
        refetchOnWindowFocus: false,
      },
    },
  });
}
let queryClient = createQueryClient();
subscribeSessionChange(() => {
  const previous = queryClient;
  queryClient = createQueryClient();
  void previous.cancelQueries();
  previous.clear();
});

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Result
        status="error"
        title="This view could not be loaded"
        subTitle="Reload the application to try again."
        extra={<Button onClick={() => window.location.reload()}>Reload</Button>}
      />
    ) : (
      this.props.children
    );
  }
}
function Application() {
  const sessionRevision = React.useSyncExternalStore(
    subscribeSessionChange,
    getSessionRevision,
  );
  return (
    <Refine
      key={sessionRevision}
      dataProvider={dataProvider}
      authProvider={authProvider}
      routerProvider={routerProvider}
      notificationProvider={useNotificationProvider}
      accessControlProvider={{
        can: async ({ resource, action }) => ({
          can:
            !!getSession() &&
            canAccess(
              getSession()!.identity,
              resource ?? "",
              action as Operation,
            ),
        }),
      }}
      resources={resources.map((r) => ({
        name: r.name,
        list: `/${r.name}`,
        show: `/${r.name}/:id`,
        create: `/${r.name}/new`,
        edit: `/${r.name}/:id/edit`,
        meta: { label: r.label },
      }))}
      options={{
        disableTelemetry: true,
        syncWithLocation: true,
        mutationMode: "pessimistic",
        reactQuery: {
          clientConfig: queryClient,
        },
      }}
    >
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <Authenticated
              key="protected"
              fallback={<Navigate to="/login" replace />}
            >
              <AdminProvider>
                <Shell />
              </AdminProvider>
            </Authenticated>
          }
        >
          <Route index element={<Overview />} />
          <Route path="/account" element={<Account />} />
          <Route path="/services" element={<Services />} />
          <Route path="/sensor-history" element={<SensorHistory />} />
          {resources.map((resource) => (
            <Route key={resource.name} path={resource.name}>
              <Route index element={<ResourceList resource={resource} />} />
              <Route
                path="new"
                element={<ResourceEditor resource={resource} mode="create" />}
              />
              <Route
                path=":id"
                element={<ResourceDetail resource={resource} />}
              />
              <Route
                path=":id/edit"
                element={<ResourceEditor resource={resource} mode="edit" />}
              />
            </Route>
          ))}
          <Route
            path="*"
            element={
              <Result
                status="404"
                title="Page not found"
                extra={<Button href="/">Back to overview</Button>}
              />
            }
          />
        </Route>
      </Routes>
    </Refine>
  );
}
const router = createBrowserRouter([{ path: "*", element: <Application /> }]);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: "#087f8c",
            colorInfo: "#087f8c",
            colorText: "#163246",
            colorBgLayout: "#f2f5f8",
            borderRadius: 8,
            fontSize: 14,
            fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif',
          },
          components: {
            Layout: { siderBg: "#102d42", headerBg: "#ffffff" },
            Table: { headerBg: "#f5f8fa" },
            Menu: {
              darkItemBg: "#102d42",
              darkSubMenuItemBg: "#0e2638",
              darkItemSelectedBg: "#165569",
            },
          },
        }}
      >
        <AntApp>
          <RouterProvider router={router} />
        </AntApp>
      </ConfigProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
