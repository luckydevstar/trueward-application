import { applicationNo, parseRecordNo } from "@/lib/numbers";
import { createClient } from "@/lib/supabase/client";

/*
 * Interviews are Trueward Calendar's events with an outcome. Most are linked
 * to an application; some are booked in their own right on the Interviews
 * page — one scheduled by email, with no application behind it — and say
 * what they are for themselves (the interview_* fields). The tracker reads
 * them through application_interviews() (the calendar's schema), which shows
 * a linked interview to whoever can see its application and one booked in
 * its own right to the calendar's users and whoever may use its candidate,
 * and writes them on the event itself — so the calendar, the Applications
 * grid and the Interviews page always agree.
 */

export const INTERVIEW_OUTCOMES = ["scheduled", "passed", "failed", "follow_up", "cancelled"] as const;
export type InterviewOutcome = (typeof INTERVIEW_OUTCOMES)[number];

/** One interview, as application_interviews() returns it. */
export type Interview = {
  /** Null for an interview booked in its own right. */
  application_id: string | null;
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
  /**
   * What an interview booked in its own right is for. Null on a linked one,
   * which reads all of this from its application; absent until the
   * calendar's schema is re-run.
   */
  interview_company?: string | null;
  interview_role?: string | null;
  interview_profile_id?: string | null;
  interview_job_url?: string | null;
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

/** What an interview booked here is called on the calendar. */
export const interviewTitle = (company: string, role: string) => `Interview · ${company} — ${role}`;

/**
 * A refused or failed write to the calendar, as a sentence. Its schema is run
 * by hand, so the likeliest failure after an update is a column the database
 * doesn't have yet.
 */
function calendarProblem(error: { code?: string; message: string }): string {
  if (["PGRST204", "PGRST205", "42703", "42P01"].includes(error.code ?? "")) {
    return "The calendar's database is behind this page — run the calendar's schema.sql again.";
  }
  if (error.message.includes("calendar_event_interview_job_url_check")) {
    return "The job link has to start with http:// or https://.";
  }
  if (error.code === "23514") {
    return "The calendar doesn't know that outcome yet — run the calendar's schema.sql again.";
  }
  if (error.code === "23503") return "That calendar, application or candidate isn't there any more. Reload and try again.";
  if (error.code === "42501") return "Only subadmins and the super admin can book interviews on the calendar.";
  return error.message;
}

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
  if (error) return calendarProblem(error);
  if (!(data as unknown[] | null)?.length) return "Only the event's creator or the super admin can mark it.";
  return null;
}

/** What the Interviews page's form books: an event, and what it is for. */
export type InterviewInput = {
  calendarId: string;
  title: string;
  /** ISO instants. */
  startsAt: string;
  endsAt: string;
  company: string;
  role: string;
  profileId: string | null;
  jobUrl: string | null;
  location: string | null;
  notes: string | null;
  applicationId: string | null;
  outcome: InterviewOutcome;
};

/**
 * Books an interview on the calendar, or changes one. The calendar's own
 * policies decide: anyone who can use the calendar books, as themselves
 * (created_by defaults to the caller), and only the event's creator or the
 * super admin changes it. Like markInterview, through the browser's client
 * with the table cast — the calendar's tables aren't in this app's types.
 */
export async function saveInterview(input: InterviewInput, eventId?: string): Promise<string | null> {
  const row = {
    calendar_id: input.calendarId,
    title: input.title,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    all_day: false,
    location: input.location,
    description: input.notes,
    application_id: input.applicationId,
    interview_outcome: input.outcome,
    interview_company: input.company,
    interview_role: input.role,
    interview_profile_id: input.profileId,
    interview_job_url: input.jobUrl,
  };
  const events = createClient().from("calendar_event" as never);
  const { data, error } = eventId
    ? await events.update(row as never).eq("id", eventId).select("id")
    : await events.insert(row as never).select("id");
  if (error) return calendarProblem(error);
  if (!(data as unknown[] | null)?.length) return "Only the event's creator or the super admin can change it.";
  return null;
}

/**
 * Deletes an interview's event; the calendar's policy decides who may — its
 * creator, or the super admin.
 *
 * One with files attached is left to the calendar, whose delete removes the
 * stored files too. Deleted from here they would stay in storage with
 * nothing pointing at them.
 */
export async function deleteInterview(eventId: string): Promise<string | null> {
  const supabase = createClient();
  const { data: files } = await supabase
    .from("calendar_event_attachment" as never)
    .select("id")
    .eq("event_id", eventId)
    .limit(1);
  if ((files as unknown[] | null)?.length) {
    return "It has files attached on the calendar — delete it there, so they go with it.";
  }
  const { data, error } = await supabase.from("calendar_event" as never).delete().eq("id", eventId).select("id");
  if (error) return calendarProblem(error);
  if (!(data as unknown[] | null)?.length) return "Only the event's creator or the super admin can delete it.";
  return null;
}

/** An application an interview can be linked to, as the form offers it. */
export type ApplicationChoice = {
  id: string;
  /** "A007" or "A007-2". */
  number: string;
  title: string;
  company: string;
  jobUrl: string;
  profileId: string | null;
  candidate: string | null;
};

type ApplicationBits = {
  id: string;
  no: number;
  no_part: number;
  title: string;
  company: string;
  job_url: string;
  profile_id: string | null;
  profile: { full_name: string } | null;
};

/**
 * Applications to link an interview to, newest first — by number ("A007",
 * "a7", "7", "A007-2"), or by company or role; the calendar's picker searches
 * the same way. Read under this person's own policies, so it offers exactly
 * the applications they can see.
 */
export async function findApplications(text: string): Promise<ApplicationChoice[]> {
  const raw = text.trim().slice(0, 80);
  const number = parseRecordNo(raw);
  const q = raw.replace(/[%,()]/g, " ");

  let query = createClient()
    .from("application")
    .select("id, no, no_part, title, company, job_url, profile_id, profile:candidate_profile(full_name)")
    .order("applied_at", { ascending: false })
    .limit(20);
  if (number) {
    query = query.eq("no", number.no);
    if (number.part) query = query.eq("no_part", number.part);
  } else if (q) query = query.or(`company.ilike.%${q}%,title.ilike.%${q}%`);

  const { data } = await query;
  return ((data ?? []) as unknown as ApplicationBits[]).map((a) => ({
    id: a.id,
    number: applicationNo(a.no, a.no_part),
    title: a.title,
    company: a.company,
    jobUrl: a.job_url,
    profileId: a.profile_id,
    candidate: a.profile?.full_name ?? null,
  }));
}
