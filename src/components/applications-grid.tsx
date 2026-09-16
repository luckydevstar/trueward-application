"use client";

import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  InboxOutlined,
  PaperClipOutlined,
  PlusOutlined,
  UndoOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Input,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useMemo, useRef, useState } from "react";

import { MARQUEE_CSS, Marquee } from "@/components/grid/marquee";
import { ROW_COLUMNS, type ApplicationRow } from "@/lib/application-row";
import {
  EXACT_WIDTH_CLASS,
  EXACT_WIDTH_CSS,
  ResizableTitle,
} from "@/components/grid/resizable-title";
import { useColumnWidths } from "@/lib/column-widths";
import { applyOverlay, resolveOverlay, type Overlay } from "@/lib/overlay";
import { usePersistentState } from "@/lib/persistent-state";
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

export type Row = ApplicationRow;

/** The draft owns no author or archive state — neither is yours to type. */
type Draft = Omit<Row, "id" | "created_by" | "archived_at">;

/** Which half of the tracker the grid is showing. */
type ViewMode = "active" | "archived";

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
const PAGE_SIZE_STORAGE_KEY = "tw.applications.pageSize";

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200];

/**
 * Must match application_cooldown_days() in
 * supabase/migrations/0003_application_scope_and_cooldown.sql. The trigger is
 * the enforcement; this is only so the grid can warn before a rejected write.
 */
const COOLDOWN_DAYS = 14;
const COOLDOWN_MS = COOLDOWN_DAYS * 86_400_000;

/** When a company reopens for the profile it was last applied to. */
const cooldownEnds = (appliedAt: string) =>
  new Date(new Date(appliedAt).getTime() + COOLDOWN_MS).toISOString();

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

/** Only ever shown in the archived view, so it is outside COLUMN_KEYS. */
const ARCHIVED_AT_KEY = "archived_at";

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
  actions: 120,
  [ARCHIVED_AT_KEY]: 140,
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
  const { message } = App.useApp();

  const [query, setQuery] = useState("");
  const [widths, setWidth] = useColumnWidths(WIDTH_STORAGE_KEY, DEFAULT_WIDTHS);

  // Two views over one list, not two lists: everything is already loaded, so
  // switching is a filter rather than a round trip.
  const [view, setView] = useState<ViewMode>("active");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Page size is a preference and outlives the visit; the page number is not,
  // and starting a session on page 4 of a list you haven't looked at yet would
  // just be confusing.
  const [pageSize, setPageSize] = usePersistentState<number>(
    PAGE_SIZE_STORAGE_KEY,
    DEFAULT_PAGE_SIZE,
  );
  const [page, setPage] = useState(1);

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

  /**
   * The rows as the grid shows them: the server's list with this session's
   * edits laid over it.
   *
   * Every write used to end in router.refresh(), which re-ran the page on the
   * server — actor lookup, four queries, an RSC render — and the grid showed
   * the old value until all of that came back. Changing a status *felt* slow
   * because a one-row update was paying for a whole page load.
   *
   * Now a write updates this copy at once and the database in the background,
   * and reads the written row back from the same statement where it needs
   * something the database decides (an id, a default). Nothing re-fetches the
   * page. If the write fails, the change is reverted and the error shown.
   *
   * The overlay is dropped automatically when the server sends new rows — see
   * src/lib/overlay.ts for how, and why it is not an effect.
   */
  const [overlay, setOverlay] = useState<Overlay<Row> | null>(null);
  const liveRows = resolveOverlay(overlay, rows);

  const mutate = (change: (current: readonly Row[]) => readonly Row[]) =>
    setOverlay((previous) => applyOverlay(previous, rows, change));

  const archivedCount = useMemo(
    () => liveRows.filter((r) => r.archived_at !== null).length,
    [liveRows],
  );

  const data = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inView = liveRows.filter(
      (r) => (r.archived_at !== null) === (view === "archived"),
    );
    if (!q) return inView;
    return inView.filter(
      (r) => r.title.toLowerCase().includes(q) || r.company.toLowerCase().includes(q),
    );
  }, [liveRows, query, view]);

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
  const owns = (row: Row) => isAdmin || row.created_by === userId;

  /**
   * Editing is for live rows. An archived row is deliberately read-only —
   * restore it first — so the archive reads as a record of what was sent
   * rather than a second place to keep working.
   */
  const canAct = (row: Row) => owns(row) && row.archived_at === null;

  /**
   * What a bulk action would actually touch: selected, currently visible, and
   * yours to act on.
   *
   * Derived rather than pruned in state, because the alternative is acting on
   * rows the search has since hidden — selecting fifty, typing a filter, and
   * hitting Delete would otherwise take the fifty, not the four on screen.
   * Narrowing the view narrows the action, which is the safe direction.
   */
  const targets = useMemo(() => {
    const actionable = new Set(
      data.filter((r) => isAdmin || r.created_by === userId).map((r) => r.id),
    );
    return selected.filter((id) => actionable.has(id));
  }, [selected, data, isAdmin, userId]);

  /**
   * The most recent application for a (profile, company) still inside the
   * cooldown, or null.
   *
   * A courtesy check only — the database trigger is the rule, and it can see
   * teammates' rows this list may not include. Catching it here turns a
   * rejected save into a warning while you are still typing.
   *
   * Searches every row, archived included, because the trigger does: an
   * archived application was still sent, so it still closes the company.
   */
  const cooldownClash = (value: Draft, ignoreId?: string) => {
    if (!value.profile_id || !value.company.trim()) return null;

    const key = normalizeCompany(value.company);
    const when = new Date(value.applied_at).getTime();

    // Distance between the two applications, matching the trigger. Also what
    // keeps this pure: no clock reading during render.
    return (
      liveRows.find(
        (r) =>
          r.id !== ignoreId &&
          r.profile_id === value.profile_id &&
          normalizeCompany(r.company) === key &&
          Math.abs(new Date(r.applied_at).getTime() - when) < COOLDOWN_MS,
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
      return `${clash.company} was already applied to for this profile on ${formatDate(
        clash.applied_at,
      )}. It reopens on ${formatDate(cooldownEnds(clash.applied_at))}.`;
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
    // The row comes back from the insert itself — the id and any default the
    // database filled in — so nothing has to be re-fetched to show it.
    const { data: created, error } = await supabase
      .from("application")
      .insert({
        ...payloadOf(draft),
        resume_document_id: null,
        // RLS asserts both of these in its WITH CHECK clause.
        team_id: teamId,
        created_by: userId,
      })
      .select(ROW_COLUMNS)
      .single();
    setAdding(false);

    if (error) {
      message.error(error.message);
      return;
    }
    mutate((current) => [created, ...current]);
    // Cleared rather than left filled: the row's whole point is being ready for
    // the next entry.
    setDraft(emptyDraft());
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
    const { data: saved, error } = await supabase
      .from("application")
      .update(payloadOf(editBuffer))
      .eq("id", editingId)
      .select(ROW_COLUMNS)
      .single();
    setSaving(false);

    if (error) {
      message.error(error.message);
      return;
    }
    mutate((current) => current.map((r) => (r.id === saved.id ? saved : r)));
    cancelEdit();
  };

  /** "1 application" / "4 applications" — used in every bulk confirmation. */
  const count = (n: number) => `${n} application${n === 1 ? "" : "s"}`;

  /**
   * Archive or restore, one row or many.
   *
   * No dedicated policy backs this: archiving is an ordinary update, so it
   * inherits application_update — your own rows, or any of your team's if you
   * are an admin. `.in()` sends one statement; RLS filters it row by row, so a
   * selection that somehow included a row you cannot touch quietly leaves that
   * row alone instead of failing the whole batch.
   */
  const setArchived = async (ids: string[], archived: boolean) => {
    if (!ids.length) return;
    const wanted = new Set(ids);
    const archived_at = archived ? new Date().toISOString() : null;

    // Applied first so the rows leave this view immediately; put back below if
    // the database disagrees.
    const before = new Map(
      liveRows.filter((r) => wanted.has(r.id)).map((r) => [r.id, r.archived_at]),
    );
    mutate((current) =>
      current.map((r) => (wanted.has(r.id) ? { ...r, archived_at } : r)),
    );
    setSelected([]);

    setBulkBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("application")
      .update({ archived_at })
      .in("id", ids);
    setBulkBusy(false);

    if (error) {
      mutate((current) =>
        current.map((r) =>
          before.has(r.id) ? { ...r, archived_at: before.get(r.id) ?? null } : r,
        ),
      );
      message.error(error.message);
      return;
    }
    message.success(`${count(ids.length)} ${archived ? "archived" : "restored"}.`);
  };

  const remove = async (ids: string[]) => {
    if (!ids.length) return;
    const wanted = new Set(ids);

    // The removed rows are kept, in order, so a refused delete can put them
    // back where they were rather than at the top.
    const snapshot = liveRows;
    mutate((current) => current.filter((r) => !wanted.has(r.id)));
    setSelected([]);

    setBulkBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("application").delete().in("id", ids);
    setBulkBusy(false);

    if (error) {
      mutate(() => snapshot);
      message.error(error.message);
      return;
    }
    message.success(`${count(ids.length)} deleted.`);
  };

  /**
   * Status and billing stay one-click editable outside edit mode.
   *
   * The change lands in the cell before the request leaves. The revert on
   * failure restores only the fields this patch touched, so a second patch to
   * the same row that succeeded in the meantime is not undone with it.
   */
  const quickPatch = async (id: string, values: Partial<Row>) => {
    const before = liveRows.find((r) => r.id === id);
    if (!before) return;
    const touched = Object.keys(values) as (keyof Row)[];
    const previous = Object.fromEntries(touched.map((k) => [k, before[k]]));

    mutate((current) =>
      current.map((r) => (r.id === id ? { ...r, ...values } : r)),
    );

    const supabase = createClient();
    const { error } = await supabase.from("application").update(values).eq("id", id);
    if (error) {
      mutate((current) =>
        current.map((r) => (r.id === id ? { ...r, ...previous } : r)),
      );
      message.error(error.message);
    }
  };

  const baseColumns: ColumnsType<Row> = [
    {
      key: "title",
      title: "Role",
      dataIndex: "title",
      ellipsis: { showTitle: false },
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
          <Marquee title={value}>{value}</Marquee>
        ),
    },
    {
      key: "company",
      title: "Company",
      dataIndex: "company",
      ellipsis: { showTitle: false },
      sorter: (a, b) => a.company.localeCompare(b.company),
      render: (value: string, row) =>
        editingId === row.id ? (
          <Input
            value={editBuffer?.company}
            onChange={(e) => patchEdit({ company: e.target.value })}
            onPressEnter={saveEdit}
          />
        ) : (
          <Marquee title={value}>{value}</Marquee>
        ),
    },
    {
      key: "profile",
      title: "Profile",
      dataIndex: "profile_id",
      ellipsis: { showTitle: false },
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
          <Marquee title={profileName.get(value)}>
            {profileName.get(value) ?? <Muted>unknown</Muted>}
          </Marquee>
        ) : (
          <Muted>none</Muted>
        ),
    },
    {
      key: "applier",
      title: "Applier",
      dataIndex: "created_by",
      ellipsis: { showTitle: false },
      filters: appliers.map((a) => ({ text: a.label, value: a.id })),
      onFilter: (value, row) => row.created_by === value,
      // Never editable: authorship is stamped from the session, and letting it
      // be reassigned would make the audit trail decorative.
      render: (value: string | null) => {
        // `appliers` is built on the server from the rows it loaded, so your
        // first row of the session isn't in it yet. You know who you are.
        const name =
          applierName.get(value ?? "") ?? (value === userId ? "You" : null);
        return name ? <Marquee title={name}>{name}</Marquee> : <Muted>—</Muted>;
      },
    },
    {
      key: "job_url",
      title: "Posting",
      dataIndex: "job_url",
      ellipsis: { showTitle: false },
      render: (value: string, row) =>
        editingId === row.id ? (
          <Input
            value={editBuffer?.job_url}
            onChange={(e) => patchEdit({ job_url: e.target.value })}
            onPressEnter={saveEdit}
          />
        ) : (
          <Marquee title={value}>
            <Typography.Link href={value} target="_blank" rel="noopener noreferrer">
              {hostOf(value)}
            </Typography.Link>
          </Marquee>
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
      ellipsis: { showTitle: false },
      render: (value: string | null, row) =>
        editingId === row.id ? (
          <Input
            value={editBuffer?.notes ?? ""}
            onChange={(e) => patchEdit({ notes: e.target.value })}
            onPressEnter={saveEdit}
          />
        ) : (
          <Marquee title={value ?? undefined}>
            <span style={{ color: value ? undefined : "#94a3b8" }}>
              {value || "—"}
            </span>
          </Marquee>
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
        // owns(), not canAct(): an archived row of your own is read-only but
        // still yours to restore or delete, so it must not fall in here.
        if (!owns(row)) {
          return (
            <Tooltip title="Recorded by a teammate — read only">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                view only
              </Typography.Text>
            </Tooltip>
          );
        }
        if (row.archived_at) {
          return (
            <Space size={0}>
              <Tooltip title="Restore to the active list">
                <Button
                  type="text"
                  icon={<UndoOutlined />}
                  onClick={() => setArchived([row.id], false)}
                />
              </Tooltip>
              <Popconfirm
                title="Delete this application?"
                description="Archiving keeps it. This does not."
                onConfirm={() => remove([row.id])}
                okButtonProps={{ danger: true }}
              >
                <Button type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
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
            <Tooltip title="Archive — keeps the record, off the list">
              <Button
                type="text"
                icon={<InboxOutlined />}
                onClick={() => setArchived([row.id], true)}
              />
            </Tooltip>
            <Popconfirm
              title="Delete this application?"
              description="Archive it instead if you only want it off the list."
              onConfirm={() => remove([row.id])}
              okButtonProps={{ danger: true }}
            >
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  // Only meaningful once a row has been archived, so it is spliced in for that
  // view rather than sitting empty in the other one.
  if (view === "archived") {
    baseColumns.splice(baseColumns.length - 1, 0, {
      key: ARCHIVED_AT_KEY,
      title: "Archived",
      dataIndex: "archived_at",
      sorter: (a, b) => (a.archived_at ?? "").localeCompare(b.archived_at ?? ""),
      render: (value: string | null) =>
        value ? formatDate(value) : <Muted />,
    });
  }

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

  // Selection column included: it is a real column in the layout, and leaving
  // it out would make the table that many pixels narrower than its contents.
  const totalWidth =
    columns.reduce((sum, col) => sum + (Number(col.width) || 0), 0) + 46;

  /**
   * Checkboxes, with the same ownership rule the row controls use.
   *
   * A teammate's row is visible because you share the candidate; disabling its
   * checkbox means "select all" cannot quietly load a batch with rows in it
   * that RLS will refuse. antd's own selections skip disabled rows, so Select
   * all and Invert stay honest for free.
   */
  const rowSelection: TableProps<Row>["rowSelection"] = {
    selectedRowKeys: selected,
    onChange: (keys) => setSelected(keys as string[]),
    getCheckboxProps: (row) => ({ disabled: !owns(row) }),
    selections: [Table.SELECTION_ALL, Table.SELECTION_INVERT, Table.SELECTION_NONE],
    columnWidth: 46,
    fixed: true,
  };

  /** Leaving a view abandons both the selection and any half-finished edit. */
  const changeView = (next: ViewMode) => {
    setView(next);
    setSelected([]);
    setPage(1);
    cancelEdit();
  };

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
        // Both reasons a company can be refused surface here as you type,
        // rather than waiting for the row to be rejected on submit.
        status={
          (draft.company && blocked.has(normalizeCompany(draft.company))) ||
          draftClash
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
        status={draftClash ? "error" : undefined}
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
            {view === "active"
              ? "Type into the top row to add a record. Drag any column edge to resize; double-click a row to edit it."
              : "Archived records are read-only. Restore one to edit it again."}
          </Typography.Text>
        </div>
        <Space>
          <Segmented<ViewMode>
            value={view}
            onChange={changeView}
            options={[
              { value: "active", label: `Active (${liveRows.length - archivedCount})` },
              { value: "archived", label: `Archived (${archivedCount})` },
            ]}
          />
          <Input.Search
            allowClear
            placeholder="Filter by role or company"
            style={{ width: 260 }}
            onChange={(e) => {
              setQuery(e.target.value);
              // Typing narrows the list under you; staying on page 3 of the
              // old one would usually land on nothing.
              setPage(1);
            }}
          />
        </Space>
      </Space>

      {/*
        Only counts rows you can see and act on, so it never promises more than
        the action will do.
      */}
      {targets.length > 0 && (
        <Alert
          type="info"
          style={{ marginBottom: 12 }}
          title={
            <>
              <Typography.Text strong>{targets.length}</Typography.Text>{" "}
              {targets.length === 1 ? "application" : "applications"} selected
              {selected.length > targets.length && (
                <Typography.Text type="secondary">
                  {" "}
                  · {selected.length - targets.length} more hidden by the search
                  — actions apply to what is shown
                </Typography.Text>
              )}
            </>
          }
          action={
            <Space>
              {view === "active" ? (
                <Button
                  size="small"
                  icon={<InboxOutlined />}
                  loading={bulkBusy}
                  onClick={() => setArchived(targets, true)}
                >
                  Archive
                </Button>
              ) : (
                <Button
                  size="small"
                  icon={<UndoOutlined />}
                  loading={bulkBusy}
                  onClick={() => setArchived(targets, false)}
                >
                  Restore
                </Button>
              )}
              <Popconfirm
                title={`Delete ${count(targets.length)}?`}
                description={
                  view === "active"
                    ? "Archive them instead if you only want them off the list."
                    : "This cannot be undone."
                }
                onConfirm={() => remove(targets)}
                okText="Delete"
                okButtonProps={{ danger: true }}
              >
                <Button size="small" danger icon={<DeleteOutlined />} loading={bulkBusy}>
                  Delete
                </Button>
              </Popconfirm>
              <Button size="small" type="text" onClick={() => setSelected([])}>
                Clear
              </Button>
            </Space>
          }
        />
      )}

      {/*
        Shown while typing, not on submit. The rule is enforced by a database
        trigger — which can also see teammates' rows this list may not include —
        but being told after filling in a row is a poor way to find out.
      */}
      {draftClash && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          title={`${draftClash.company} is cooling off for this profile`}
          description={
            <>
              Applied {formatDate(draftClash.applied_at)}
              {draftClash.created_by
                ? ` by ${applierName.get(draftClash.created_by) ?? "a teammate"}`
                : ""}
              {" — "}
              <Typography.Text strong>
                reopens {formatDate(cooldownEnds(draftClash.applied_at))}
              </Typography.Text>
              . Change the company or the profile to continue.
            </>
          }
        />
      )}

      <Card styles={{ body: { padding: 0 } }}>
        <Table<Row>
          rowKey="id"
          size="small"
          className={EXACT_WIDTH_CLASS}
          dataSource={data}
          components={{ header: { cell: ResizableTitle } }}
          /**
           * No `total`, on purpose — it was the bug.
           *
           * antd filters and sorts `dataSource` itself when columns carry
           * `filters`, then paginates *that*. A `total` passed from here counted
           * the rows before the Profile / Status / Applier filters ran, so with
           * any of them active the two disagreed. antd treats "fewer rows than
           * total" as a server-paged table and stops slicing: every filtered
           * row on one page, a pager promising pages that weren't there, and a
           * count that was wrong. Left to itself it knows the true count.
           *
           * `current` is still controlled, so searching or switching view can
           * send you back to page one — but it is fed from the Table's own
           * onChange below, which is also where antd reports the reset it does
           * when a column filter or sort changes. Out of range is fine: antd
           * clamps to the last page before rendering.
           */
          pagination={{
            current: page,
            pageSize,
            position: ["topRight", "bottomRight"],
            showSizeChanger: true,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            showQuickJumper: true,
            onShowSizeChange: (_current, size) => {
              setPageSize(size);
              // The row you were looking at is on a different page now, and
              // there is no honest way to guess which. First is predictable.
              setPage(1);
            },
            // The selection count lives here as well as in the bar above:
            // this row sits directly on the table, top and bottom, so it is in
            // view while you are ticking rows — the bar may not be.
            showTotal: (total, [from, to]) => (
              <Space size={12}>
                <span>
                  {from}–{to} of {total}
                  {view === "archived" ? " archived" : ""}
                </span>
                {targets.length > 0 && (
                  <Tag color="blue" style={{ margin: 0 }}>
                    {targets.length} selected
                  </Tag>
                )}
              </Space>
            ),
          }}
          onChange={(pagination) => setPage(pagination.current ?? 1)}
          /**
           * A number, not "max-content" — and that difference is the whole
           * reason a column could not be narrowed past its content.
           *
           * rc-table picks `table-layout: auto` when there are fixed columns
           * and scroll.x is "max-content" (its own comment: "it's width should
           * stretch out to fit content"). Under `auto` a `width` is a hint the
           * browser is free to overrule, and it always did: a long role title
           * held its column open, the drag snapped back, and `ellipsis` never
           * had anything to truncate.
           *
           * Summing the widths keeps horizontal scrolling for a grid wider than
           * the viewport while making the layout `fixed`, so the widths below
           * are honoured exactly and overflow becomes the cell's problem —
           * which is what Marquee is for.
           */
          tableLayout="fixed"
          scroll={{ x: totalWidth }}
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
          rowSelection={rowSelection}
          onRow={(row) => ({
            onDoubleClick: () => {
              if (editingId === null && canAct(row)) startEdit(row);
            },
          })}
          columns={columns}
          // fixed="top" pins the entry row above the body and outside sorting,
          // filtering and pagination — it stays put whatever the table is doing.
          summary={
            // Nothing to add to an archive, so the entry row belongs to the
            // active view only.
            view === "archived"
              ? undefined
              : () => (
                  <Table.Summary fixed="top">
                    <Table.Summary.Row className="tw-entry-row">
                      {/* Stands in for the checkbox column, which rowSelection
                          adds to the body but not to the summary — without it
                          every cell below sits one column to the left. */}
                      <Table.Summary.Cell index={0} />
                      {COLUMN_KEYS.map((key, index) => (
                        <Table.Summary.Cell key={key} index={index + 1}>
                          {entryCells[key]}
                        </Table.Summary.Cell>
                      ))}
                    </Table.Summary.Row>
                  </Table.Summary>
                )
          }
          locale={{
            emptyText:
              view === "archived"
                ? "Nothing archived."
                : "No applications yet — the row above is ready for one.",
          }}
        />
      </Card>

      <style>{`
        ${MARQUEE_CSS}
        ${EXACT_WIDTH_CSS}
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
    // Flex rather than Space: the name has to be the part that gives, and
    // min-width:0 is what lets a flex child shrink below its content.
    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ flex: "1 1 auto", minWidth: 0 }}>
        {name ? (
          <Marquee title={name}>
            <Typography.Link
              href={url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
            >
              <PaperClipOutlined /> {name}
            </Typography.Link>
          </Marquee>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        )}
      </span>
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
    </span>
  );
}
