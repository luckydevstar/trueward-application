"use client";

import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createUser, deleteUser, updateUser } from "@/app/dashboard/users/actions";
import { ROLE_META, type UserRole } from "@/lib/roles";
import { formatDate } from "@/lib/status";

type Row = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  createdAt: string;
  isSelf: boolean;
  canModify: boolean;
  canEdit: boolean;
  canChangeRole: boolean;
};

type Props = {
  rows: Row[];
  creatableRoles: UserRole[];
  serviceRoleConfigured: boolean;
};

type FormValues = {
  email: string;
  password: string;
  name: string;
  role: UserRole;
};

/** Edit reuses the create shape, but the password is optional. */
type EditValues = {
  name: string;
  email: string;
  password?: string;
  role: UserRole;
};

export function UsersPanel({
  rows,
  creatableRoles,
  serviceRoleConfigured,
}: Props) {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [editForm] = Form.useForm<EditValues>();

  const saveEdit = async (values: EditValues) => {
    if (!editing) return;
    setBusy(true);
    const result = await updateUser({
      id: editing.id,
      name: values.name,
      email: values.email,
      // Blank means "leave it alone" rather than "set an empty password", so
      // an admin fixing a typo in someone's name doesn't reset their login.
      password: values.password?.trim() ? values.password : undefined,
      role: editing.canChangeRole ? values.role : undefined,
    });
    setBusy(false);

    if (!result.ok) {
      message.error(result.error);
      return;
    }
    message.success("Account updated.");
    setEditing(null);
    router.refresh();
  };

  const submit = async (values: FormValues) => {
    setBusy(true);
    const result = await createUser(values);
    setBusy(false);

    if (!result.ok) {
      message.error(result.error);
      return;
    }
    message.success("Account created.");
    setOpen(false);
    form.resetFields();
    router.refresh();
  };

  const remove = async (id: string) => {
    const result = await deleteUser(id);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    message.success("Account removed.");
    router.refresh();
  };

  return (
    <>
      <Space
        style={{
          marginBottom: 16,
          width: "100%",
          justifyContent: "space-between",
        }}
      >
        <Typography.Title level={3} style={{ margin: 0 }}>
          Users
        </Typography.Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setOpen(true)}
          disabled={!serviceRoleConfigured || creatableRoles.length === 0}
        >
          Add user
        </Button>
      </Space>

      {!serviceRoleConfigured && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="User creation is disabled"
          description="Set SUPABASE_SERVICE_ROLE_KEY in the environment to create accounts from here. Without it, people can still sign themselves up on the login page — but they'll have no team until an admin assigns one."
        />
      )}

      <Card styles={{ body: { padding: 0 } }}>
        <Table<Row>
          rowKey="id"
          dataSource={rows}
          pagination={false}
          columns={[
            {
              title: "Name",
              dataIndex: "name",
              render: (name: string | null, row) => (
                <Space size={6}>
                  {name ?? row.email}
                  {row.isSelf && <Tag>you</Tag>}
                </Space>
              ),
            },
            { title: "Email", dataIndex: "email" },
            {
              title: "Role",
              dataIndex: "role",
              render: (role: UserRole) => (
                <Tag color={ROLE_META[role].color}>{ROLE_META[role].label}</Tag>
              ),
            },
            {
              title: "Added",
              dataIndex: "createdAt",
              render: (value: string) => formatDate(value),
            },
            {
              title: "",
              width: 96,
              render: (_, row) => (
                <Space size={0}>
                  {row.canEdit && (
                    <Button
                      type="text"
                      icon={<EditOutlined />}
                      onClick={() => {
                        setEditing(row);
                        editForm.setFieldsValue({
                          name: row.name ?? "",
                          email: row.email,
                          password: "",
                          role: row.role,
                        });
                      }}
                    />
                  )}
                  {row.canModify && (
                    <Popconfirm
                      title="Remove this account?"
                      description="Their applications stay, but they lose access."
                      onConfirm={() => remove(row.id)}
                      okButtonProps={{ danger: true }}
                    >
                      <Button type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="Add a user"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={busy}
        okText="Create"
        destroyOnHidden
      >
        <Form<FormValues>
          form={form}
          layout="vertical"
          onFinish={submit}
          requiredMark={false}
          initialValues={{ role: creatableRoles[0] }}
        >
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: "Enter a name" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: "Enter an email" },
              { type: "email", message: "That doesn't look like an email" },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label="Temporary password"
            rules={[
              { required: true, message: "Enter a password" },
              { min: 8, message: "At least 8 characters" },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="role" label="Role">
            <Select
              options={creatableRoles.map((r) => ({
                value: r,
                label: ROLE_META[r].label,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Edit ${editing?.name ?? editing?.email ?? "account"}`}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => editForm.submit()}
        confirmLoading={busy}
        okText="Save"
        destroyOnHidden
      >
        <Form<EditValues>
          form={editForm}
          layout="vertical"
          onFinish={saveEdit}
          requiredMark={false}
        >
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: "Enter a name" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email"
            extra="Changing this changes the address they sign in with."
            rules={[
              { required: true, message: "Enter an email" },
              { type: "email", message: "That doesn't look like an email" },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label="New password"
            extra="Leave blank to keep the current one."
            rules={[{ min: 8, message: "At least 8 characters" }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="role"
            label="Role"
            extra={
              editing && !editing.canChangeRole
                ? editing.isSelf
                  ? "You can't change your own role."
                  : "You can't change this account's role."
                : undefined
            }
          >
            <Select
              disabled={!editing?.canChangeRole}
              options={(editing?.canChangeRole
                ? creatableRoles
                : ([editing?.role].filter(Boolean) as UserRole[])
              ).map((r) => ({ value: r, label: ROLE_META[r].label }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
