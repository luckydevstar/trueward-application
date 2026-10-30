import "server-only";

import type { CurrentActor } from "@/lib/actor";
import { modelCatalog, reasoningParam } from "@/lib/ai/models";
import { completeText, openRouterConfigured } from "@/lib/ai/openrouter";
import { loadGenerationConfig } from "@/lib/ai/settings";
import type { Interview } from "@/lib/interviews";
import { HOURLY_LIMIT } from "@/lib/jobs/work";
import { applicationNo, parseRecordNo } from "@/lib/numbers";
import { ROLE_META } from "@/lib/roles";
import { teamIdFor } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Db } from "@/lib/supabase/request";

/*
 * The desktop clock's assistant (trueward-clock): plain questions, and
 * questions about the person's own todos, applications and interviews.
 *
 * The same model and reasoning as the resume builder (generation_setting),
 * through the same OpenRouter key, which never leaves the server. The work
 * data is read with the caller's own client, so RLS decides what the model
 * is shown — exactly what the person could open on the site. The todos live
 * on the desktop and arrive with the question.
 *
 * Everything is sent as context rather than offered as tools: whichever
 * model the super admin picks, it can read text, and not every model can
 * call functions.
 */

const SYSTEM_PROMPT = `You are the assistant in Trueward Clock, a desktop clock, alarm and todo app for people who work in Trueward Guru, a job-application tracker.

Answer plain questions — general knowledge, writing, quick sums, dates — as any helpful assistant would.

For questions about the person's todos, alarms, applications, interviews or calendar, use only the "Your data" message. It is everything you know about their work; it is current as of the time it states. If it doesn't hold the answer, say so plainly rather than guess, and say where they could look (the Applications or Interviews page in Trueward Guru).

Applications are numbered like A007 (A007-2 for a second candidate on the same job). Statuses are applied, viewed, interviewing, offer and rejected. Interview outcomes are scheduled, passed, failed, follow up and cancelled.

Keep answers short and direct: a sentence or two, or a brief list. Use **bold** sparingly and "-" for lists. Write dates and times as the person would read them, in their time zone.`;

/** Applications listed in full; the counts above them cover everything. */
const RECENT_APPLICATIONS = 150;
/** Older applications matched by a word in the question, on top of those. */
const MATCHED_APPLICATIONS = 40;
const PAST_INTERVIEW_DAYS = 60;
const CALENDAR_DAYS = 14;
const MAX_TODOS = 200;

export type AssistantTodo = {
  text: string;
  notes?: string | null;
  /** ISO instant, for one with a time. */
  due?: string | null;
  /** "2026-10-28", for one due on a day with no time. */
  date?: string | null;
  repeat?: string | null;
  alarm?: boolean;
  done?: boolean;
};

export type AssistantInput = {
  question: string;
  history: Array<{ question: string; answer: string }>;
  todos: AssistantTodo[];
  /** The desktop's time zone, e.g. "Asia/Shanghai". */
  timeZone: string | null;
  /** Midnight where the person is, as an ISO instant — "today" is theirs, not the server's. */
  todayStart: string | null;
};

export type AssistantResult = { ok: true; answer: string; model: string } | { ok: false; error: string };

export async function askAssistant(db: Db, actor: CurrentActor, input: AssistantInput): Promise<AssistantResult> {
  if (!openRouterConfigured()) return { ok: false, error: "Generation is off on Trueward Guru, so the assistant is too." };

  const question = input.question.trim();
  if (!question) return { ok: false, error: "Type a question first." };
  if (question.length > 4000) return { ok: false, error: "That question is too long." };

  const admin = createAdminClient();
  const { count } = await admin
    .from("resume_generation")
    .select("id", { count: "exact", head: true })
    .eq("created_by", actor.id)
    .eq("source", "assistant")
    .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
  if ((count ?? 0) >= HOURLY_LIMIT) {
    return { ok: false, error: `That's ${HOURLY_LIMIT} questions in the last hour — the limit. Try again shortly.` };
  }

  const zone = validZone(input.timeZone);
  const [context, config, catalog] = await Promise.all([
    workContext(db, actor, { ...input, question }, zone),
    loadGenerationConfig(admin),
    modelCatalog(),
  ]);
  const started = Date.now();

  type Outcome = {
    ok: boolean;
    error: string | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    cached_tokens: number | null;
    reasoning_tokens: number | null;
    cost_usd: number | null;
  };
  const log = (fields: Outcome) =>
    admin.from("resume_generation").insert({
      profile_id: null,
      // A super admin has no team; the row is filed under their own account,
      // which is how the Usage page names it either way.
      team_id: teamIdFor(actor) ?? actor.id,
      created_by: actor.id,
      model: config.model,
      source: "assistant",
      reasoning: config.reasoning,
      attempts: 1,
      latency_ms: Date.now() - started,
      ...fields,
    });

  try {
    const completion = await completeText({
      model: config.model,
      reasoning: reasoningParam(config.reasoning, catalog.get(config.model)),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: context },
        ...input.history.slice(-6).flatMap((turn) => [
          { role: "user" as const, content: turn.question.slice(0, 4000) },
          { role: "assistant" as const, content: turn.answer.slice(0, 8000) },
        ]),
        { role: "user", content: question },
      ],
    });
    await log({
      prompt_tokens: completion.promptTokens,
      completion_tokens: completion.completionTokens,
      cached_tokens: completion.cachedTokens,
      reasoning_tokens: completion.reasoningTokens,
      cost_usd: completion.costUsd,
      ok: true,
      error: null,
    });
    return { ok: true, answer: completion.content, model: completion.model };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The assistant couldn't answer.";
    await log({
      ok: false,
      error: message,
      prompt_tokens: null,
      completion_tokens: null,
      cached_tokens: null,
      reasoning_tokens: null,
      cost_usd: null,
    });
    return { ok: false, error: message };
  }
}

/* ------------------------------------------------------------- context */

function validZone(zone: string | null): string {
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

function formatter(zone: string) {
  const date = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  // A calendar day ("2026-10-28") names no zone; read it in UTC so no
  // offset can move it to the day before or after.
  const calendarDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
  return {
    date: (ymd: string) => calendarDay.format(new Date(`${ymd}T00:00:00Z`)),
    day: (iso: string) => date.format(new Date(iso)),
    at: (iso: string) => `${date.format(new Date(iso))}, ${time.format(new Date(iso))}`,
  };
}

/** One line, at most `max` characters. */
const clip = (text: string | null | undefined, max: number) => {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

type ApplicationLine = {
  id: string;
  no: number;
  no_part: number;
  title: string;
  company: string;
  status: string;
  applied_at: string;
  archived_at: string | null;
  created_by: string | null;
  profile: { full_name: string } | null;
};

const APPLICATION_FIELDS =
  "id, no, no_part, title, company, status, applied_at, archived_at, created_by, profile:candidate_profile(full_name)";

const STATUSES = ["applied", "viewed", "interviewing", "offer", "rejected"] as const;

/** Words too common to search applications by. */
const STOPWORDS = new Set(
  (
    "the and for are was were what when where which who whom whose how why with from that this these those have has had " +
    "did does doing done can could would should will shall may might must about into onto over under any all some many " +
    "much more most less few not yes our ours your yours mine their them they you she him her his its it's i'm i've " +
    "application applications applied apply status interview interviews interviewing job jobs role position company " +
    "companies today tomorrow yesterday week month year next last this upcoming scheduled offer offers rejected viewed " +
    "todo todos alarm alarms note notes calendar event events show tell give list find there here been being get got"
  ).split(" "),
);

/** What in the question might name a company or a role, or an application number. */
function searchTerms(question: string): { words: string[]; numbers: Array<{ no: number; part: number | null }> } {
  const numbers = [...question.matchAll(/\bA0*(\d{1,9})(?:-(\d{1,3}))?\b/gi)]
    .map((m) => parseRecordNo(m[0]))
    .flatMap((n) => (n ? [{ no: n.no, part: n.part }] : []));
  const words = [
    ...new Set(
      question
        .toLowerCase()
        .split(/[^a-z0-9.&+#-]+/)
        .map((w) => w.replace(/^[.\-]+|[.\-]+$/g, ""))
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^a?\d+(-\d+)?$/.test(w)),
    ),
  ].slice(0, 6);
  return { words, numbers };
}

async function workContext(db: Db, actor: CurrentActor, input: AssistantInput, zone: string): Promise<string> {
  const when = formatter(zone);
  const now = new Date();
  const todayStart =
    input.todayStart && !Number.isNaN(Date.parse(input.todayStart))
      ? new Date(input.todayStart).toISOString()
      : new Date(now.getTime() - 86_400_000).toISOString();
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  const active = () =>
    db.from("application").select("id", { count: "exact", head: true }).is("archived_at", null);

  const terms = searchTerms(input.question);
  const matchQuery = () => {
    if (!terms.words.length && !terms.numbers.length) return null;
    const ors = [
      ...terms.words.map((w) => {
        const safe = w.replace(/[%,()*]/g, "");
        return `company.ilike.%${safe}%,title.ilike.%${safe}%`;
      }),
      ...terms.numbers.map((n) => (n.part ? `and(no.eq.${n.no},no_part.eq.${n.part})` : `no.eq.${n.no}`)),
    ];
    return db
      .from("application")
      .select(APPLICATION_FIELDS)
      .or(ors.join(","))
      .order("applied_at", { ascending: false })
      .limit(MATCHED_APPLICATIONS);
  };

  const [statusCounts, archived, sinceToday, since7, since30, recent, matched, people, interviewsResult, calendar] =
    await Promise.all([
      Promise.all(STATUSES.map((s) => active().eq("status", s))),
      db.from("application").select("id", { count: "exact", head: true }).not("archived_at", "is", null),
      active().gte("applied_at", todayStart),
      active().gte("applied_at", daysAgo(7)),
      active().gte("applied_at", daysAgo(30)),
      db
        .from("application")
        .select(APPLICATION_FIELDS)
        .is("archived_at", null)
        .order("applied_at", { ascending: false })
        .limit(RECENT_APPLICATIONS),
      matchQuery() ?? Promise.resolve({ data: [] }),
      db.from("app_user").select("id, name, email"),
      // Empty, not an error, until the calendar's schema has been run.
      db.rpc("application_interviews" as never),
      // Not in this app's types; RLS returns nothing to a bidder.
      db
        .from("calendar_event" as never)
        .select("title, starts_at, ends_at, all_day, location, rrule, calendar:calendar_source(name)")
        .is("interview_outcome" as never, null)
        .is("recurrence_id" as never, null)
        .or(
          `and(rrule.is.null,ends_at.gte.${todayStart},starts_at.lt.${new Date(now.getTime() + CALENDAR_DAYS * 86_400_000).toISOString()}),rrule.not.is.null`,
        )
        .order("starts_at" as never)
        .limit(80),
    ]);

  const nameOf = new Map((people.data ?? []).map((u) => [u.id, u.name ?? u.email]));
  const applicationLine = (a: ApplicationLine) =>
    [
      applicationNo(a.no, a.no_part),
      when.day(a.applied_at),
      `${clip(a.company, 60)} — ${clip(a.title, 80)}`,
      a.status,
      a.profile?.full_name ? `candidate ${a.profile.full_name}` : null,
      a.created_by && a.created_by !== actor.id ? `by ${nameOf.get(a.created_by) ?? "someone else"}` : null,
      a.archived_at ? "archived" : null,
    ]
      .filter(Boolean)
      .join(" · ");

  const lines: string[] = ["# Your data", ""];

  lines.push(
    "## Now",
    `${when.at(now.toISOString())} (${zone})`,
    "",
    "## You",
    `${actor.name ?? actor.email} (${actor.email}), ${ROLE_META[actor.role].label}. You see what Trueward Guru shows you${
      actor.role === "bidder" ? ": the applications for the profiles assigned to you" : actor.role === "subadmin" ? ": your team's work" : ": every team's work"
    }.`,
    "",
  );

  // Todos — from the desktop, as sent.
  const todos = input.todos.slice(0, MAX_TODOS);
  lines.push("## Todos and alarms (from Trueward Clock)");
  if (!todos.length) lines.push("None.");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(now);
  for (const t of todos) {
    const due = t.due && !Number.isNaN(Date.parse(t.due)) ? t.due : null;
    const day = !due && t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null;
    lines.push(
      [
        `- [${t.done ? "x" : " "}] ${clip(t.text, 200) || "(untitled)"}`,
        due
          ? `${t.alarm ? "alarm" : "due"} ${when.at(due)}`
          : day
            ? `due ${when.date(day)}, no time`
            : "no day or time set",
        t.repeat && t.repeat !== "none" ? `repeats ${t.repeat}` : null,
        !t.done && ((due && Date.parse(due) < now.getTime()) || (day && day < today)) ? "overdue" : null,
        t.notes ? `notes: ${clip(t.notes, 300)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }
  lines.push("");

  // Applications.
  const counts = statusCounts.map((r, i) => `${STATUSES[i]} ${r.count ?? 0}`);
  const total = statusCounts.reduce((sum, r) => sum + (r.count ?? 0), 0);
  lines.push(
    "## Applications",
    `Active: ${total} (${counts.join(", ")}). Archived: ${archived.count ?? 0}.`,
    `Applied today: ${sinceToday.count ?? 0}; last 7 days: ${since7.count ?? 0}; last 30 days: ${since30.count ?? 0}.`,
    "",
  );
  const recentRows = (recent.data ?? []) as unknown as ApplicationLine[];
  const recentIds = new Set(recentRows.map((a) => a.id));
  const matchedRows = ((matched.data ?? []) as unknown as ApplicationLine[]).filter((a) => !recentIds.has(a.id));
  if (matchedRows.length) {
    lines.push(`### Matching words in the question (${terms.words.join(", ") || "numbers"})`);
    for (const a of matchedRows) lines.push(`- ${applicationLine(a)}`);
    lines.push("");
  }
  lines.push(
    recentRows.length < total
      ? `### The ${recentRows.length} most recent active ones (older ones aren't listed — the counts above cover them)`
      : "### Every active one, newest first",
  );
  if (!recentRows.length) lines.push("None.");
  for (const a of recentRows) lines.push(`- ${applicationLine(a)}`);
  lines.push("");

  // Interviews.
  const interviews = ((interviewsResult.data ?? []) as Interview[]).filter(
    (i) => Date.parse(i.starts_at) >= now.getTime() - PAST_INTERVIEW_DAYS * 86_400_000,
  );
  const linkedIds = [...new Set(interviews.flatMap((i) => (i.application_id ? [i.application_id] : [])))];
  const ownProfiles = [
    ...new Set(interviews.flatMap((i) => (!i.application_id && i.interview_profile_id ? [i.interview_profile_id] : []))),
  ];
  const [{ data: linked }, { data: profiles }] = await Promise.all([
    linkedIds.length ? db.from("application").select(APPLICATION_FIELDS).in("id", linkedIds) : { data: [] },
    ownProfiles.length ? db.from("candidate_profile").select("id, full_name").in("id", ownProfiles) : { data: [] },
  ]);
  const applicationById = new Map(((linked ?? []) as unknown as ApplicationLine[]).map((a) => [a.id, a]));
  const profileName = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const interviewLine = (i: Interview) => {
    const a = i.application_id ? applicationById.get(i.application_id) : undefined;
    const what = a
      ? `${clip(a.company, 60)} — ${clip(a.title, 80)} (${applicationNo(a.no, a.no_part)}${a.profile?.full_name ? `, ${a.profile.full_name}` : ""}; application ${a.status})`
      : i.interview_company
        ? `${clip(i.interview_company, 60)} — ${clip(i.interview_role, 80)}${
            i.interview_profile_id && profileName.get(i.interview_profile_id) ? ` (${profileName.get(i.interview_profile_id)})` : ""
          }`
        : clip(i.title, 120);
    return [
      `- ${i.all_day ? when.day(i.starts_at) : when.at(i.starts_at)}`,
      what,
      (i.outcome ?? "scheduled").replace("_", " "),
      i.location ? `at ${clip(i.location, 100)}` : null,
      i.description ? `notes: ${clip(i.description, 200)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const upcoming = interviews.filter((i) => Date.parse(i.ends_at) >= now.getTime());
  const past = interviews.filter((i) => Date.parse(i.ends_at) < now.getTime()).reverse();
  lines.push("## Interviews", "### Upcoming");
  if (!upcoming.length) lines.push("None.");
  for (const i of upcoming.slice(0, 60)) lines.push(interviewLine(i));
  lines.push(`### Past ${PAST_INTERVIEW_DAYS} days, newest first`);
  if (!past.length) lines.push("None.");
  for (const i of past.slice(0, 60)) lines.push(interviewLine(i));
  lines.push("");

  // Other calendar events — only the calendar's users get any.
  type CalendarLine = {
    title: string;
    starts_at: string;
    all_day: boolean;
    location: string | null;
    rrule: string | null;
    calendar: { name: string } | null;
  };
  const events = (calendar.data ?? []) as unknown as CalendarLine[];
  if (events.length) {
    lines.push(`## Other calendar events (next ${CALENDAR_DAYS} days, and repeating ones)`);
    for (const e of events) {
      lines.push(
        [
          `- ${e.all_day ? when.day(e.starts_at) : when.at(e.starts_at)}`,
          clip(e.title, 120) || "(untitled)",
          e.calendar?.name ? `calendar ${e.calendar.name}` : null,
          e.rrule ? `repeats ${e.rrule} from that date` : null,
          e.location ? `at ${clip(e.location, 100)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
    }
  }

  return lines.join("\n");
}
