"use client";

import {
  CalendarOutlined,
  CopyOutlined,
  EnvironmentOutlined,
  ExportOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { App, Button, Card, Empty, Input, Popover, Segmented, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import {
  calendarLink,
  INTERVIEW_OUTCOMES,
  markInterview,
  OUTCOME,
  type Interview,
  type InterviewOutcome,
} from "@/lib/interviews";
import { applicationNo } from "@/lib/numbers";
import { createClient } from "@/lib/supabase/client";

export type InterviewRow = Interview & {
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
    candidate: string | null;
  };
  /** Whether this person may change the event: its creator, or the super admin. */
  canMark: boolean;
};

type View = "upcoming" | "follow_up" | "past" | "all";

/** A location that's a link — a video call — opens; anything else is just shown. */
const isLink = (value: string) => /^https?:\/\//i.test(value.trim());

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
 * Every interview, as a sheet: when, for which application and candidate,
 * and how it went — marked right here (passed, follow up, …) and saved on
 * the calendar event, so the calendar shows the same. The posting, the
 * resume that was sent and the job description are one click away.
 */
export function InterviewsSheet({ rows: initial, canOpenCalendar }: { rows: InterviewRow[]; canOpenCalendar: boolean }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState(initial);
  const [view, setView] = useState<View>("upcoming");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

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
      const a = r.application;
      return (
        String(a.no) === number.split("-")[0] ||
        a.company.toLowerCase().includes(q) ||
        a.title.toLowerCase().includes(q) ||
        (a.candidate ?? "").toLowerCase().includes(q) ||
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
    setRows((all) => all.map((r) => (r.event_id === row.event_id ? { ...r, outcome } : r)));
    message.success(`${applicationNo(row.application.no, row.application.part)} marked ${OUTCOME[outcome].label.toLowerCase()}.`);
  };

  return (
    <>
      <PageHeader
        title="Interviews"
        description="From the calendar — every interview linked to an application. Mark how it went here; the calendar shows the same."
        extra={
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="A007, company, role or candidate"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 280, maxWidth: "100%" }}
          />
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
                      ? "No interviews coming up. Link an event to an application on the calendar and it shows here."
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
                    <span className="tw-num" style={{ fontWeight: 600, marginInlineEnd: 6 }}>
                      {applicationNo(r.application.no, r.application.part)}
                    </span>
                    {r.application.title} — {r.application.company}
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {r.application.candidate ?? "No profile"}
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
          ]}
        />
      </Card>

      <style>{`.tw-today > td { background: #faf5ff !important; }`}</style>
    </>
  );
}
