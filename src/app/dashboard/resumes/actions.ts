"use server";

import { after } from "next/server";

import { requireActor } from "@/lib/actor";
import { JOB_STALE_MS, MAX_RUNNING_JOBS } from "@/lib/ai/defaults";
import { generateContent, logRow } from "@/lib/ai/generate";
import {
  answerQuestion,
  generationsLastHour,
  HOURLY_LIMIT,
  MAX_JOB_DESCRIPTION,
  NOT_ASSIGNED,
  trackApplication,
  worksProfile,
  type FollowUpResult,
  type RecordResult,
} from "@/lib/jobs/work";
import { runResumeJob } from "@/lib/ai/jobs";
import { openRouterConfigured } from "@/lib/ai/openrouter";
import { loadGenerationConfig } from "@/lib/ai/settings";
import { profileSchema } from "@/lib/document/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ResumeJobRow } from "@/lib/supabase/types";


export type GenerateResult =
  | {
      ok: true;
      /** The content JSON, pretty-printed for the editor. */
      content: string;
      /** False when the answer still fails validation after one repair. */
      valid: boolean;
      model: string;
      attempts: number;
      tokens: number | null;
      costUsd: number | null;
      latencyMs: number;
    }
  | { ok: false; error: string };


/**
 * Writes a resume's content for the selected profile and a job description.
 *
 * Everything else is the super admin's: the active base prompt, the model and
 * the reasoning setting, read on the server. The person generating supplies
 * the profile — its employments, education and company context — and the job,
 * and never needs to see what's underneath.
 *
 * The profile is read through the caller's own client, so RLS decides whether
 * they may use it — a bidder gets only their assigned profiles, exactly as on
 * the page. The settings and the log go through the service role: the log is
 * not the caller's to write.
 *
 * Nothing is saved here. The content goes into the editor, where the person
 * reviews it, and Save is the same as for pasted JSON.
 */
export async function generateResumeContent(input: {
  profileId: string;
  jobDescription: string;
}): Promise<GenerateResult> {
  const actor = await requireActor();

  if (!openRouterConfigured()) {
    return { ok: false, error: "Generation is off: OPENROUTER_API_KEY is not set." };
  }

  const jobDescription = input.jobDescription.trim();
  if (!jobDescription) return { ok: false, error: "Paste the job description first." };
  if (jobDescription.length > MAX_JOB_DESCRIPTION) {
    return { ok: false, error: "That job description is too long — trim it to the posting itself." };
  }

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("candidate_profile")
    .select("id, team_id, profile, company_context")
    .eq("id", input.profileId)
    .maybeSingle();
  if (!row) return { ok: false, error: "Profile not found." };
  if (!(await worksProfile(supabase, actor, row.id))) return { ok: false, error: NOT_ASSIGNED };

  const profile = profileSchema.safeParse(row.profile);
  if (!profile.success) {
    return { ok: false, error: "This profile doesn't satisfy the schema; fix it on the Profiles page first." };
  }

  const admin = createAdminClient();

  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await admin
    .from("resume_generation")
    .select("id", { count: "exact", head: true })
    .eq("created_by", actor.id)
    .in("source", ["builder", "followup"])
    .gte("created_at", since);
  if ((count ?? 0) >= HOURLY_LIMIT) {
    return {
      ok: false,
      error: `That's ${HOURLY_LIMIT} generations in the last hour — the limit. Try again shortly.`,
    };
  }

  const config = await loadGenerationConfig(admin);
  const { model, reasoning } = config;

  const outcome = await generateContent({
    profile: profile.data,
    model,
    systemPrompt: config.prompt.body,
    companyContext: row.company_context,
    jobDescription,
    reasoning,
  });

  await admin.from("resume_generation").insert({
    ...logRow(outcome),
    profile_id: row.id,
    team_id: row.team_id,
    created_by: actor.id,
    model,
    source: "builder",
    run_id: null,
    reasoning,
    prompt_label: config.prompt.name,
    output: null,
  });

  if (outcome.error && outcome.content === null) return { ok: false, error: outcome.error };

  return {
    ok: true,
    content: JSON.stringify(outcome.content, null, 2),
    valid: outcome.valid,
    model: outcome.servedModel,
    attempts: outcome.attempts,
    tokens: outcome.promptTokens + outcome.completionTokens || null,
    costUsd: outcome.costUsd,
    latencyMs: outcome.latencyMs,
  };
}

export type StartJobResult = { ok: true; job: ResumeJobRow } | { ok: false; error: string };

/**
 * Starts a generation in the background and returns at once with its row.
 *
 * The row is inserted through the caller's own client, so the policies decide
 * whether they may work this profile — exactly as for a resume or an
 * application. The model call happens in `after()`, once the response has
 * gone, bounded by the page's maxDuration; the builder polls the row.
 *
 * Several may run at once, up to MAX_RUNNING_JOBS per person. The hourly limit
 * counts finished generations, so a burst can overshoot it by at most that
 * many.
 */
export async function startResumeJob(input: {
  profileId: string;
  jobDescription: string;
  company?: string;
  jobTitle?: string;
  jobUrl?: string;
}): Promise<StartJobResult> {
  const actor = await requireActor();
  if (!openRouterConfigured()) {
    return { ok: false, error: "Generation is off: OPENROUTER_API_KEY is not set." };
  }

  const jobDescription = input.jobDescription.trim();
  if (!jobDescription) return { ok: false, error: "Paste the job description first." };
  if (jobDescription.length > MAX_JOB_DESCRIPTION) {
    return { ok: false, error: "That job description is too long — trim it to the posting itself." };
  }
  const jobUrl = input.jobUrl?.trim() || null;
  if (jobUrl && !/^https?:\/\//i.test(jobUrl)) {
    return { ok: false, error: "The job URL should start with http:// or https://." };
  }

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("candidate_profile")
    .select("id, team_id, profile")
    .eq("id", input.profileId)
    .maybeSingle();
  if (!row) return { ok: false, error: "Profile not found." };
  if (!(await worksProfile(supabase, actor, row.id))) return { ok: false, error: NOT_ASSIGNED };
  if (!profileSchema.safeParse(row.profile).success) {
    return { ok: false, error: "This profile doesn't satisfy the schema; fix it on the Profiles page first." };
  }

  const staleBefore = new Date(Date.now() - JOB_STALE_MS).toISOString();
  const [lastHour, { data: runningJobs }] = await Promise.all([
    generationsLastHour(actor.id),
    supabase
      .from("resume_job")
      .select("started_at, created_at")
      .eq("created_by", actor.id)
      .eq("status", "running"),
  ]);
  // Counted from when each started: a batch job may have waited its turn.
  const running = (runningJobs ?? []).filter((j) => (j.started_at ?? j.created_at) > staleBefore).length;
  if (lastHour >= HOURLY_LIMIT) {
    return { ok: false, error: `That's ${HOURLY_LIMIT} generations in the last hour — the limit. Try again shortly.` };
  }
  if (running >= MAX_RUNNING_JOBS) {
    return { ok: false, error: `${MAX_RUNNING_JOBS} resumes are already generating. Start the next when one finishes.` };
  }

  const { data: job, error } = await supabase
    .from("resume_job")
    .insert({
      profile_id: row.id,
      team_id: row.team_id,
      created_by: actor.id,
      job_description: jobDescription,
      company: input.company?.trim() || null,
      job_title: input.jobTitle?.trim() || null,
      job_url: jobUrl,
      started_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error || !job) {
    return { ok: false, error: error?.message ?? "The generation couldn't be started." };
  }

  after(() => runResumeJob(job.id));
  return { ok: true, job };
}

export type { RecordResult } from "@/lib/jobs/work";

/**
 * Tracks the application a downloaded resume is for, the same row the
 * Applications grid records. See trackApplication() for the rules.
 */
export async function recordApplication(input: {
  profileId: string;
  title: string;
  company: string;
  jobUrl: string;
}): Promise<RecordResult> {
  return trackApplication(await createClient(), await requireActor(), input);
}

/** Attaches the uploaded PDF to the application it was just recorded for. */
export async function attachApplicationResume(input: {
  applicationId: string;
  key: string;
  url: string;
  name: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireActor();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("application")
    .update({ resume_key: input.key, resume_url: input.url, resume_name: input.name })
    .eq("id", input.applicationId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "The application couldn't be updated." };
  return { ok: true };
}

export type { FollowUpResult } from "@/lib/jobs/work";

/**
 * Answers a question about the generated resume and the job, with the same
 * model and reasoning setting as generation. See answerQuestion().
 */
export async function askFollowUp(input: {
  profileId: string;
  jobDescription: string;
  resume: string;
  question: string;
  /** Earlier questions and answers in this session, oldest first. */
  history: Array<{ question: string; answer: string }>;
}): Promise<FollowUpResult> {
  return answerQuestion(await createClient(), await requireActor(), input);
}
