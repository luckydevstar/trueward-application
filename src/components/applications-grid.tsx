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

/** A row being added. The sentinel id is never sent to the database. */
const DRAFT_ID = "__draft__";

type Draft = Omit<Row, "id">;

type Props = {
  teamId: string;
  userId: string;
  rows: Row[];
  blockedNames: string[];
};

const WIDTH_STORAGE_KEY = "tw.applications.columnWidths";

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [widths, setWidth] = useColumnWidths(WIDTH_STORAGE_KEY, DEFAULT_WIDTHS);

  const blocked = useMemo(() => new Set(blockedNames), [blockedNames]);

  const isDraft = editingId === DRAFT_ID;

  const data = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rows.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            r.company.toLowerCase().includes(q),
        )
      : rows;
    // The draft always sits on top, where a spreadsheet's new row goes.
    return isDraft && buffer
      ? [{ ...buffer, id: DRAFT_ID } as Row, ...filtered]
      : filtered;
  }, [rows, query, isDraft, buffer]);

  const startAdd = () => {
    setBuffer(emptyDraft());
    setEditingId(DRAFT_ID);
  };

  // Fields listed explicitly rather than spread-minus-id, so adding a column to
  // Row that shouldn't be editable doesn't silently become editable.
  const startEdit = (row: Row) => {
    setBuffer({
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

  const cancel = () => {
    setEditingId(null);
    setBuffer(null);
  };

  const patch = (values: Partial<Draft>) =>
    setBuffer((b) => (b ? { ...b, ...values } : b));

  const commit = async () => {
    if (!buffer) return;

    if (!buffer.title.trim() || !buffer.company.trim() || !buffer.job_url.trim()) {
      message.error("Role, company and job URL are required.");
      return;
    }
    if (blocked.has(normalizeCompany(buffer.company))) {
      message.error(`${buffer.company} is on the blocklist.`);
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const payload = {
      title: buffer.title.trim(),
      company: buffer.company.trim(),
      job_url: buffer.job_url.trim(),
      status: buffer.status,
      billing: buffer.billing,
      notes: buffer.notes?.trim() || null,
      applied_at: buffer.applied_at,
      resume_key: buffer.resume_key,
      resume_url: buffer.resume_url,
      resume_name: buffer.resume_name,
    };

    const { error } = isDraft
      ? await supabase.from("application").insert({
          ...payload,
          resume_document_id: null,
          profile_id: null,
          // RLS asserts both of these in its WITH CHECK clause.
          team_id: teamId,
          created_by: userId,
        })
      : await supabase.from("application").update(payload).eq("id", editingId!);

    setSaving(false);

    if (error) {
      message.error(error.message);
      return;
    }
    cancel();
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

  /** Status and billing stay one-click even outside edit mode. */
  const quickPatch = async (id: string, values: Partial<Row>) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("application")
      .update(values)
      .eq("id", id);
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
            value={buffer?.title}
            placeholder="Senior Frontend Engineer"
            onChange={(e) => patch({ title: e.target.value })}
            onPressEnter={commit}
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
            value={buffer?.company}
            placeholder="Acme Inc."
            status={
              buffer?.company && blocked.has(normalizeCompany(buffer.company))
                ? "error"
                : undefined
            }
            onChange={(e) => patch({ company: e.target.value })}
            onPressEnter={commit}
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
            value={buffer?.job_url}
            placeholder="https://…"
            onChange={(e) => patch({ job_url: e.target.value })}
            onPressEnter={commit}
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
        <Select
          value={editingId === row.id ? buffer?.status : value}
          variant="borderless"
          style={{ width: "100%" }}
          onChange={(next) =>
            editingId === row.id
              ? patch({ status: next })
              : quickPatch(row.id, { status: next })
          }
          options={APPLICATION_STATUSES.map((s) => ({
            value: s,
            label: <Tag color={STATUS_META[s].color}>{STATUS_META[s].label}</Tag>,
          }))}
        />
      ),
    },
    {
      key: "billing",
      title: "Billing",
      dataIndex: "billing",
      render: (value: BillingStatus, row) => (
        <Select
          value={editingId === row.id ? buffer?.billing : value}
          variant="borderless"
          style={{ width: "100%" }}
          onChange={(next) =>
            editingId === row.id
              ? patch({ billing: next })
              : quickPatch(row.id, { billing: next })
          }
          options={BILLING_STATUSES.map((b) => ({
            value: b,
            label: <Tag color={BILLING_META[b].color}>{BILLING_META[b].label}</Tag>,
          }))}
        />
      ),
    },
    {
      key: "resume",
      title: "Resume",
      dataIndex: "resume_name",
      render: (_value, row) => (
        <ResumeCell
          row={row}
          editing={editingId === row.id}
          draft={buffer}
          onDraftChange={patch}
          onAttached={(file) => quickPatch(row.id, file)}
        />
      ),
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
            value={buffer ? dayjs(buffer.applied_at) : null}
            allowClear={false}
            style={{ width: "100%" }}
            onChange={(d) => d && patch({ applied_at: d.toISOString() })}
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
            value={buffer?.notes ?? ""}
            onChange={(e) => patch({ notes: e.target.value })}
            onPressEnter={commit}
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
              onClick={commit}
            />
            <Button type="text" icon={<CloseOutlined />} onClick={cancel} />
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
            Drag any column edge to resize. Click a row to edit it in place.
          </Typography.Text>
        </div>
        <Space>
          <Input.Search
            allowClear
            placeholder="Filter by role or company"
            style={{ width: 240 }}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={editingId !== null}
            onClick={startAdd}
          >
            Add row
          </Button>
        </Space>
      </Space>

      <Card styles={{ body: { padding: 0 } }}>
        <Table<Row>
          rowKey="id"
          size="small"
          dataSource={data}
          components={{ header: { cell: ResizableTitle } }}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          scroll={{ x: "max-content" }}
          // Only fires for saved rows — clicking inside the draft's own inputs
          // must not restart the edit and wipe what's been typed.
          onRow={(row) => ({
            onDoubleClick: () => {
              if (editingId === null && row.id !== DRAFT_ID) startEdit(row);
            },
          })}
          rowClassName={(row) => (row.id === DRAFT_ID ? "tw-draft-row" : "")}
          columns={columns}
        />
      </Card>

      <style>{`
        .tw-draft-row > td { background: #f0f5ff !important; }
        .react-resizable-handle { touch-action: none; }
      `}</style>
    </>
  );
}

/**
 * The resume cell.
 *
 * On a saved row an upload patches the row immediately. On the draft it only
 * updates the buffer, so the file lands with the insert rather than needing a
 * row that doesn't exist yet.
 */
function ResumeCell({
  row,
  editing,
  draft,
  onDraftChange,
  onAttached,
}: {
  row: Row;
  editing: boolean;
  draft: Draft | null;
  onDraftChange: (values: Partial<Draft>) => void;
  onAttached: (file: Pick<Row, "resume_key" | "resume_url" | "resume_name">) => void;
}) {
  const { message } = App.useApp();
  const input = useRef<HTMLInputElement>(null);
  const isDraft = row.id === DRAFT_ID;

  const { startUpload, isUploading } = useUploadThing("applicationResume", {
    onClientUploadComplete: (res) => {
      const file = res?.[0]?.serverData;
      if (!file) return;
      const values = {
        resume_key: file.key,
        resume_url: file.url,
        resume_name: file.name,
      };
      if (isDraft || editing) onDraftChange(values);
      else onAttached(values);
      message.success("Resume attached.");
    },
    onUploadError: (error) => {
      message.error(error.message);
    },
  });

  const name = editing || isDraft ? draft?.resume_name : row.resume_name;
  const url = editing || isDraft ? draft?.resume_url : row.resume_url;

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
