"use client";

import {
  CalendarOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EnvironmentOutlined,
  ExportOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Popover,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { InterviewForm, type Booking } from "@/components/interview-form";
import { PageHeader } from "@/components/page-header";
import {
  calendarLink,
  deleteInterview,
  INTERVIEW_OUTCOMES,
  markInterview,
  OUTCOME,
  type Interview,
  type InterviewOutcome,
} from "@/lib/interviews";
import { applicationNo } from "@/lib/numbers";
import { applyOverlay, resolveOverlay, type Overlay } from "@/lib/overlay";
import { createClient } from "@/lib/supabase/client";

export type InterviewRow = Interview & {
  /**
   * The application it was linked to. Null for an interview booked in its
   * own right, which says what it is for itself (the interview_* fields).
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
   * The candidate's name — the application's, or the profile one booked in
   * its own right names — when this person may read it.
   */
  candidate: string | null;
  /** The calendar the event is on, for the rows this person may change. */
  calendarId: string | null;
  /** Whether this person may change the event: its creator, or the super admin. */
  canMark: boolean;
};

type View = "upcoming" | "follow_up" | "past" | "all";

/** A location that's a link — a video call — opens; anything else is just shown. */
const isLink = (value: string) => /^https?:\/\//i.test(value.trim());

/** What an interview is for: its application's company and role, or its own. */
const about = (r: InterviewRow) =>
  r.application
    ? { company: r.application.company, role: r.application.title }
    : { company: r.interview_company ?? "", role: r.interview_role ?? "" };

/** Why an interview booked in its own right has no resume or job description. */
const NO_APPLICATION = "Booked without an application";

/** The job description, fetched when asked for — the list doesn't carry them. */
function DescriptionButton({ jobId }: { jobId: string | null }) {
  const { message } = App.useApp();
  const [text, setText] = useState<string | null | undefined>(undefined);

  if (!jobId) {
    return (
      <Tooltip title="Recorded without a job description">
        <Button size="small" icon={<FileTextOutlined />} disabled>
          JD
        </Button>
      </Tooltip>
    );
  }

  const load = async (open: boolean) => {
    if (!open || text !== undefined) return;
    const { data } = await createClient().from("job").select("description").eq("id", jobId).maybeSingle();
    setText(data?.description ?? null);
  };

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      onOpenChange={load}
      title={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span>Job description</span>
          {text && (
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined />}
              aria-label="Copy the job description"
              onClick={() => {
                void navigator.clipboard.writeText(text);
                message.success("Copied.");
              }}
            />
          )}
        </div>
      }
      content={
        <div style={{ width: 460, maxWidth: "80vw", maxHeight: 360, overflow: "auto", whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.55 }}>
          {text === undefined ? "Loading…" : (text ?? "It isn't there any more.")}
        </div>
      }
    >
      <Button size="small" icon={<FileTextOutlined />}>
        JD
      </Button>
    </Popover>
  );
}

/**
 * Every interview, as a sheet: when, for which application (or company and
 * role, for one booked in its own right) and candidate, and how it went —
 * marked right here (passed, follow up, …) and saved on the calendar event,
 * so the calendar shows the same. The posting, the resume that was sent and
 * the job description are one click away.
 *
 * The calendar's users (`booking`) add interviews here too — one scheduled by
 * email, with no application behind it — and change or delete the ones they
 * may: their own, or anyone's for the super admin.
 */
export function InterviewsSheet({
  rows: initial,
  canOpenCalendar,
  booking,
}: {
  rows: InterviewRow[];
  canOpenCalendar: boolean;
  /** Null for a bidder, who can't use the calendar and so books nothing. */
  booking: Booking | null;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  /*
   * This session's marks and deletes over the server's rows, dropped as soon
   * as router.refresh() brings new ones — see src/lib/overlay.ts. useState
   * alone would keep the rows the page first arrived with, refresh or not.
   */
  const [overlay, setOverlay] = useState<Overlay<InterviewRow> | null>(null);
  const rows = resolveOverlay(overlay, initial);
  const change = (next: (current: readonly InterviewRow[]) => readonly InterviewRow[]) =>
    setOverlay((previous) => applyOverlay(previous, initial, next));
  const [view, setView] = useState<View>("upcoming");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  // The form is mounted while it's showing, and dropped once it has closed.
  // Counted, so reopening one before the last has finished closing still
  // starts it fresh.
  const [formFor, setFormFor] = useState<{ row: InterviewRow | null; n: number } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const openForm = (row: InterviewRow | null) => {
    setFormFor((previous) => ({ row, n: (previous?.n ?? 0) + 1 }));
    setFormOpen(true);
  };

  // Today's interviews count as upcoming until the day is over.
  const [todayStart] = useState(() => dayjs().startOf("day").valueOf());
  const isUpcoming = (r: InterviewRow) => Date.parse(r.ends_at) >= todayStart;

  const counts = useMemo(
    () => ({
      upcoming: rows.filter(isUpcoming).length,
      follow_up: rows.filter((r) => r.outcome === "follow_up").length,
      past: rows.filter((r) => !isUpcoming(r)).length,
      all: rows.length,
    }),
    // isUpcoming reads todayStart, fixed for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const number = q.replace(/^a0*/, "");
    const list = rows.filter((r) => {
      if (view === "upcoming" && !isUpcoming(r)) return false;
      if (view === "past" && isUpcoming(r)) return false;
      if (view === "follow_up" && r.outcome !== "follow_up") return false;
      if (!q) return true;
      const { company, role } = about(r);
      return (
        (r.application !== null && String(r.application.no) === number.split("-")[0]) ||
        company.toLowerCase().includes(q) ||
        role.toLowerCase().includes(q) ||
        (r.candidate ?? "").toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q)
      );
    });
    // Soonest first for what's coming; most recent first for the rest.
    return list.sort((x, y) =>
      view === "upcoming" ? x.starts_at.localeCompare(y.starts_at) : y.starts_at.localeCompare(x.starts_at),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, view, query]);

  const mark = async (row: InterviewRow, outcome: InterviewOutcome) => {
    setSaving(row.event_id);
    const problem = await markInterview(row.event_id, outcome);
    setSaving(null);
    if (problem) {
      message.error(problem);
      return;
    }
    change((all) => all.map((r) => (r.event_id === row.event_id ? { ...r, outcome } : r)));
    const name = row.application
      ? applicationNo(row.application.no, row.application.part)
      : about(row).company || "The interview";
    message.success(`${name} marked ${OUTCOME[outcome].label.toLowerCase()}.`);
  };

  /** Deletes the event itself — the calendar's policy decides who may. */
  const remove = async (row: InterviewRow) => {
    const problem = await deleteInterview(row.event_id);
    if (problem) {
      message.error(problem);
      return;
    }
    change((all) => all.filter((r) => r.event_id !== row.event_id));
    message.success("Interview deleted — it's off the calendar too.");
    router.refresh();
  };

  return (
    <>
      <PageHeader
        title="Interviews"
        description="From the calendar — every interview, linked to an application or booked here. Mark how it went here; the calendar shows the same."
        extra={
          <>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="A007, company, role or candidate"
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
        <div style={{ padding: "14px 16px" }}>
          <Segmented<View>
            value={view}
            onChange={setView}
            options={[
              { value: "upcoming", label: `Upcoming · ${counts.upcoming}` },
              { value: "follow_up", label: `Follow up · ${counts.follow_up}` },
              { value: "past", label: `Past · ${counts.past}` },
              { value: "all", label: `All · ${counts.all}` },
            ]}
          />
        </div>
        <Table<InterviewRow>
          rowKey="event_id"
          size="middle"
          dataSource={shown}
          pagination={shown.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
          scroll={{ x: 1000 }}
          rowClassName={(r) => (dayjs(r.starts_at).isSame(dayjs(), "day") ? "tw-today" : "")}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  query
                    ? "Nothing matches that."
                    : view === "upcoming"
                      ? booking
                        ? "No interviews coming up. Add one, or link an event to an application on the calendar, and it shows here."
                        : "No interviews coming up. Link an event to an application on the calendar and it shows here."
                      : view === "follow_up"
                        ? "Nothing waiting on a follow-up."
                        : "No interviews yet."
                }
              />
            ),
          }}
          columns={[
            {
              title: "When",
              key: "when",
              width: 190,
              render: (_, r) => {
                const start = dayjs(r.starts_at);
                const days = start.startOf("day").diff(dayjs().startOf("day"), "day");
                const relative =
                  days === 0 ? "Today" : days === 1 ? "Tomorrow" : days > 1 && days < 7 ? `In ${days} days` : null;
                return (
                  <div style={{ lineHeight: 1.35 }}>
                    <div style={{ fontWeight: 600 }}>
                      {start.format("ddd, MMM D")}
                      {relative && (
                        <Tag color={days === 0 ? "purple" : "default"} bordered={false} style={{ marginInlineStart: 6 }}>
                          {relative}
                        </Tag>
                      )}
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.all_day ? "All day" : `${start.format("h:mm A")} – ${dayjs(r.ends_at).format("h:mm A")}`}
                    </Typography.Text>
                  </div>
                );
              },
            },
            {
              title: "Application",
              key: "application",
              render: (_, r) => (
                <div style={{ lineHeight: 1.35, minWidth: 0 }}>
                  <div>
                    {r.application ? (
                      <span className="tw-num" style={{ fontWeight: 600, marginInlineEnd: 6 }}>
                        {applicationNo(r.application.no, r.application.part)}
                      </span>
                    ) : (
                      <Tooltip title={`${NO_APPLICATION} — by email, say`}>
                        <Tag bordered={false} style={{ marginInlineEnd: 6 }}>
                          No application
                        </Tag>
                      </Tooltip>
                    )}
                    {[about(r).role, about(r).company].filter(Boolean).join(" — ") || r.title || "Interview"}
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {r.candidate ?? (r.interview_profile_id ? "A candidate on another team" : "No profile")}
                    {r.title ? ` · ${r.title}` : ""}
                  </Typography.Text>
                  {r.location && (
                    <div style={{ fontSize: 12 }}>
                      <EnvironmentOutlined style={{ color: "#94a3b8", marginInlineEnd: 4 }} />
                      {isLink(r.location) ? (
                        <a href={r.location.trim()} target="_blank" rel="noreferrer">
                          Join the call
                        </a>
                      ) : (
                        <Typography.Text type="secondary">{r.location}</Typography.Text>
                      )}
                    </div>
                  )}
                </div>
              ),
            },
            {
              title: "Outcome",
              key: "outcome",
              width: 170,
              render: (_, r) => {
                const value = r.outcome ?? "scheduled";
                return r.canMark ? (
                  <Select<InterviewOutcome>
                    size="small"
                    value={value}
                    loading={saving === r.event_id}
                    onChange={(next) => mark(r, next)}
                    style={{ width: 150 }}
                    aria-label="Outcome"
                    options={INTERVIEW_OUTCOMES.map((o) => ({
                      value: o,
                      label: (
                        <Tag color={OUTCOME[o].color} bordered={false} style={{ margin: 0 }}>
                          {OUTCOME[o].label}
                        </Tag>
                      ),
                    }))}
                  />
                ) : (
                  <Tooltip title="Marked by whoever scheduled it, or the super admin">
                    <Tag color={OUTCOME[value].color} bordered={false}>
                      {OUTCOME[value].label}
                    </Tag>
                  </Tooltip>
                );
              },
            },
            {
              title: "Open",
              key: "links",
              width: 330,
              render: (_, r) => (
                <Space size={6} wrap>
                  {r.application ? (
                    <>
                      <Button size="small" icon={<ExportOutlined />} href={r.application.jobUrl} target="_blank" rel="noreferrer">
                        Posting
                      </Button>
                      {r.application.resumeUrl ? (
                        <Tooltip title={r.application.resumeName ?? undefined}>
                          <Button size="small" icon={<FilePdfOutlined />} href={r.application.resumeUrl} target="_blank" rel="noreferrer">
                            Resume
                          </Button>
                        </Tooltip>
                      ) : (
                        <Tooltip title="No resume attached to this application">
                          <Button size="small" icon={<FilePdfOutlined />} disabled>
                            Resume
                          </Button>
                        </Tooltip>
                      )}
                      <DescriptionButton jobId={r.application.jobId} />
                    </>
                  ) : (
                    // Booked in its own right: its own job link, and no application to
                    // have sent a resume or carried a job description.
                    <>
                      {r.interview_job_url && isLink(r.interview_job_url) ? (
                        <Button size="small" icon={<ExportOutlined />} href={r.interview_job_url.trim()} target="_blank" rel="noreferrer">
                          Posting
                        </Button>
                      ) : (
                        <Tooltip title="Booked without a job link">
                          <Button size="small" icon={<ExportOutlined />} disabled>
                            Posting
                          </Button>
                        </Tooltip>
                      )}
                      <Tooltip title={`${NO_APPLICATION}, so no resume was sent with it`}>
                        <Button size="small" icon={<FilePdfOutlined />} disabled>
                          Resume
                        </Button>
                      </Tooltip>
                      <Tooltip title={`${NO_APPLICATION}, so there's no job description`}>
                        <Button size="small" icon={<FileTextOutlined />} disabled>
                          JD
                        </Button>
                      </Tooltip>
                    </>
                  )}
                  {canOpenCalendar && (
                    <Tooltip title="Open it on the calendar">
                      <Button
                        size="small"
                        type="text"
                        icon={<CalendarOutlined />}
                        aria-label="Open it on the calendar"
                        href={calendarLink(r)}
                        target="_blank"
                        rel="noreferrer"
                      />
                    </Tooltip>
                  )}
                </Space>
              ),
            },
            // Change and delete, for the rows whose event this person may change.
            ...(booking
              ? [
                  {
                    title: "",
                    key: "actions",
                    width: 84,
                    render: (_: unknown, r: InterviewRow) =>
                      r.canMark && (
                        <Space size={0}>
                          <Tooltip title="Change it">
                            <Button
                              type="text"
                              icon={<EditOutlined />}
                              aria-label="Change this interview"
                              onClick={() => openForm(r)}
                            />
                          </Tooltip>
                          <Popconfirm
                            title="Delete this interview?"
                            description="It's an event, so it comes off the calendar too."
                            okText="Delete"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => remove(r)}
                          >
                            <Button type="text" danger icon={<DeleteOutlined />} aria-label="Delete this interview" />
                          </Popconfirm>
                        </Space>
                      ),
                  },
                ]
              : []),
          ]}
        />
      </Card>

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

      <style>{`.tw-today > td { background: #faf5ff !important; }`}</style>
    </>
  );
}
