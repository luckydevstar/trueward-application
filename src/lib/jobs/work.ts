import "server-only";

import { modelCatalog, reasoningParam } from "@/lib/ai/models";
import { completeText, openRouterConfigured } from "@/lib/ai/openrouter";
import { loadGenerationConfig } from "@/lib/ai/settings";
import { assignedProfileIds } from "@/lib/profile-scope";
import type { Actor } from "@/lib/roles";
import { canSelfAssign } from "@/lib/scope";
import { normalizeCompany } from "@/lib/status";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Db } from "@/lib/supabase/request";

/*
 * The work behind the resume builder's actions, shared with the routes the
 * Chrome extension calls: whether someone may work a profile, recording an
 * application, and answering a question about a resume. Each takes the
 * caller's own client — cookie session or extension token — so RLS decides.
 */

/**
 * Generations and follow-ups per person per hour. A guard against a runaway
 * loop or a borrowed session spending the OpenRouter balance, set well above
 * what one person working by hand produces.
 */
export const HOURLY_LIMIT = Number(process.env.GENERATION_HOURLY_LIMIT ?? 60);

export const MAX_JOB_DESCRIPTION = 30_000;

export const NOT_ASSIGNED = "Assign this profile to yourself on the Profiles page to work it.";

/**
 * Whether the actor may work this profile, as opposed to only read it.
 *
 * RLS has already said whether they may read it. That is the whole answer for
 * a subadmin or a bidder; a super admin reads every profile but works only the
 * ones assigned to themselves — the same rule works_in_team() applies to the
 * rows they write.
 */
export async function worksProfile(db: Db, actor: Actor, profileId: string): Promise<boolean> {
  if (!canSelfAssign(actor.role)) return true;
  return (await assignedProfileIds(db, actor.id)).has(profileId);
}

/** Generations and follow-ups this person has made in the last hour. */
export async function generationsLastHour(actorId: string): Promise<number> {
  const { count } = await createAdminClient()
    .from("resume_generation")
    .select("id", { count: "exact", head: true })
    .eq("created_by", actorId)
    .in("source", ["builder", "followup"])
    .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
  return count ?? 0;
}

export type RecordResult =
  | { ok: true; id: string }
  | { ok: false; error: string; reason: "blocked" | "cooldown" | "other" };

/**
 * Tracks the application a downloaded resume is for, the same row the
 * Applications grid records.
 *
 * Through the caller's own client, so the policies decide: a bidder may record
 * only for an assigned profile, and only into their own team; a super admin
 * only for a profile assigned to themselves. The row is filed in the profile's
 * team, which for a subadmin or bidder is their own. The duplicate
 * cooldown is the database's trigger, and its refusal is returned as a reason
 * so the page can say why and offer the download alone. The blocklist is
 * checked here because the grid only warns about it.
 */
export async function trackApplication(
  db: Db,
  actor: Actor,
  input: {
    profileId: string;
    title: string;
    company: string;
    jobUrl: string;
  },
): Promise<RecordResult> {
  const title = input.title.trim();
  const company = input.company.trim();
  const jobUrl = input.jobUrl.trim();
  if (!title || !company || !jobUrl) {
    return { ok: false, reason: "other", error: "Job title, company and job URL are all needed to track it." };
  }
  if (!/^https?:\/\//i.test(jobUrl)) {
    return { ok: false, reason: "other", error: "The job URL should start with http:// or https://." };
  }

  const supabase = db;
  const { data: profile } = await supabase
    .from("candidate_profile")
    .select("id, team_id")
    .eq("id", input.profileId)
    .maybeSingle();
  if (!profile) return { ok: false, reason: "other", error: "Profile not found." };
  if (!(await worksProfile(supabase, actor, profile.id))) {
    return { ok: false, reason: "other", error: NOT_ASSIGNED };
  }
  const teamId = profile.team_id;

  // The profile's team's list. A super admin reads every team's, so without
  // the filter one company blocked by two teams would be two rows here.
  const { data: blocked } = await supabase
    .from("blocked_company")
    .select("name")
    .eq("team_id", teamId)
    .eq("normalized_name", normalizeCompany(company))
    .maybeSingle();
  if (blocked) {
    return { ok: false, reason: "blocked", error: `${blocked.name} is on the blocklist — don't apply there.` };
  }

  const { data, error } = await supabase
    .from("application")
    .insert({
      title,
      company,
      job_url: jobUrl,
      profile_id: input.profileId,
      team_id: teamId,
      created_by: actor.id,
      // The defaults a new grid row starts with. Billing must be "unbilled":
      // only a subadmin may set anything else (enforce_billing_authority).
      status: "applied",
      billing: "unbilled",
      notes: null,
      applied_at: new Date().toISOString(),
      resume_document_id: null,
      resume_key: null,
      resume_url: null,
      resume_name: null,
    })
    .select("id")
    .single();

  if (error || !data) {
    // check_violation is the cooldown trigger; its message already says when
    // the company was last applied to and when it reopens.
    if (error?.code === "23514") return { ok: false, reason: "cooldown", error: error.message };
    return { ok: false, reason: "other", error: error?.message ?? "Couldn't record the application." };
  }
  return { ok: true, id: data.id };
}

/**
 * The instructions for follow-up answers. Fixed rather than a library prompt:
 * it is a narrow job — answer an application question as the candidate, from
 * the resume and the posting — and keeping it short keeps each answer cheap.
 */
const FOLLOW_UP_PROMPT = `You help a job applicant answer questions about one job application — screening questions, short essays, cover-letter paragraphs, interview prep.

Answer as the applicant, in the first person, using the resume and the job description you are given. Draw on what the resume says; do not add employers, credentials or results it doesn't contain. Match the length to the question: a sentence or two for a short field, a few short paragraphs for an essay. Plain text, no preamble, no markdown headings.`;

export type FollowUpResult =
  | { ok: true; answer: string; costUsd: number | null; latencyMs: number }
  | { ok: false; error: string };

/**
 * Answers a question about the generated resume and the job, with the same
 * model and reasoning setting as generation. Logged like a generation
 * (source "followup"), so the Usage page counts what it costs.
 */
export async function answerQuestion(db: Db, actor: Actor, input: {
  profileId: string;
  jobDescription: string;
  resume: string;
  question: string;
  /** Earlier questions and answers in this session, oldest first. */
  history: Array<{ question: string; answer: string }>;
}): Promise<FollowUpResult> {
  if (!openRouterConfigured()) return { ok: false, error: "Generation is off." };

  const question = input.question.trim();
  if (!question) return { ok: false, error: "Type a question first." };
  if (question.length > 4000) return { ok: false, error: "That question is too long." };
  if (input.jobDescription.length > MAX_JOB_DESCRIPTION || input.resume.length > 60_000) {
    return { ok: false, error: "The job description or resume is too long." };
  }

  // The profile through RLS: you may only ask about a candidate you may use.
  const supabase = db;
  const { data: row } = await supabase
    .from("candidate_profile")
    .select("id, team_id")
    .eq("id", input.profileId)
    .maybeSingle();
  if (!row) return { ok: false, error: "Profile not found." };
  if (!(await worksProfile(supabase, actor, row.id))) return { ok: false, error: NOT_ASSIGNED };

  const admin = createAdminClient();
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await admin
    .from("resume_generation")
    .select("id", { count: "exact", head: true })
    .eq("created_by", actor.id)
    .in("source", ["builder", "followup"])
    .gte("created_at", since);
  if ((count ?? 0) >= HOURLY_LIMIT) {
    return { ok: false, error: `That's ${HOURLY_LIMIT} requests in the last hour — the limit. Try again shortly.` };
  }

  const config = await loadGenerationConfig(admin);
  const catalog = await modelCatalog();
  const started = Date.now();

  const context = [
    "## Resume (JSON)",
    input.resume.trim(),
    "",
    "## Job description",
    input.jobDescription.trim() || "(not provided)",
  ].join("\n");

  try {
    const completion = await completeText({
      model: config.model,
      reasoning: reasoningParam(config.reasoning, catalog.get(config.model)),
      messages: [
        { role: "system", content: FOLLOW_UP_PROMPT },
        { role: "user", content: context },
        ...input.history.slice(-6).flatMap((turn) => [
          { role: "user" as const, content: turn.question },
          { role: "assistant" as const, content: turn.answer },
        ]),
        { role: "user", content: question },
      ],
    });
    await admin.from("resume_generation").insert({
      profile_id: row.id,
      team_id: row.team_id,
      created_by: actor.id,
      model: config.model,
      source: "followup",
      reasoning: config.reasoning,
      attempts: 1,
      prompt_tokens: completion.promptTokens,
      completion_tokens: completion.completionTokens,
      cached_tokens: completion.cachedTokens,
      reasoning_tokens: completion.reasoningTokens,
      cost_usd: completion.costUsd,
      latency_ms: Date.now() - started,
      ok: true,
      error: null,
      run_id: null,
      prompt_label: null,
      output: null,
    });
    return { ok: true, answer: completion.content, costUsd: completion.costUsd, latencyMs: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The question couldn't be answered.";
    await admin.from("resume_generation").insert({
      profile_id: row.id,
      team_id: row.team_id,
      created_by: actor.id,
      model: config.model,
      source: "followup",
      reasoning: config.reasoning,
      attempts: 1,
      prompt_tokens: null,
      completion_tokens: null,
      cached_tokens: null,
      reasoning_tokens: null,
      cost_usd: null,
      latency_ms: Date.now() - started,
      ok: false,
      error: message,
      run_id: null,
      prompt_label: null,
      output: null,
    });
    return { ok: false, error: message };
  }
}
