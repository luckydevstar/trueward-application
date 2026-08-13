"use client";

import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  createProfile,
  deleteProfile,
  replaceProfileAssignees,
} from "@/app/dashboard/profiles/actions";
import { setSsn } from "@/app/dashboard/profiles/ssn-actions";
import { ResizableTitle } from "@/components/grid/resizable-title";
import {
  ProfileEditor,
  type ProfileFormValues,
} from "@/components/profile-editor";
import { useColumnWidths } from "@/lib/column-widths";
import { toProfileRow } from "@/lib/profile-form";
import { formatDate } from "@/lib/status";

export type ProfileRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  updated_at: string;
  has_ssn: boolean;
  assignee_ids: string[];
};

type Props = {
  canEdit: boolean;
  canAssign: boolean;
  rows: ProfileRow[];
  teamMembers: Array<{ id: string; label: string }>;
};

const WIDTH_STORAGE_KEY = "tw.profiles.columnWidths";

const DEFAULT_WIDTHS: Record<string, number> = {
  full_name: 200,
  email: 220,
  phone: 150,
  location: 190,
  assignees: 260,
  updated_at: 130,
  actions: 90,
};

export function ProfilesList({
  canEdit,
  canAssign,
  rows,
  teamMembers,
}: Props) {
  const router = useRouter();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [widths, setWidth] = useColumnWidths(WIDTH_STORAGE_KEY, DEFAULT_WIDTHS);

  const data = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const create = async (values: ProfileFormValues) => {
    let row;
    try {
      // Throws when the derived document is invalid — a bad employment date,
      // say — which is worth surfacing before anything is written.
      row = toProfileRow(values);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Invalid profile");
      return;
    }

    setBusy(true);
    const created = await createProfile(row);

    if (!created.ok) {
      setBusy(false);
      message.error(created.error);
      return;
    }

    // Separate call: the plaintext has exactly one entry point into the system,
    // and it is never part of an ordinary row write.
    if (values.ssn?.trim()) {
      const result = await setSsn(created.data.id, values.ssn);
      if (!result.ok) message.warning(`Profile saved, but: ${result.error}`);
    }

    setBusy(false);
    message.success("Profile created.");
    setOpen(false);
    router.refresh();
  };

  const remove = async (id: string) => {
    const result = await deleteProfile(id);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    message.success("Deleted.");
    router.refresh();
  };

  /**
   * Assignment is a set: the Select hands back the whole desired membership, so
   * this diffs against what's stored rather than tracking individual add and
   * remove events.
   */
  const setAssignees = async (profileId: string, next: string[]) => {
    const result = await replaceProfileAssignees(profileId, next);
    if (!result.ok) {
      message.error(result.error);
      return;
    }

    router.refresh();
  };

  const baseColumns: ColumnsType<ProfileRow> = [
    {
      key: "full_name",
      title: "Name",
      dataIndex: "full_name",
      ellipsis: true,
      sorter: (a, b) => a.full_name.localeCompare(b.full_name),
      defaultSortOrder: "ascend",
      render: (value: string, row) => (
        <Space size={6}>
          <Link href={`/dashboard/profiles/${row.id}`}>{value}</Link>
          {row.has_ssn && <Tag color="orange">SSN</Tag>}
        </Space>
      ),
    },
    {
      key: "email",
      title: "Email",
      dataIndex: "email",
      ellipsis: true,
      render: (value: string | null) => value || <Muted />,
    },
    {
      key: "phone",
      title: "Phone",
      dataIndex: "phone",
      ellipsis: true,
      render: (value: string | null) => value || <Muted />,
    },
    {
      key: "location",
      title: "Location",
      ellipsis: true,
      render: (_, row) => {
        const parts = [row.city, row.state, row.country].filter(Boolean);
        return parts.length ? parts.join(", ") : <Muted />;
      },
    },
    ...(canAssign
      ? ([
          {
            key: "assignees",
            title: "Assigned to",
            render: (_, row) => (
              <Select
                mode="multiple"
                allowClear
                size="small"
                variant="borderless"
                placeholder="Nobody"
                style={{ width: "100%" }}
                value={row.assignee_ids}
                onChange={(next) => setAssignees(row.id, next)}
                options={teamMembers.map((m) => ({
                  value: m.id,
                  label: m.label,
                }))}
              />
            ),
          },
        ] satisfies ColumnsType<ProfileRow>)
      : []),
    {
      key: "updated_at",
      title: "Updated",
      dataIndex: "updated_at",
      sorter: (a, b) => a.updated_at.localeCompare(b.updated_at),
      render: (value: string) => formatDate(value),
    },
    {
      key: "actions",
      title: "",
      fixed: "right",
      render: (_, row) => (
        <Space size={0}>
          <Link href={`/dashboard/profiles/${row.id}`}>
            <Button type="link" size="small">
              Open
            </Button>
          </Link>
          {canEdit && (
            <Popconfirm
              title="Delete this profile?"
              description="Its resume documents and attachments go too."
              onConfirm={() => remove(row.id)}
              okButtonProps={{ danger: true }}
            >
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const columns = baseColumns.map((col) => {
    const key = String(col.key);
    return {
      ...col,
      width: widths[key] ?? DEFAULT_WIDTHS[key],
      onHeaderCell: () => ({
        width: widths[key] ?? DEFAULT_WIDTHS[key],
        onResize: (_e: unknown, { size }: { size: { width: number } }) =>
          setWidth(key, size.width),
      }),
    };
  }) as ColumnsType<ProfileRow>;

  return (
    <>
      <Space
        style={{
          marginBottom: 16,
          width: "100%",
          justifyContent: "space-between",
        }}
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Profiles
          </Typography.Title>
          <Typography.Text type="secondary">
            The stable half of a resume — identity, employers, dates. Nothing
            here is rewritten when you tailor for a job.
          </Typography.Text>
        </div>
        <Space>
          <Input.Search
            allowClear
            placeholder="Filter by name or email"
            style={{ width: 240 }}
            onChange={(e) => setQuery(e.target.value)}
          />
          {canEdit && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setOpen(true)}
            >
              New profile
            </Button>
          )}
        </Space>
      </Space>

      <Card styles={{ body: { padding: 0 } }}>
        <Table<ProfileRow>
          rowKey="id"
          size="small"
          dataSource={data}
          columns={columns}
          components={{ header: { cell: ResizableTitle } }}
          pagination={{ pageSize: 25, hideOnSinglePage: true }}
          scroll={{ x: "max-content" }}
          locale={{
            emptyText: canEdit
              ? "No profiles yet. Create one to start building resumes."
              : "No profiles have been assigned to you yet.",
          }}
        />
      </Card>

      <ProfileEditor
        open={open}
        busy={busy}
        canSeeSsn={canEdit}
        onCancel={() => setOpen(false)}
        onSubmit={create}
      />
    </>
  );
}

const Muted = () => <Typography.Text type="secondary">—</Typography.Text>;
