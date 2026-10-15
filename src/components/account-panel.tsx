"use client";

import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { App, Button, Card, Col, Form, Input, Row, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { updateUser } from "@/app/dashboard/users/actions";

type PasswordValues = { currentPassword: string; password: string; confirm: string };

/**
 * Name and password for the signed-in account. The same password signs in to
 * every Trueward site, the calendar included.
 */
export function AccountPanel({ id, name, email, role }: { id: string; name: string; email: string; role: string }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [passwordForm] = Form.useForm<PasswordValues>();
  const [savingName, setSavingName] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const saveName = async ({ name: next }: { name: string }) => {
    setSavingName(true);
    const result = await updateUser({ id, name: next });
    setSavingName(false);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    message.success("Name saved.");
    router.refresh();
  };

  const savePassword = async (values: PasswordValues) => {
    setSavingPassword(true);
    const result = await updateUser({ id, password: values.password, currentPassword: values.currentPassword });
    setSavingPassword(false);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    passwordForm.resetFields();
    message.success("Password changed. Use the new one next time you sign in, on every Trueward site.");
  };

  return (
    <>
      <Typography.Title level={3} style={{ margin: 0, letterSpacing: "-0.02em" }}>
        Account
      </Typography.Title>
      <Typography.Text type="secondary">
        {email} · {role}
      </Typography.Text>

      <Row gutter={[16, 16]} style={{ marginTop: 20 }}>
        <Col xs={24} lg={12}>
          <Card
            variant="borderless"
            title={
              <span>
                <UserOutlined style={{ marginRight: 8, color: "#4f46e5" }} />
                Profile
              </span>
            }
          >
            <Form layout="vertical" initialValues={{ name }} onFinish={saveName} requiredMark={false}>
              <Form.Item
                name="name"
                label="Name"
                rules={[{ required: true, whitespace: true, message: "Enter your name." }]}
              >
                <Input maxLength={80} />
              </Form.Item>
              <Form.Item label="Email" extra="Your email is changed by whoever manages your account.">
                <Input value={email} disabled />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={savingName}>
                Save name
              </Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            variant="borderless"
            title={
              <span>
                <LockOutlined style={{ marginRight: 8, color: "#4f46e5" }} />
                Password
              </span>
            }
          >
            <Form form={passwordForm} layout="vertical" onFinish={savePassword} requiredMark={false}>
              <Form.Item
                name="currentPassword"
                label="Current password"
                rules={[{ required: true, message: "Enter your current password." }]}
              >
                <Input.Password autoComplete="current-password" />
              </Form.Item>
              <Form.Item
                name="password"
                label="New password"
                rules={[
                  { required: true, message: "Enter a new password." },
                  { min: 8, message: "At least 8 characters." },
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="confirm"
                label="Confirm new password"
                dependencies={["password"]}
                rules={[
                  { required: true, message: "Type the new password again." },
                  ({ getFieldValue }) => ({
                    validator: (_, value) =>
                      !value || value === getFieldValue("password")
                        ? Promise.resolve()
                        : Promise.reject(new Error("The two passwords don't match.")),
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={savingPassword}>
                Change password
              </Button>
            </Form>
          </Card>
        </Col>
      </Row>
    </>
  );
}
