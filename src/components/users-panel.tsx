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
import { PageHeader } from "@/components/page-header";
import { ROLE_META, type UserRole } from "@/lib/roles";
import { formatDate } from "@/lib/status";

type Row = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  createdAt: string;
  allowedTemplates: string[];
  allowedAccents: string[];
  isSelf: boolean;
  canModify: boolean;
  canEdit: boolean;
  /** Whose team the account is on, by that subadmin's name. */
  team: string | null;
  /** For a subadmin: what their team holds, shown before deleting them. */
  teamSize: { users: number; profiles: number } | null;
};

type Props = {
  rows: Row[];
  creatableRoles: UserRole[];
  serviceRoleConfigured: boolean;
  /** The super admin's view: which team each account belongs to. */
  showTeams: boolean;
  /** Every subadmin, as the candidates to inherit a team being removed. */
  subadmins: Array<{ id: string; label: string }>;
  /** The full style vocabulary, for the per-account allowance pickers. */
  allTemplates: Array<{ value: string; label: string }>;
  allAccents: string[];
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
  currentPassword?: string;
  allowedTemplates: string[];
  allowedAccents: string[];
};

export function UsersPanel({
  rows,
  creatableRoles,
  serviceRoleConfigured,
  showTeams,
  subadmins,
  allTemplates,
  allAccents,
}: Props) {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [editForm] = Form.useForm<EditValues>();
  const [removing, setRemoving] = useState<Row | null>(null);
  /**
   * Whether the edit form shows a password field at all.
   *
   * Hidden until asked for, because a visible password input in an edit form
   * is one a browser will autofill — with the *signed-in* person's saved
   * password — and saving the form to fix a name then silently resets the
   * other account's password to it. That is exactly how a subadmin got locked
   * out. No field, nothing to autofill.
   */
  const [changingPassword, setChangingPassword] = useState(false);
  const editedEmail = Form.useWatch("email", editForm);
  const [inheritor, setInheritor] = useState<string | undefined>();

  const saveEdit = async (values: EditValues) => {
    if (!editing) return;
    setBusy(true);
    const result = await updateUser({
      id: editing.id,
      name: values.name,
      email: values.email,
      // Only when asked for, and blank still means "leave it alone".
      password:
        changingPassword && values.password?.trim() ? values.password : undefined,
      currentPassword: values.currentPassword || undefined,
      allowedTemplates: values.allowedTemplates ?? [],
      allowedAccents: values.allowedAccents ?? [],
    });
    setBusy(false);

    if (!result.ok) {
      message.error(result.error);
      return;
    }
    message.success(
      changingPassword && values.password?.trim()
        ? `Saved. ${editing.isSelf ? "Your" : `${editing.name ?? editing.email}'s`} password has changed.`
        : "Account updated.",
    );
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

  const remove = async (id: string, inheritorId?: string) => {
    setBusy(true);
    const result = await deleteUser(id, inheritorId);
    setBusy(false);
    if (!result.ok) {
      message.error(result.error);
      return false;
    }
    message.success(inheritorId ? "Team moved and account removed." : "Account removed.");
    router.refresh();
    return true;
  };

  const removingHasTeam = Boolean(
    removing?.teamSize && (removing.teamSize.users || removing.teamSize.profiles),
  );
  const inheritors = subadmins.filter((s) => s.id !== removing?.id);

  return (
    <>
      <PageHeader
        title="Users"
        description="Accounts are only created here. A new person also needs their browser approved in Trueward Auth before any site lets them in."
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setOpen(true)}
            disabled={!serviceRoleConfigured || creatableRoles.length === 0}
          >
            {creatableRoles.length === 1
              ? `Add ${ROLE_META[creatableRoles[0]].label.toLowerCase()}`
              : "Add user"}
          </Button>
        }
      />

      {!serviceRoleConfigured && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="Account management is disabled"
          description="Set SUPABASE_SERVICE_ROLE_KEY in the environment to add, edit and remove accounts from here. Accounts are only ever created from this page — there is no public sign-up."
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
            ...(showTeams
              ? [
                  {
                    title: "Team",
                    key: "team",
                    render: (_: unknown, row: Row) =>
                      row.teamSize ? (
                        <Typography.Text type="secondary">
                          {row.teamSize.users} bidder{row.teamSize.users === 1 ? "" : "s"} ·{" "}
                          {row.teamSize.profiles} profile
                          {row.teamSize.profiles === 1 ? "" : "s"}
                        </Typography.Text>
                      ) : (
                        (row.team ?? <Typography.Text type="secondary">—</Typography.Text>)
                      ),
                  },
                ]
              : []),
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
                      aria-label={`Edit ${row.name ?? row.email}`}
                      onClick={() => {
                        setEditing(row);
                        setChangingPassword(false);
                        editForm.setFieldsValue({
                          name: row.name ?? "",
                          email: row.email,
                          password: "",
                          currentPassword: "",
                          allowedTemplates: row.allowedTemplates,
                          allowedAccents: row.allowedAccents,
                        });
                      }}
                    />
                  )}
                  {row.canModify &&
                    (row.role === "subadmin" ? (
                      // A subadmin is a team, so removing one is a decision
                      // about where that team goes — a dialog, not a popconfirm.
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={`Remove ${row.name ?? row.email}`}
                        onClick={() => {
                          setInheritor(undefined);
                          setRemoving(row);
                        }}
                      />
                    ) : (
                      <Popconfirm
                        title="Remove this account?"
                        description="Their applications and resumes stay with the team; they lose access."
                        onConfirm={() => remove(row.id)}
                        okButtonProps={{ danger: true }}
                      >
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label={`Remove ${row.name ?? row.email}`}
                        />
                      </Popconfirm>
                    ))}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={
          creatableRoles.length === 1
            ? `Add a ${ROLE_META[creatableRoles[0]].label.toLowerCase()}`
            : "Add a user"
        }
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
          {creatableRoles.length === 1 && (
            <Typography.Paragraph type="secondary">
              {ROLE_META[creatableRoles[0]].description}
            </Typography.Paragraph>
          )}
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
          <Form.Item name="role" label="Role" hidden={creatableRoles.length === 1}>
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
          {changingPassword ? (
            <Form.Item
              name="password"
              label="New password"
              extra={
                editing?.isSelf
                  ? "At least 8 characters."
                  : "They sign in with this from now on — tell them what it is."
              }
              rules={[
                { required: true, message: "Enter the new password" },
                { min: 8, message: "At least 8 characters" },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          ) : (
            <Form.Item>
              <Button onClick={() => setChangingPassword(true)}>Change password</Button>
            </Form.Item>
          )}
          {editing?.isSelf &&
            (changingPassword || (editedEmail ?? "").trim() !== editing.email) && (
            // Only on your own account: whoever manages an account resets it
            // without knowing the old password, which is the point of
            // managing it.
            <Form.Item
              name="currentPassword"
              label="Current password"
              extra="Needed to change your own email or password."
              rules={[{ required: true, message: "Enter your current password" }]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
          )}
          {editing?.canModify && (
            <>
              <Form.Item
                name="allowedTemplates"
                label="Templates they may use"
                extra="Leave empty to allow every template."
              >
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="All templates"
                  options={allTemplates}
                />
              </Form.Item>
              <Form.Item
                name="allowedAccents"
                label="Accents they may use"
                extra="Leave empty to allow every accent."
              >
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="All accents"
                  options={allAccents.map((a) => ({ value: a, label: a }))}
                />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      <Modal
        title={`Remove ${removing?.name ?? removing?.email ?? "subadmin"}`}
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        onOk={async () => {
          if (!removing) return;
          if (await remove(removing.id, inheritor)) setRemoving(null);
        }}
        confirmLoading={busy}
        okText={inheritor ? "Move team and remove" : "Remove"}
        okButtonProps={{ danger: true, disabled: removingHasTeam && !inheritor }}
        destroyOnHidden
      >
        {removingHasTeam ? (
          <>
            <Typography.Paragraph>
              Their team has{" "}
              <strong>
                {removing?.teamSize?.users} bidder
                {removing?.teamSize?.users === 1 ? "" : "s"}
              </strong>{" "}
              and{" "}
              <strong>
                {removing?.teamSize?.profiles} profile
                {removing?.teamSize?.profiles === 1 ? "" : "s"}
              </strong>
              . Choose who takes it over. Everything moves to them — bidders,
              profiles, resumes, applications, the blocklist, and the
              calendar events this subadmin created — and then the account is
              removed.
            </Typography.Paragraph>
            {inheritors.length === 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                title="There is no other subadmin to take this team. Add one first."
              />
            )}
          </>
        ) : (
          <Typography.Paragraph>
            Their team is empty, so nothing else is affected. You can still pick
            someone to take over the calendar events they created; otherwise
            only the super admin will be able to change those.
          </Typography.Paragraph>
        )}
        <Select
          style={{ width: "100%" }}
          placeholder="Subadmin to take over"
          allowClear
          value={inheritor}
          onChange={setInheritor}
          options={inheritors.map((s) => ({ value: s.id, label: s.label }))}
        />
      </Modal>
    </>
  );
}
