"use client";

import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { App, Button, Card, Dropdown, Empty, Input, Modal, Select, Table, Tag, Tooltip } from "antd";
import type { MenuProps } from "antd";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { InterviewForm, type Booking } from "@/components/interview-form";
import { PageHeader } from "@/components/page-header";
import {
  calendarLink,
  deleteInterview,
  INTERVIEW_STATUSES,
  markInterview,
  STATUS,
  type Interview,
  type InterviewStatus,
} from "@/lib/interviews";
import { applicationNo } from "@/lib/numbers";
import { applyOverlay, resolveOverlay, type Overlay } from "@/lib/overlay";
import { createClient } from "@/lib/supabase/client";

export type InterviewRow = Interview & {
  /**
   * The application it was linked to. Null for one that wasn't — scheduled
   * by email, say — which says what it is for itself (the interview_* fields).
   */
  application: {
    id: string;
    no: number;
    part: number;
    title: string;
    company: string;
    jobUrl: string;
    resumeUrl: string | null;
    resumeName: string | null;
    status: string;
    jobId: string | null;
    profileId: string | null;
  } | null;
  /**
   * The candidate's name — the application's, or the profile the interview
   * names — when this person may read it.
   */
  candidate: string | null;
  /** The calendar the event is on, for the rows this person may change. */
  calendarId: string | null;
  /** Whether this person may change the event: its creator, or the super admin. */
  canMark: boolean;
};

/** A location that's a link — a video call — opens; anything else is just shown. */
const isLink = (value: string) => /^https?:\/\//i.test(value.trim());

/**
 * What an interview is for: its own company and role, or its application's
 * where it leaves them empty.
 */
const about = (r: InterviewRow) => ({
  company: r.interview_company || r.application?.company || "",
  role: r.interview_role || r.application?.title || "",
});

/** Clicks on these act for themselves, not for the row they sit in. */
const OWN_CLICK = "a, button, input, .ant-select, .ant-dropdown-trigger";

/**
 * Every interview on one sheet — no tabs, newest first — one line a row:
 * date, time, role, company, interviewer, location, who handles it, and its
 * status, marked right here and saved on the calendar event, so the calendar
 * labels the slot the same.
 *
 * A row opens its slot on the calendar; the calendar's "Open on the
 * Interviews page" comes back to the row (`focus`), scrolled to and lit. The
 * posting, the resume that was sent, the job description, and changing or
 * deleting the interview are in the menu at the end of the row.
 */
export function InterviewsSheet({
  rows: initial,
  canOpenCalendar,
  booking,
  focus,
}: {
  rows: InterviewRow[];
  canOpenCalendar: boolean;
  /** Null for a bidder, who can't use the calendar and so books nothing. */
  booking: Booking | null;
  /** The interview to show — from the calendar's link back to this page. */
  focus: string | null;
}) {
  const router = useRouter();
  const { message, modal } = App.useApp();
  /*
   * This session's marks and deletes over the server's rows, dropped as soon
   * as router.refresh() brings new ones — see src/lib/overlay.ts. useState
   * alone would keep the rows the page first arrived with, refresh or not.
   */
  const [overlay, setOverlay] = useState<Overlay<InterviewRow> | null>(null);
  const rows = resolveOverlay(overlay, initial);
  const change = (next: (current: readonly InterviewRow[]) => readonly InterviewRow[]) =>
    setOverlay((previous) => applyOverlay(previous, initial, next));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [description, setDescription] = useState<{ jobId: string; text: string | null | undefined } | null>(null);

  // The form is mounted while it's showing, and dropped once it has closed.
  // Counted, so reopening one before the last has finished closing still
  // starts it fresh.
  const [formFor, setFormFor] = useState<{ row: InterviewRow | null; n: number } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const openForm = (row: InterviewRow | null) => {
    setFormFor((previous) => ({ row, n: (previous?.n ?? 0) + 1 }));
    setFormOpen(true);
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const number = q.replace(/^a0*/, "");
    return rows
      .filter((r) => {
        if (!q) return true;
        const { company, role } = about(r);
        return (
          (r.application !== null && String(r.application.no) === number.split("-")[0]) ||
          [company, role, r.interviewer, r.handler, r.location, r.candidate, r.title].some((field) =>
            (field ?? "").toLowerCase().includes(q),
          )
        );
      })
      .sort((x, y) => y.starts_at.localeCompare(x.starts_at));
  }, [rows, query]);

  // Arrived from the calendar: bring that row into view. Once, on arrival.
  useEffect(() => {
    if (!focus) return;
    const row = document.querySelector(`tr[data-row-key="${CSS.escape(focus)}"]`);
    if (row) row.scrollIntoView({ block: "center" });
    else message.info("That interview isn't on your sheet — it may have been deleted, or belong to another team.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mark = async (row: InterviewRow, status: InterviewStatus) => {
    setSaving(row.event_id);
    const problem = await markInterview(row.event_id, status);
    setSaving(null);
    if (problem) {
      message.error(problem);
      return;
    }
    change((all) => all.map((r) => (r.event_id === row.event_id ? { ...r, status } : r)));
    const name = row.application
      ? applicationNo(row.application.no, row.application.part)
      : about(row).company || "The interview";
    message.success(`${name} marked ${STATUS[status].label.toLowerCase()}.`);
  };

  /** Deletes the event itself — the calendar's policy decides who may. */
  const remove = (row: InterviewRow) =>
    modal.confirm({
      title: "Delete this interview?",
      content: "It's an event, so it comes off the calendar too.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        const problem = await deleteInterview(row.event_id);
        if (problem) {
          message.error(problem);
          return;
        }
        change((all) => all.filter((r) => r.event_id !== row.event_id));
        message.success("Interview deleted — it's off the calendar too.");
        router.refresh();
      },
    });

  /** The job description, fetched when asked for — the list doesn't carry them. */
  const showDescription = async (jobId: string) => {
    setDescription({ jobId, text: undefined });
    const { data } = await createClient().from("job").select("description").eq("id", jobId).maybeSingle();
    setDescription((d) => (d?.jobId === jobId ? { jobId, text: data?.description ?? null } : d));
  };

  /** What the menu at the end of a row offers: what the interview came with, and changing it. */
  const menu = (r: InterviewRow): MenuProps["items"] => {
    const posting = r.application?.jobUrl ?? (r.interview_job_url && isLink(r.interview_job_url) ? r.interview_job_url.trim() : null);
    const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
    return [
      {
        key: "posting",
        icon: <ExportOutlined />,
        label: "Posting",
        disabled: !posting,
        onClick: () => posting && open(posting),
      },
      {
        key: "resume",
        icon: <FilePdfOutlined />,
        label: r.application?.resumeUrl ? "Resume" : "Resume — none sent",
        disabled: !r.application?.resumeUrl,
        onClick: () => r.application?.resumeUrl && open(r.application.resumeUrl),
      },
      {
        key: "jd",
        icon: <FileTextOutlined />,
        label: r.application?.jobId ? "Job description" : "Job description — none",
        disabled: !r.application?.jobId,
        onClick: () => r.application?.jobId && void showDescription(r.application.jobId),
      },
      ...(booking && r.canMark
        ? [
            { type: "divider" as const },
            { key: "edit", icon: <EditOutlined />, label: "Change it", onClick: () => openForm(r) },
            { key: "delete", icon: <DeleteOutlined />, label: "Delete", danger: true, onClick: () => remove(r) },
          ]
        : []),
    ];
  };

  const today = dayjs();

  return (
    <>
      <PageHeader
        title="Interviews"
        description="Every interview on the calendar, newest first. Click a row to open its slot on the calendar; mark the status here and the calendar shows the same."
        extra={
          <>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="A007, company, role, interviewer…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 280, maxWidth: "100%" }}
            />
            {booking && (
              <Tooltip title={booking.calendars.length ? undefined : "Add a calendar on Trueward Calendar first."}>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  disabled={!booking.calendars.length}
                  onClick={() => openForm(null)}
                >
                  Add interview
                </Button>
              </Tooltip>
            )}
          </>
        }
      />

      <Card variant="borderless" styles={{ body: { padding: 0 } }}>
        <Table<InterviewRow>
          className="tw-sheet"
          rowKey="event_id"
          size="middle"
          tableLayout="fixed"
          dataSource={shown}
          pagination={false}
          sticky
          scroll={{ x: 1180 }}
          rowClassName={(r) =>
            [
              r.event_id === focus ? "tw-focus" : "",
              dayjs(r.starts_at).isSame(today, "day") ? "tw-today" : "",
              canOpenCalendar ? "tw-link" : "",
            ].join(" ")
          }
          onRow={(r) => ({
            onClick: (e) => {
              if (!canOpenCalendar) return;
              // A click inside the row's own controls — or one bubbling up
              // from a dropdown, which React passes through its portal — is
              // the control's, not a request to leave for the calendar.
              const target = e.target as HTMLElement;
              if (!e.currentTarget.contains(target) || target.closest(OWN_CLICK)) return;
              window.open(calendarLink(r), "_blank", "noopener,noreferrer");
            },
          })}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  query
                    ? "Nothing matches that."
                    : booking
                      ? "No interviews yet. Add one here, or make an event an interview on the calendar."
                      : "No interviews yet."
                }
              />
            ),
          }}
          columns={[
            {
              title: "Date",
              key: "date",
              width: 120,
              render: (_, r) => <span style={{ fontWeight: 600 }}>{dayjs(r.starts_at).format("ddd, MMM D")}</span>,
            },
            {
              title: "Time",
              key: "time",
              width: 150,
              render: (_, r) =>
                r.all_day ? "All day" : `${dayjs(r.starts_at).format("h:mm A")} – ${dayjs(r.ends_at).format("h:mm A")}`,
            },
            {
              title: "Role",
              key: "role",
              ellipsis: true,
              render: (_, r) => (
                <Tooltip
                  title={[
                    r.application ? applicationNo(r.application.no, r.application.part) : null,
                    r.candidate ?? (r.interview_profile_id ? "A candidate on another team" : null),
                    r.title,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                >
                  <span>
                    {r.application && (
                      <span className="tw-num" style={{ color: "#64748b", marginInlineEnd: 6 }}>
                        {applicationNo(r.application.no, r.application.part)}
                      </span>
                    )}
                    {about(r).role || r.title || "—"}
                  </span>
                </Tooltip>
              ),
            },
            { title: "Company", key: "company", width: 170, ellipsis: true, render: (_, r) => about(r).company || "—" },
            { title: "Interviewer", key: "interviewer", width: 150, ellipsis: true, render: (_, r) => r.interviewer || "—" },
            {
              title: "Location",
              key: "location",
              width: 160,
              ellipsis: true,
              render: (_, r) =>
                !r.location ? (
                  "—"
                ) : isLink(r.location) ? (
                  <a href={r.location.trim()} target="_blank" rel="noreferrer" title={r.location}>
                    Join the call
                  </a>
                ) : (
                  <span title={r.location}>{r.location}</span>
                ),
            },
            { title: "Handler", key: "handler", width: 130, ellipsis: true, render: (_, r) => r.handler || "—" },
            {
              title: "Status",
              key: "status",
              width: 128,
              render: (_, r) => {
                const value = r.status ?? "pending";
                return r.canMark ? (
                  <Select<InterviewStatus>
                    size="small"
                    variant="borderless"
                    value={value}
                    loading={saving === r.event_id}
                    onChange={(next) => mark(r, next)}
                    style={{ width: 108 }}
                    aria-label="Status"
                    options={INTERVIEW_STATUSES.map((o) => ({
                      value: o,
                      label: (
                        <Tag color={STATUS[o].color} bordered={false} style={{ margin: 0 }}>
                          {STATUS[o].label}
                        </Tag>
                      ),
                    }))}
                  />
                ) : (
                  <Tooltip title="Marked by whoever booked it, or the super admin">
                    <Tag color={STATUS[value].color} bordered={false}>
                      {STATUS[value].label}
                    </Tag>
                  </Tooltip>
                );
              },
            },
            {
              title: "",
              key: "more",
              width: 48,
              render: (_, r) => (
                <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: menu(r) }}>
                  <Button type="text" size="small" icon={<MoreOutlined />} aria-label="More for this interview" />
                </Dropdown>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={description !== null}
        title="Job description"
        footer={null}
        width={620}
        onCancel={() => setDescription(null)}
      >
        <div style={{ position: "relative" }}>
          {description?.text && (
            <Tooltip title="Copy">
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined />}
                aria-label="Copy the job description"
                style={{ position: "absolute", top: 0, right: 0 }}
                onClick={() => {
                  void navigator.clipboard.writeText(description.text!);
                  message.success("Copied.");
                }}
              />
            </Tooltip>
          )}
          <div style={{ maxHeight: "60vh", overflow: "auto", whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.55, paddingRight: 28 }}>
            {description?.text === undefined ? "Loading…" : (description.text ?? "It isn't there any more.")}
          </div>
        </div>
      </Modal>

      {booking && formFor && (
        <InterviewForm
          key={formFor.n}
          row={formFor.row}
          booking={booking}
          open={formOpen}
          onClose={() => setFormOpen(false)}
          afterClose={() => setFormFor(null)}
          onSaved={() => {
            setFormOpen(false);
            router.refresh();
          }}
        />
      )}

      <style>{`
        /* One line a row, so every row is the same height. */
        .tw-sheet td { white-space: nowrap; }
        .tw-sheet .tw-link { cursor: pointer; }
        .tw-today > td { background: #faf5ff !important; }
        .tw-focus > td { background: #fef9c3 !important; }
        .tw-focus > td:first-child { box-shadow: inset 3px 0 0 #eab308; }
      `}</style>
    </>
  );
}
