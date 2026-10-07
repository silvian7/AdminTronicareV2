import { useState } from "react";
import { useLogin } from "@refinedev/core";
import {
  Form,
  Input,
  Button,
  Typography,
  Alert,
  Segmented,
  Card,
  App,
  Modal,
  Descriptions,
} from "antd";
import {
  LockOutlined,
  UserOutlined,
  ArrowRightOutlined,
} from "@ant-design/icons";
import { loadSession, request } from "../api";
import { useAdmin } from "../context";

export function Login() {
  const { mutate: login, isPending } = useLogin();
  const [mode, setMode] = useState("password");
  const [recover, setRecover] = useState(false);
  const [error, setError] = useState("");
  const [recoveryResult, setRecoveryResult] = useState("");
  const [recovering, setRecovering] = useState(false);
  return (
    <main className="login-page">
      <div className="login-story">
        <div className="brand">
          <span className="brand-mark">T</span>
          <span>
            tronicare<small>ADMINISTRATION</small>
          </span>
        </div>
        <div>
          <span className="eyebrow">YOUR PLATFORM, IN VIEW</span>
          <h1>
            People. Equipment.
            <br />
            Connected care.
          </h1>
          <p>
            Manage your organizations, assets and devices from one workspace.
          </p>
        </div>
        <span className="login-footer">Tronicare platform</span>
      </div>
      <div className="login-panel">
        <div className="login-form">
          <Typography.Title level={2}>Welcome back</Typography.Title>
          <Typography.Paragraph type="secondary">
            Sign in to your administration workspace.
          </Typography.Paragraph>
          <Segmented
            block
            value={mode}
            onChange={setMode}
            options={[
              { label: "Password", value: "password" },
              { label: "One-time code", value: "code" },
            ]}
            className="login-mode"
          />
          {error && (
            <Alert
              type="error"
              showIcon
              message={error}
              className="page-alert"
            />
          )}
          <Form
            layout="vertical"
            requiredMark={false}
            onFinish={(values) => {
              setError("");
              login(
                { ...values, mode },
                {
                  onSuccess: (result) => {
                    if (!result.success)
                      setError(result.error?.message ?? "Sign in failed.");
                  },
                },
              );
            }}
          >
            <Form.Item
              name="login"
              label="Login"
              rules={[{ required: true, message: "Enter your login." }]}
            >
              <Input
                prefix={<UserOutlined />}
                size="large"
                autoComplete="username"
                autoFocus
                maxLength={50}
              />
            </Form.Item>
            <Form.Item
              name="password"
              label={mode === "code" ? "One-time code" : "Password"}
              rules={[{ required: true, message: "Enter your credential." }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                size="large"
                autoComplete={
                  mode === "code" ? "one-time-code" : "current-password"
                }
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              block
              size="large"
              loading={isPending}
              icon={<ArrowRightOutlined />}
              iconPosition="end"
            >
              Sign in
            </Button>
          </Form>
          <Button
            type="link"
            onClick={() => setRecover(true)}
            className="recovery-link"
          >
            Forgot your password?
          </Button>
        </div>
      </div>
      <Modal
        title="Request a password code"
        open={recover}
        footer={null}
        onCancel={() => setRecover(false)}
        destroyOnHidden
      >
        {recoveryResult ? (
          <Alert type="success" message={recoveryResult} />
        ) : (
          <Form
            layout="vertical"
            onFinish={async (values) => {
              setRecovering(true);
              try {
                const result = await request<{ message: string }>(
                  "/api/session/recover",
                  { method: "POST", body: JSON.stringify(values) },
                );
                setRecoveryResult(result.message);
              } catch (e) {
                setError((e as Error).message);
                setRecover(false);
              } finally {
                setRecovering(false);
              }
            }}
          >
            <Form.Item name="login" label="Login" rules={[{ required: true }]}>
              <Input autoComplete="username" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={recovering}>
              Request code
            </Button>
          </Form>
        )}
      </Modal>
    </main>
  );
}
export function Account() {
  const { identity } = useAdmin();
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form] = Form.useForm();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ACCOUNT</span>
          <h1>My account</h1>
          <p>Profile and sign-in settings.</p>
        </div>
      </div>
      <div className="two-column">
        <Card title="Profile">
          <Descriptions
            column={1}
            items={[
              { key: "name", label: "Name", children: identity.name },
              { key: "id", label: "User ID", children: identity.id },
              {
                key: "org",
                label: "Organization ID",
                children: identity.organizationId,
              },
            ]}
          />
        </Card>
        <Card title="Change password">
          {error && (
            <Alert className="page-alert" type="error" message={error} />
          )}
          <Form
            form={form}
            layout="vertical"
            onFinish={async (values) => {
              setSaving(true);
              setError("");
              try {
                await request("/api/session/password", {
                  method: "POST",
                  body: JSON.stringify({ password: values.password }),
                });
                await loadSession();
                form.resetFields();
                message.success("Password updated.");
                window.location.assign("/");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            <Form.Item
              name="password"
              label="New password"
              rules={[
                {
                  required: true,
                  min: 12,
                  message: "Use at least 12 characters.",
                },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              name="confirm"
              label="Confirm password"
              dependencies={["password"]}
              rules={[
                { required: true },
                ({ getFieldValue }) => ({
                  validator: (_, value) =>
                    !value || getFieldValue("password") === value
                      ? Promise.resolve()
                      : Promise.reject(new Error("Passwords do not match.")),
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={saving}>
              Update password
            </Button>
          </Form>
        </Card>
      </div>
    </>
  );
}
