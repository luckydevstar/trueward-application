"use client";

import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  PaperClipOutlined,
  PlusOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  DatePicker,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { ResizableTitle } from "@/components/grid/resizable-title";
import { useColumnWidths } from "@/lib/column-widths";
import { createClient } from "@/lib/supabase/client";
import { useUploadThing } from "@/lib/uploadthing";
import {
  APPLICATION_STATUSES,
  BILLING_META,
  BILLING_STATUSES,
  STATUS_META,
  formatDate,
  hostOf,
  normalizeCompany,
  type ApplicationStatus,
  type BillingStatus,
} from "@/lib/status";

export type Row = {
  id: string;
  title: string;
  company: string;
  job_url: string;
  status: ApplicationStatus;
  billing: BillingStatus;
  notes: string | null;
  applied_at: string;
  resume_key: string | null;
  resume_url: string | null;
  resume_name: string | null;
  profile_id: string | null;
  created_by: string | null;
};

/** The draft owns no author — that is stamped from the session on insert. */
type Draft = Omit<Row, "id" | "created_by">;

type Option = { id: string; label: string };

type Props = {
  teamId: string;
  userId: string;
  isAdmin: boolean;
  rows: Row[];
  profiles: Option[];
  appliers: Option[];
  blockedNames: string[];
};

const WIDTH_STORAGE_KEY = "tw.applications.columnWidths";

/**
 * Must match application_cooldown_days() in
 * supabase/migrations/0003_application_scope_and_cooldown.sql. The trigger is
 * the enforcement; this is only so the grid can warn before a rejected write.
 */
const COOLDOWN_DAYS = 14;

/** Column order. The entry row below renders one cell per key, in this order. */
const COLUMN_KEYS = [
  "title",
  "company",
  "profile",
  "applier",
  "job_url",
  "status",
  "billing",
  "resume",
  "applied_at",
  "notes",
  "actions",
] as const;

const DEFAULT_WIDTHS: Record<string, number> = {
  title: 200,
  company: 160,
  profile: 160,
  applier: 140,
  job_url: 150,
  status: 150,
  billing: 140,
  resume: 170,
  applied_at: 140,
  notes: 220,
  actions: 96,
};

function emptyDraft(): Draft {
  return {
    title: "",
    company: "",
    job_url: "",
    status: "applied",
    billing: "unbilled",
    notes: "",
    applied_at: new Date().toISOString(),
    resume_key: null,
    resume_url: null,
    resume_name: null,
    profile_id: null,
  };
}

export function ApplicationsGrid({
  teamId,
  userId,
  isAdmin,
  rows,
  profiles,
  appliers,
  blockedNames,
}: Props) {
  const router = useRouter();
  const { message } = App.useApp();

  const [query, setQuery] = useState("");
  const [widths, setWidth] = useColumnWidths(WIDTH_STORAGE_KEY, DEFAULT_WIDTHS);

  /**
   * The entry row is always present — it is not something you open.
   *
   * It lives in Table.Summary with `fixed="top"` rather than in dataSource,
   * which matters for more than placement: a row inside dataSource would be
   * sorted, filtered and paginated along with real records, so it would slide
   * down the list the moment anyone sorted by company, and vanish outright on
   * page two.
   */
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [adding, setAdding] = useState(false);

  // Editing an existing row is a separate mode with its own buffer, so typing
  // into the entry row can never overwrite the record you're editing.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const blocked = useMemo(() => new Set(blockedNames), [blockedNames]);

  const data = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.title.toLowerCase().includes(q) || r.company.toLowerCase().includes(q),
    );
  }, [rows, query]);

  // Fields listed explicitly rather than spread-minus-id, so a column added to
  // Row that shouldn't be editable doesn't silently become editable.
  const startEdit = (row: Row) => {
    setEditBuffer({
      title: row.title,
      company: row.company,
      job_url: row.job_url,
      status: row.status,
      billing: row.billing,
      notes: row.notes,
      applied_at: row.applied_at,
      resume_key: row.resume_key,
      resume_url: row.resume_url,
      resume_name: row.resume_name,
      profile_id: row.profile_id,
    });
    setEditingId(row.id);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditBuffer(null);
  };

  const patchEdit = (values: Partial<Draft>) =>
    setEditBuffer((b) => (b ? { ...b, ...values } : b));

  const patchDraft = (values: Partial<Draft>) =>
    setDraft((d) => ({ ...d, ...values }));

  const profileName = useMemo(
    () => new Map(profiles.map((p) => [p.id, p.label])),
    [profiles],
  );
  const applierName = useMemo(
    () => new Map(appliers.map((a) => [a.id, a.label])),
    [appliers],
  );

  /** You may change your own rows; admins may change any in their team. */
  const canAct = (row: Row) => isAdmin || row.created_by === userId;

  /**
   * The most recent application for a (profile, company) still inside the
   * cooldown, or null.
   *
   * A courtesy check only — the database trigger is the rule, and it can see
   * teammates' rows this list may not include. Catching it here turns a
   * rejected save into a warning while you are still typing.
   */
  const cooldownClash = (value: Draft, ignoreId?: string) => {
    if (!value.profile_id || !value.company.trim()) return null;

    const key = normalizeCompany(value.company);
    const when = new Date(value.applied_at).getTime();
    const window = COOLDOWN_DAYS * 86_400_000;

    // Distance between the two applications, matching the trigger. Also what
    // keeps this pure: no clock reading during render.
    return (
      rows.find(
        (r) =>
          r.id !== ignoreId &&
          r.profile_id === value.profile_id &&
          normalizeCompany(r.company) === key &&
          Math.abs(new Date(r.applied_at).getTime() - when) < window,
      ) ?? null
    );
  };

  const draftClash = cooldownClash(draft);

  /** Shared validation — the same rules whether adding or editing. */
  const invalidReason = (value: Draft, ignoreId?: string): string | null => {
    if (!value.title.trim() || !value.company.trim() || !value.job_url.trim()) {
      return "Role, company and job URL are required.";
    }
    if (!value.profile_id) {
      return "Choose which profile this application is for.";
    }
    if (blocked.has(normalizeCompany(value.company))) {
      return `${value.company} is on the blocklist.`;
    }

    const clash = cooldownClash(value, ignoreId);
    if (clash) {
      const reopens = new Date(
        new Date(clash.applied_at).getTime() + COOLDOWN_DAYS * 86_400_000,
      );
      return `${clash.company} was already applied to for this profile on ${formatDate(
        clash.applied_at,
      )}. It reopens on ${formatDate(reopens)}.`;
    }
    return null;
  };

  const payloadOf = (value: Draft) => ({
    title: value.title.trim(),
    company: value.company.trim(),
    job_url: value.job_url.trim(),
    status: value.status,
    billing: value.billing,
    notes: value.notes?.trim() || null,
    applied_at: value.applied_at,
    resume_key: value.resume_key,
    resume_url: value.resume_url,
    resume_name: value.resume_name,
    profile_id: value.profile_id,
  });

  const addDraft = async () => {
    const reason = invalidReason(draft);
    if (reason) {
      message.error(reason);
      return;
    }

    setAdding(true);
    const supabase = createClient();
    const { error } = await supabase.from("application").insert({
      ...payloadOf(draft),
      resume_document_id: null,
      // RLS asserts both of these in its WITH CHECK clause.
      team_id: teamId,
      created_by: userId,
    });
    setAdding(false);

    if (error) {
      message.error(error.message);
      return;
    }
    // Cleared rather than left filled: the row's whole point is being ready for
    // the next entry.
    setDraft(emptyDraft());
    router.refresh();
  };

  const saveEdit = async () => {
    if (!editBuffer || !editingId) return;
    const reason = invalidReason(editBuffer, editingId);
    if (reason) {
      message.error(reason);
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("application")
      .update(payloadOf(editBuffer))
      .eq("id", editingId);
    setSaving(false);

    if (error) {
      message.error(error.message);
      return;
    }
    cancelEdit();
    router.refresh();
  };

  const remove = async (id: string) => {
    const supabase = createClient();
    const { error } = await supabase.from("application").delete().eq("id", id);
    if (error) {
      message.error(error.message);
      return;
    }
    message.success("Deleted.");
    router.refresh();
  };

  /** Status and billing stay one-click editable outside edit mode. */
  const quickPatch = async (id: string, values: Partial<Row>) => {
    const supabase = createClient();
    const { error } = await supabase.from("application").update(values).eq("id", id);
    if (error) {
      message.error(error.message);
      return;
    }
    router.refresh();
  };

  const baseColumns: ColumnsType<Row> = [
    {
      key: "title",
      title: "Role",
      dataIndex: "title",
      ellipsis: true,
      sorter: (a, b) => a.title.localeCompare(b.title),
      render: (value: string, row) =>
        editingId === row.id ? (
          <Input
            autoFocus
            value={editBuffer?.title}
            onChange={(e) => patchEdit({ title: e.target.value })}
            onPressEnter={saveEdit}
          />
        ) : (
          <span>{value}</span>
        ),
    },
    {
      key: "company",
      title: "Company",
      dataIndex: "company",
      ellipsis: true,
      sorter: (a, b) => a.company.localeCompare(b.company),
      render: (value: string, row) =>
        editingId === row.id ? (
          <Input
            value={editBuffer?.company}
            onChange={(e) => patchEdit({ company: e.target.value })}
            onPressEnter={saveEdit}
          />
        ) : (
          <span>{value}</span>
        ),
    },
    {
      key: "profile",
      title: "Profile",
      dataIndex: "profile_id",
      ellipsis: true,
      filters: profiles.map((p) => ({ text: p.label, value: p.id })),
      onFilter: (value, row) => row.profile_id === value,
      render: (value: string | null, row) =>
        editingId === row.id ? (
          <Select
            value={editBuffer?.profile_id ?? undefined}
            variant="borderless"
            placeholder="Choose"
            style={{ width: "100%" }}
            onChange={(next) => patchEdit({ profile_id: next })}
            options={profiles.map((p) => ({ value: p.id, label: p.label }))}
          />
        ) : value ? (
          profileName.get(value) ?? <Muted>unknown</Muted>
        ) : (
          <Muted>none</Muted>
        ),
    },
    {
      key: "applier",
      title: "Applier",
      dataIndex: "created_by",
      ellipsis: true,
      filters: appliers.map((a) => ({ text: a.label, value: a.id })),
      onFilter: (value, row) => row.created_by === value,
      // Never editable: authorship is stamped from the session, and letting it
      // be reassigned would make the audit trail decorative.
      render: (value: string | null) =>
        value ? (
          <Typography.Text>{applierName.get(value) ?? "—"}</Typography.Text>
        ) : (
          <Muted>—</Muted>
        ),
    },
    {
      key: "job_url",
      title: "Posting",
      dataIndex: "job_url",
      ellipsis: true,
      render: (value: string, row) =>
        editingId === row.id ? (
          <Input
            value={editBuffer?.job_url}
            onChange={(e) => patchEdit({ job_url: e.target.value })}
            onPressEnter={saveEdit}
          />
        ) : (
          <Typography.Link href={value} target="_blank" rel="noopener noreferrer">
            {hostOf(value)}
          </Typography.Link>
        ),
    },
    {
      key: "status",
      title: "Status",
      dataIndex: "status",
      filters: APPLICATION_STATUSES.map((s) => ({
        text: STATUS_META[s].label,
        value: s,
      })),
      onFilter: (value, row) => row.status === value,
      render: (value: ApplicationStatus, row) => (
        <StatusSelect
          value={editingId === row.id ? (editBuffer?.status ?? value) : value}
          // One-click status changes are a shortcut past edit mode, so they
          // need the same ownership check edit mode has.
          disabled={!canAct(row)}
          onChange={(next) =>
            editingId === row.id
              ? patchEdit({ status: next })
              : quickPatch(row.id, { status: next })
          }
        />
      ),
    },
    {
      key: "billing",
      title: "Billing",
      dataIndex: "billing",
      render: (value: BillingStatus, row) => (
        <BillingSelect
          value={editingId === row.id ? (editBuffer?.billing ?? value) : value}
          // Billing is a commercial call about someone else's output, so it is
          // an admin decision. A trigger enforces it; this only saves a bidder
          // from a control that would always be refused.
          disabled={!canAct(row) || !isAdmin}
          reason={
            isAdmin ? "Recorded by a teammate" : "Only an admin can set billing"
          }
          onChange={(next) =>
            editingId === row.id
              ? patchEdit({ billing: next })
              : quickPatch(row.id, { billing: next })
          }
        />
      ),
    },
    {
      key: "resume",
      title: "Resume",
      dataIndex: "resume_name",
      render: (_value, row) => {
        const editing = editingId === row.id;
        return (
          <ResumeCell
                        name={editing ? (editBuffer?.resume_name ?? null) : row.resume_name}
            url={editing ? (editBuffer?.resume_url ?? null) : row.resume_url}
            onAttached={(file) =>
              editing ? patchEdit(file) : quickPatch(row.id, file)
            }
          />
        );
      },
    },
    {
      key: "applied_at",
      title: "Applied",
      dataIndex: "applied_at",
      sorter: (a, b) => a.applied_at.localeCompare(b.applied_at),
      defaultSortOrder: "descend",
      render: (value: string, row) =>
        editingId === row.id ? (
          <DatePicker
            value={editBuffer ? dayjs(editBuffer.applied_at) : null}
            allowClear={false}
            style={{ width: "100%" }}
            onChange={(d) => d && patchEdit({ applied_at: d.toISOString() })}
          />
        ) : (
          formatDate(value)
        ),
    },
    {
      key: "notes",
      title: "Notes",
      dataIndex: "notes",
      ellipsis: true,
      render: (value: string | null, row) =>
        editingId === row.id ? (
          <Input
            value={editBuffer?.notes ?? ""}
            onChange={(e) => patchEdit({ notes: e.target.value })}
            onPressEnter={saveEdit}
          />
        ) : (
          <Tooltip title={value || undefined}>
            <span style={{ color: value ? undefined : "#94a3b8" }}>
              {value || "—"}
            </span>
          </Tooltip>
        ),
    },
    {
      key: "actions",
      title: "",
      fixed: "right",
      render: (_, row) => {
        if (editingId === row.id) {
          return (
            <Space size={0}>
              <Button
                type="text"
                icon={<CheckOutlined />}
                loading={saving}
                onClick={saveEdit}
              />
              <Button type="text" icon={<CloseOutlined />} onClick={cancelEdit} />
            </Space>
          );
        }
        // A teammate's row is visible because you share the candidate, which is
        // about not duplicating their work — not about editing it. RLS refuses
        // the write regardless; hiding the controls means you find that out
        // before clicking rather than after.
        if (!canAct(row)) {
          return (
            <Tooltip title="Recorded by a teammate — read only">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                view only
              </Typography.Text>
            </Tooltip>
          );
        }
        return (
          <Space size={0}>
            <Button
              type="text"
              icon={<EditOutlined />}
              disabled={editingId !== null}
              onClick={() => startEdit(row)}
            />
            <Popconfirm
              title="Delete this application?"
              onConfirm={() => remove(row.id)}
              okButtonProps={{ danger: true }}
            >
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  // Width lives outside the column definitions so a resize doesn't rebuild
  // every renderer, and so the persisted map stays the single source.
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
  }) as ColumnsType<Row>;

  /** One cell per column key, in COLUMN_KEYS order. */
  const entryCells: Record<(typeof COLUMN_KEYS)[number], React.ReactNode> = {
    title: (
      <Input
        variant="borderless"
        placeholder="Senior Frontend Engineer"
        value={draft.title}
        onChange={(e) => patchDraft({ title: e.target.value })}
        onPressEnter={addDraft}
      />
    ),
    company: (
      <Input
        variant="borderless"
        placeholder="Acme Inc."
        status={
          draft.company && blocked.has(normalizeCompany(draft.company))
            ? "error"
            : undefined
        }
        value={draft.company}
        onChange={(e) => patchDraft({ company: e.target.value })}
        onPressEnter={addDraft}
      />
    ),
    profile: (
      <Select
        variant="borderless"
        placeholder="Profile"
        style={{ width: "100%" }}
        value={draft.profile_id ?? undefined}
        onChange={(profile_id) => patchDraft({ profile_id })}
        options={profiles.map((p) => ({ value: p.id, label: p.label }))}
        status={draftClash ? "warning" : undefined}
      />
    ),
    // Authorship is stamped from the session on insert, so there is nothing to
    // choose here — showing who it will be is more honest than a blank cell.
    applier: (
      <Typography.Text type="secondary" style={{ paddingLeft: 8 }}>
        {applierName.get(userId) ?? "You"}
      </Typography.Text>
    ),
    job_url: (
      <Input
        variant="borderless"
        placeholder="https://…"
        value={draft.job_url}
        onChange={(e) => patchDraft({ job_url: e.target.value })}
        onPressEnter={addDraft}
      />
    ),
    status: (
      <StatusSelect
        value={draft.status}
        onChange={(status) => patchDraft({ status })}
      />
    ),
    billing: (
      <BillingSelect
        value={draft.billing}
        disabled={!isAdmin}
        reason="Only an admin can set billing" 
        onChange={(billing) => patchDraft({ billing })}
      />
    ),
    resume: (
      <ResumeCell
                name={draft.resume_name}
        url={draft.resume_url}
        // Held in the draft rather than written straight away: there is no row
        // yet for it to attach to, so it lands with the insert.
        onAttached={(file) => patchDraft(file)}
      />
    ),
    applied_at: (
      <DatePicker
        variant="borderless"
        value={dayjs(draft.applied_at)}
        allowClear={false}
        style={{ width: "100%" }}
        onChange={(d) => d && patchDraft({ applied_at: d.toISOString() })}
      />
    ),
    notes: (
      <Input
        variant="borderless"
        placeholder="Notes"
        value={draft.notes ?? ""}
        onChange={(e) => patchDraft({ notes: e.target.value })}
        onPressEnter={addDraft}
      />
    ),
    actions: (
      <Tooltip title="Add this row — or press Enter in any field">
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          loading={adding}
          onClick={addDraft}
        />
      </Tooltip>
    ),
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
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Applications
          </Typography.Title>
          <Typography.Text type="secondary">
            Type into the top row to add a record. Drag any column edge to
            resize; double-click a row to edit it.
          </Typography.Text>
        </div>
        <Input.Search
          allowClear
          placeholder="Filter by role or company"
          style={{ width: 260 }}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Space>

      <Card styles={{ body: { padding: 0 } }}>
        <Table<Row>
          rowKey="id"
          size="small"
          dataSource={data}
          components={{ header: { cell: ResizableTitle } }}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          scroll={{ x: "max-content" }}
          /**
           * Load-bearing, not decoration. rc-table only honours a summary's
           * `fixed` when `fixHeader || isSticky` — otherwise it renders the
           * summary after the body, and the entry row would sit at the *bottom*
           * of the table. Verified both ways against the rendered HTML.
           *
           * The side benefit is the one you'd want anyway: header and entry row
           * stay visible while scrolling a long list.
           */
          sticky
          onRow={(row) => ({
            onDoubleClick: () => {
              if (editingId === null && canAct(row)) startEdit(row);
            },
          })}
          columns={columns}
          // fixed="top" pins the entry row above the body and outside sorting,
          // filtering and pagination — it stays put whatever the table is doing.
          summary={() => (
            <Table.Summary fixed="top">
              <Table.Summary.Row className="tw-entry-row">
                {COLUMN_KEYS.map((key, index) => (
                  <Table.Summary.Cell key={key} index={index}>
                    {entryCells[key]}
                  </Table.Summary.Cell>
                ))}
              </Table.Summary.Row>
            </Table.Summary>
          )}
          locale={{
            emptyText: "No applications yet — the row above is ready for one.",
          }}
        />
      </Card>

      <style>{`
        .tw-entry-row > td {
          background: #f0f5ff;
          border-bottom: 2px solid #d6e4ff !important;
          padding: 2px 4px !important;
        }
        .react-resizable-handle { touch-action: none; }
      `}</style>
    </>
  );
}

const Muted = ({ children }: { children?: React.ReactNode }) => (
  <Typography.Text type="secondary">{children ?? "—"}</Typography.Text>
);

function StatusSelect({
  value,
  disabled,
  onChange,
}: {
  value: ApplicationStatus;
  disabled?: boolean;
  onChange: (value: ApplicationStatus) => void;
}) {
  return (
    <Select
      value={value}
      variant="borderless"
      disabled={disabled}
      style={{ width: "100%" }}
      onChange={onChange}
      options={APPLICATION_STATUSES.map((s) => ({
        value: s,
        label: <Tag color={STATUS_META[s].color}>{STATUS_META[s].label}</Tag>,
      }))}
    />
  );
}

function BillingSelect({
  value,
  disabled,
  reason,
  onChange,
}: {
  value: BillingStatus;
  disabled?: boolean;
  /** Why it's disabled. A greyed control with no explanation just reads broken. */
  reason?: string;
  onChange: (value: BillingStatus) => void;
}) {
  const select = (
    <Select
      value={value}
      variant="borderless"
      disabled={disabled}
      style={{ width: "100%" }}
      onChange={onChange}
      options={BILLING_STATUSES.map((b) => ({
        value: b,
        label: <Tag color={BILLING_META[b].color}>{BILLING_META[b].label}</Tag>,
      }))}
    />
  );

  // A disabled antd control swallows pointer events, so the tooltip needs a
  // wrapper of its own to hang off.
  return disabled && reason ? (
    <Tooltip title={reason}>
      <span style={{ display: "block", cursor: "not-allowed" }}>{select}</span>
    </Tooltip>
  ) : (
    select
  );
}

/**
 * The resume cell — a link to whatever is attached, plus an upload trigger.
 *
 * Deliberately knows nothing about rows or drafts: it reports the uploaded file
 * and lets the caller decide whether that means a database write or a change to
 * pending state.
 */
function ResumeCell({
  name,
  url,
  readOnly,
  onAttached,
}: {
  name: string | null;
  url: string | null;
  readOnly?: boolean;
  onAttached: (file: {
    resume_key: string;
    resume_url: string;
    resume_name: string;
  }) => void;
}) {
  const { message } = App.useApp();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { startUpload } = useUploadThing("applicationResume", {
    onUploadError: (error) => {
      message.error(error.message);
    },
  });

  /**
   * Upload, take the URL off the result, and hand it up.
   *
   * `startUpload` is awaited rather than handled through
   * `onClientUploadComplete`, so the resolved value is the only thing this
   * depends on. Combined with `awaitServerData: false` on the route, it
   * resolves once the bytes are stored — no waiting on UploadThing's callback
   * into this app, which is what previously left the control spinning after the
   * file had already arrived.
   *
   * `uploading` is local state cleared in a finally, so no outcome — error,
   * rejection, or a resolve with nothing in it — can strand the button.
   */
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const result = await startUpload([file]);
      const uploaded = result?.[0];

      if (!uploaded) {
        // startUpload resolves undefined when the route's middleware rejects,
        // which onUploadError has already reported.
        return;
      }

      onAttached({
        resume_key: uploaded.key,
        resume_url: uploaded.ufsUrl,
        resume_name: uploaded.name,
      });
      message.success("Resume attached.");
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "Could not upload the file.",
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <Space size={4}>
      {name ? (
        <Typography.Link
          href={url ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          ellipsis
          style={{ maxWidth: 110 }}
        >
          <PaperClipOutlined /> {name}
        </Typography.Link>
      ) : (
        <Typography.Text type="secondary">—</Typography.Text>
      )}
      {!readOnly && (
        <Tooltip title={name ? "Replace" : "Attach a resume"}>
          <Button
            type="text"
            size="small"
            icon={<UploadOutlined />}
            loading={uploading}
            onClick={() => input.current?.click()}
          />
        </Tooltip>
      )}
      <input
        ref={input}
        type="file"
        accept=".pdf,.doc,.docx"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset before awaiting, so re-picking the same file fires change
          // again even while this upload is still running.
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
    </Space>
  );
}
