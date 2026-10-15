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
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  deleteProfile,
  handProfileToTeam,
  replaceProfileAssignees,
  setSelfAssignment,
} from "@/app/dashboard/profiles/actions";
import { MARQUEE_CSS, Marquee } from "@/components/grid/marquee";
import {
  EXACT_WIDTH_CLASS,
  EXACT_WIDTH_CSS,
  ResizableTitle,
} from "@/components/grid/resizable-title";
import { useColumnWidths } from "@/lib/column-widths";
import { usePersistentState } from "@/lib/persistent-state";
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
  /** The bidders working it. */
  assignee_ids: string[];
  /** Whether the super admin has taken it on themselves. */
  super_admin_works: boolean;
  team_id: string;
  /** The subadmin who owns this profile, or null if no subadmin owns its team. */
  team_label: string | null;
};

type Props = {
  /** May create profiles — the team's subadmin. */
  canCreate: boolean;
  /** May delete them — the subadmin, or the super admin in any team. */
  canEdit: boolean;
  canAssign: boolean;
  /**
   * Show who works each profile without being able to change it — the super
   * admin's view, who reviews assignments but leaves them to the subadmin.
   */
  showAssignees?: boolean;
  rows: ProfileRow[];
  teamMembers: Array<{ id: string; label: string }>;
  /** Super admin only: may move a profile to another subadmin's team. */
  canHandOver?: boolean;
  /** The teams it can be handed to. Empty unless canHandOver. */
  subadmins?: Array<{ id: string; label: string }>;
  /** Super admin only: may assign profiles to themselves and work them. */
  canSelfAssign?: boolean;
};

const WIDTH_STORAGE_KEY = "tw.profiles.columnWidths";
const PAGE_SIZE_STORAGE_KEY = "tw.profiles.pageSize";

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200];

const DEFAULT_WIDTHS: Record<string, number> = {
  full_name: 200,
  email: 220,
  phone: 150,
  location: 190,
  team: 200,
  mine: 150,
  assignees: 260,
  updated_at: 130,
  actions: 90,
};

export function ProfilesList({
  canCreate,
  canEdit,
  canAssign,
  showAssignees = false,
  rows,
  teamMembers,
  canHandOver = false,
  subadmins = [],
  canSelfAssign = false,
}: Props) {
  const router = useRouter();
  const { message, modal } = App.useApp();
  const [query, setQuery] = useState("");
  const [widths, setWidth] = useColumnWidths(WIDTH_STORAGE_KEY, DEFAULT_WIDTHS);
  const [pageSize, setPageSize] = usePersistentState<number>(
    PAGE_SIZE_STORAGE_KEY,
    DEFAULT_PAGE_SIZE,
  );
  const [page, setPage] = useState(1);
  /** The profile whose self-assignment is being saved, so its switch spins. */
  const [assigning, setAssigning] = useState<string | null>(null);

  const data = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

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
  /**
   * Hands a profile to another subadmin.
   *
   * Confirmed rather than applied on change, because this is not an edit —
   * it moves the candidate, their applications and their resumes out of one
   * team and into another, and drops the old team's bidder assignments. The
   * dialog says so in those words rather than "Are you sure?".
   */
  const handOver = (row: ProfileRow, teamId: string) => {
    if (teamId === row.team_id) return;
    const to = subadmins.find((sa) => sa.id === teamId)?.label ?? "that team";

    modal.confirm({
      title: `Hand ${row.full_name} to ${to}?`,
      content: (
        <>
          Their applications and resumes move too — otherwise the duplicate
          cooldown would stop knowing where this candidate has already been
          sent. Assignments to the current team&apos;s bidders are dropped;{" "}
          {to} re-assigns to their own.
        </>
      ),
      okText: "Hand over",
      onOk: async () => {
        const result = await handProfileToTeam(row.id, teamId);
        if (!result.ok) {
          message.error(result.error);
          return;
        }
        message.success(`${row.full_name} is now ${to}'s.`);
        router.refresh();
      },
    });
  };

  const setMine = async (row: ProfileRow, next: boolean) => {
    setAssigning(row.id);
    const result = await setSelfAssignment(row.id, next);
    setAssigning(null);
    if (!result.ok) {
      message.error(result.error);
      return;
    }
    message.success(
      next
        ? `${row.full_name} is assigned to you — it's in your resume builder now.`
        : `${row.full_name} is no longer assigned to you.`,
    );
    router.refresh();
  };

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
      ellipsis: { showTitle: false },
      sorter: (a, b) => a.full_name.localeCompare(b.full_name),
      defaultSortOrder: "ascend",
      render: (value: string, row) => (
        // The tag must keep its size; the name is what gives.
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ flex: "1 1 auto", minWidth: 0 }}>
            <Marquee title={value}>
              <Link href={`/dashboard/profiles/${row.id}`}>{value}</Link>
            </Marquee>
          </span>
          {row.has_ssn && <Tag color="orange">SSN</Tag>}
        </span>
      ),
    },
    {
      key: "email",
      title: "Email",
      dataIndex: "email",
      ellipsis: { showTitle: false },
      render: (value: string | null) =>
        value ? <Marquee title={value}>{value}</Marquee> : <Muted />,
    },
    {
      key: "phone",
      title: "Phone",
      dataIndex: "phone",
      ellipsis: { showTitle: false },
      render: (value: string | null) =>
        value ? <Marquee title={value}>{value}</Marquee> : <Muted />,
    },
    {
      key: "location",
      title: "Location",
      ellipsis: { showTitle: false },
      render: (_, row) => {
        const parts = [row.city, row.state, row.country].filter(Boolean);
        const text = parts.join(", ");
        return text ? <Marquee title={text}>{text}</Marquee> : <Muted />;
      },
    },
    // The super admin's control comes first: which subadmin runs this
    // candidate. It sits where a subadmin sees "Assigned to", because for the
    // super admin that *is* the assignment — bidders are the subadmin's call.
    ...(canHandOver
      ? ([
          {
            key: "team",
            title: "Subadmin",
            render: (_: unknown, row: ProfileRow) => (
              <Select
                size="small"
                variant="borderless"
                style={{ width: "100%" }}
                value={row.team_label ? row.team_id : undefined}
                // A profile in no subadmin's team — still in the super
                // admin's own pool — shows as a prompt to place it, not as a
                // blank or a raw id.
                placeholder="Choose a subadmin…"
                options={subadmins.map((sa) => ({ value: sa.id, label: sa.label }))}
                onChange={(teamId) => handOver(row, teamId)}
              />
            ),
          },
        ] satisfies ColumnsType<ProfileRow>)
      : []),
    // The super admin working a profile themselves, like a bidder: what they
    // generate and track is filed in the profile's team.
    ...(canSelfAssign
      ? ([
          {
            key: "mine",
            title: "Assigned to me",
            sorter: (a: ProfileRow, b: ProfileRow) =>
              Number(b.super_admin_works) - Number(a.super_admin_works),
            render: (_: unknown, row: ProfileRow) => (
              <Switch
                size="small"
                checked={row.super_admin_works}
                loading={assigning === row.id}
                onChange={(next) => setMine(row, next)}
              />
            ),
          },
        ] satisfies ColumnsType<ProfileRow>)
      : []),
    ...(canAssign || showAssignees
      ? ([
          {
            key: "assignees",
            title: canAssign ? "Assigned to" : "Bidders",
            render: (_, row) =>
              canAssign ? (
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Select
                    mode="multiple"
                    allowClear
                    size="small"
                    variant="borderless"
                    placeholder="Nobody"
                    style={{ flex: "1 1 auto", minWidth: 0 }}
                    value={row.assignee_ids}
                    onChange={(next) => setAssignees(row.id, next)}
                    options={teamMembers.map((m) => ({
                      value: m.id,
                      label: m.label,
                    }))}
                  />
                  {/* Not in the Select: the super admin's assignment is
                      theirs to give up, not the subadmin's to remove. */}
                  {row.super_admin_works && <Tag color="purple">Super admin</Tag>}
                </span>
              ) : (
                // Read-only for the super admin: names, not a greyed-out
                // control that looks broken.
                <Typography.Text type="secondary">
                  {row.assignee_ids
                    .map((id) => teamMembers.find((m) => m.id === id)?.label)
                    .filter(Boolean)
                    .join(", ") || "—"}
                </Typography.Text>
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

  const totalWidth = columns.reduce(
    (sum, col) => sum + (Number(col.width) || 0),
    0,
  );

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
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          {canCreate && (
            <Link href="/dashboard/profiles/new">
              <Button type="primary" icon={<PlusOutlined />}>
                New profile
              </Button>
            </Link>
          )}
        </Space>
      </Space>

      <Card styles={{ body: { padding: 0 } }}>
        <Table<ProfileRow>
          rowKey="id"
          size="small"
          className={EXACT_WIDTH_CLASS}
          dataSource={data}
          columns={columns}
          components={{ header: { cell: ResizableTitle } }}
          // No `total` and no clamp: antd counts what it paginates and clamps
          // an out-of-range page itself. See applications-grid.tsx for the bug
          // that passing our own count caused there.
          pagination={{
            current: page,
            pageSize,
            position: ["topRight", "bottomRight"],
            showSizeChanger: true,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            showQuickJumper: true,
            onShowSizeChange: (_current, size) => {
              setPageSize(size);
              setPage(1);
            },
            showTotal: (total, [from, to]) => `${from}–${to} of ${total}`,
          }}
          onChange={(pagination) => setPage(pagination.current ?? 1)}
          // Numeric, not "max-content": see the note in applications-grid.tsx.
          // With "max-content" rc-table falls back to `table-layout: auto` and
          // a column cannot be dragged narrower than its longest cell.
          tableLayout="fixed"
          scroll={{ x: totalWidth }}
          locale={{
            emptyText: canCreate
              ? "No profiles yet. Create one to start building resumes."
              : canEdit
                ? "No profiles yet."
                : "No profiles have been assigned to you yet.",
          }}
        />
      </Card>

      <style>{`${MARQUEE_CSS}${EXACT_WIDTH_CSS}`}</style>

    </>
  );
}

const Muted = () => <Typography.Text type="secondary">—</Typography.Text>;
