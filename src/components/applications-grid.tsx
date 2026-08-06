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
import { useUploadThing } from "@/lib/uploadthing";

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
};

type Draft = Omit<Row, "id">;

type Props = {
  teamId: string;
  userId: string;
  rows: Row[];
  blockedNames: string[];
};

const WIDTH_STORAGE_KEY = "tw.applications.columnWidths";

/** Column order. The entry row below renders one cell per key, in this order. */
const COLUMN_KEYS = [
  "title",
  "company",
  "job_url",
  "status",
  "billing",
  "resume",
  "applied_at",
  "notes",
  "actions",
] as const;

const DEFAULT_WIDTHS: Record<string, number> = {
  title: 220,
  company: 170,
  job_url: 190,
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
  };
}

export function ApplicationsGrid({ teamId, userId, rows, blockedNames }: Props) {
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

  /** Shared validation — the same rules whether adding or editing. */
  const invalidReason = (value: Draft): string | null => {
    if (!value.title.trim() || !value.company.trim() || !value.job_url.trim()) {
      return "Role, company and job URL are required.";
    }
    if (blocked.has(normalizeCompany(value.company))) {
      return `${value.company} is on the blocklist.`;
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
      profile_id: null,
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
    const reason = invalidReason(editBuffer);
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
      render: (_, row) =>
        editingId === row.id ? (
          <Space size={0}>
            <Button
              type="text"
              icon={<CheckOutlined />}
              loading={saving}
              onClick={saveEdit}
            />
            <Button type="text" icon={<CloseOutlined />} onClick={cancelEdit} />
          </Space>
        ) : (
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
        ),
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
              if (editingId === null) startEdit(row);
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

function StatusSelect({
  value,
  onChange,
}: {
  value: ApplicationStatus;
  onChange: (value: ApplicationStatus) => void;
}) {
  return (
    <Select
      value={value}
      variant="borderless"
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
  onChange,
}: {
  value: BillingStatus;
  onChange: (value: BillingStatus) => void;
}) {
  return (
    <Select
      value={value}
      variant="borderless"
      style={{ width: "100%" }}
      onChange={onChange}
      options={BILLING_STATUSES.map((b) => ({
        value: b,
        label: <Tag color={BILLING_META[b].color}>{BILLING_META[b].label}</Tag>,
      }))}
    />
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
  onAttached,
}: {
  name: string | null;
  url: string | null;
  onAttached: (file: {
    resume_key: string;
    resume_url: string;
    resume_name: string;
  }) => void;
}) {
  const { message } = App.useApp();
  const input = useRef<HTMLInputElement>(null);

  const { startUpload, isUploading } = useUploadThing("applicationResume", {
    onClientUploadComplete: (res) => {
      const file = res?.[0]?.serverData;
      if (!file) return;
      onAttached({
        resume_key: file.key,
        resume_url: file.url,
        resume_name: file.name,
      });
      message.success("Resume attached.");
    },
    onUploadError: (error) => {
      message.error(error.message);
    },
  });

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
      <Tooltip title={name ? "Replace" : "Attach a resume"}>
        <Button
          type="text"
          size="small"
          icon={<UploadOutlined />}
          loading={isUploading}
          onClick={() => input.current?.click()}
        />
      </Tooltip>
      <input
        ref={input}
        type="file"
        accept=".pdf,.doc,.docx"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void startUpload([file]);
          // Reset so re-picking the same file fires change again.
          event.target.value = "";
        }}
      />
    </Space>
  );
}
