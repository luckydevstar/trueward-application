"use client";

import { CalendarOutlined } from "@ant-design/icons";
import { App, Button, Popover, Select, Tag, Typography } from "antd";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

/** An interview: a calendar event linked to the application (Trueward Calendar). */
export type Interview = {
  application_id: string;
  event_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  outcome: "scheduled" | "passed" | "failed" | "cancelled" | null;
  created_by: string | null;
};

const OUTCOME: Record<NonNullable<Interview["outcome"]>, { label: string; color: string }> = {
  scheduled: { label: "Scheduled", color: "blue" },
  passed: { label: "Passed", color: "green" },
  failed: { label: "Failed", color: "red" },
  cancelled: { label: "Cancelled", color: "default" },
};

const CALENDAR_URL = process.env.NEXT_PUBLIC_CALENDAR_URL ?? "https://calendar.trueward.guru";

/**
 * An application's interviews, in the Applications grid: the latest outcome
 * and how many, opening onto the list. Whoever may change the calendar event
 * (its creator, or the super admin — the calendar's own rule) can mark the
 * outcome here too; everyone else reads it.
 */
export function InterviewCell({
  interviews: initial,
  userId,
  isSuperAdmin,
  canOpenCalendar,
}: {
  interviews: Interview[];
  userId: string;
  isSuperAdmin: boolean;
  /** Bidders can't use the calendar, so they get no link that leads to a refusal. */
  canOpenCalendar: boolean;
}) {
  const { message } = App.useApp();
  const [interviews, setInterviews] = useState(initial);
  const [saving, setSaving] = useState<string | null>(null);

  if (!interviews.length) return <Typography.Text type="secondary">—</Typography.Text>;

  const latest = interviews[interviews.length - 1];
  const look = OUTCOME[latest.outcome ?? "scheduled"];

  const mark = async (interview: Interview, outcome: NonNullable<Interview["outcome"]>) => {
    setSaving(interview.event_id);
    const { data, error } = await createClient()
      .from("calendar_event" as never)
      .update({ interview_outcome: outcome } as never)
      .eq("id", interview.event_id)
      .select("id");
    setSaving(null);
    if (error || !(data as unknown[] | null)?.length) {
      message.error(error?.message ?? "Only the event's creator or the super admin can mark it.");
      return;
    }
    setInterviews((all) => all.map((i) => (i.event_id === interview.event_id ? { ...i, outcome } : i)));
  };

  const list = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 300, maxWidth: 380 }}>
      {interviews.map((i) => {
        const editable = isSuperAdmin || i.created_by === userId;
        const tag = OUTCOME[i.outcome ?? "scheduled"];
        return (
          <div key={i.event_id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {i.title || "Interview"}
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {new Date(i.starts_at).toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Typography.Text>
            </div>
            {editable ? (
              <Select
                size="small"
                value={i.outcome ?? "scheduled"}
                loading={saving === i.event_id}
                onChange={(v) => mark(i, v)}
                style={{ width: 118 }}
                options={Object.entries(OUTCOME).map(([value, o]) => ({ value, label: o.label }))}
              />
            ) : (
              <Tag color={tag.color} bordered={false} style={{ margin: 0 }}>
                {tag.label}
              </Tag>
            )}
          </div>
        );
      })}
      {canOpenCalendar && (
        <Button size="small" icon={<CalendarOutlined />} href={CALENDAR_URL} target="_blank" rel="noreferrer">
          Open the calendar
        </Button>
      )}
    </div>
  );

  return (
    <Popover content={list} title="Interviews" trigger="click" placement="bottomLeft">
      <button
        type="button"
        style={{ all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <Tag color={look.color} bordered={false} style={{ margin: 0 }}>
          {look.label}
        </Tag>
        {interviews.length > 1 && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {interviews.length} rounds
          </Typography.Text>
        )}
      </button>
    </Popover>
  );
}
