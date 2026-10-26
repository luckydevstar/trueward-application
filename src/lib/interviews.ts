import { createClient } from "@/lib/supabase/client";

/*
 * Interviews are Trueward Calendar's events linked to an application. The
 * tracker reads them through application_interviews() (the calendar's
 * schema), which shows an interview to whoever can see its application, and
 * marks them on the event itself — so the calendar, the Applications grid and
 * the Interviews page always agree.
 */

export const INTERVIEW_OUTCOMES = ["scheduled", "passed", "failed", "follow_up", "cancelled"] as const;
export type InterviewOutcome = (typeof INTERVIEW_OUTCOMES)[number];

/** One interview, as application_interviews() returns it. */
export type Interview = {
  application_id: string;
  event_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  outcome: InterviewOutcome | null;
  created_by: string | null;
  /** Added with the Interviews page; absent until the calendar's schema is re-run. */
  location?: string | null;
  description?: string | null;
  all_day?: boolean | null;
};

export const OUTCOME: Record<InterviewOutcome, { label: string; color: string }> = {
  scheduled: { label: "Scheduled", color: "blue" },
  passed: { label: "Passed", color: "green" },
  failed: { label: "Failed", color: "red" },
  follow_up: { label: "Follow up", color: "gold" },
  cancelled: { label: "Cancelled", color: "default" },
};

export const CALENDAR_URL = process.env.NEXT_PUBLIC_CALENDAR_URL ?? "https://calendar.trueward.guru";

/** The calendar, open on the interview's day with its dialog showing. */
export const calendarLink = (interview: Pick<Interview, "event_id" | "starts_at">) =>
  `${CALENDAR_URL}/?date=${interview.starts_at.slice(0, 10)}&event=${interview.event_id}`;

/**
 * Marks how an interview went, on the calendar event. The calendar's own
 * policy decides who may: the event's creator, or the super admin.
 */
export async function markInterview(eventId: string, outcome: InterviewOutcome): Promise<string | null> {
  const { data, error } = await createClient()
    .from("calendar_event" as never)
    .update({ interview_outcome: outcome } as never)
    .eq("id", eventId)
    .select("id");
  if (error?.code === "23514") {
    return "The calendar doesn't know that outcome yet — run the calendar's schema.sql again.";
  }
  if (error) return error.message;
  if (!(data as unknown[] | null)?.length) return "Only the event's creator or the super admin can mark it.";
  return null;
}
