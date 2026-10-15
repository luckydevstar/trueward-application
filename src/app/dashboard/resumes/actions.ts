"use server";

import { requireActor } from "@/lib/actor";
import { generateContent, logRow } from "@/lib/ai/generate";
import { modelCatalog, reasoningParam } from "@/lib/ai/models";
import { completeText, openRouterConfigured } from "@/lib/ai/openrouter";
import { loadGenerationConfig } from "@/lib/ai/settings";
import { teamIdFor } from "@/lib/scope";
import { normalizeCompany } from "@/lib/status";
import { profileSchema } from "@/lib/document/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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
 * Generations per person per hour. A guard against a runaway loop or a
 * borrowed session spending the OpenRouter balance, set well above what one
 * person working by hand produces.
 */
const HOURLY_LIMIT = Number(process.env.GENERATION_HOURLY_LIMIT ?? 60);

const MAX_JOB_DESCRIPTION = 30_000;

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

export type RecordResult =
  | { ok: true; id: string }
  | { ok: false; error: string; reason: "blocked" | "cooldown" | "other" };

/**
 * Tracks the application a downloaded resume is for, the same row the
 * Applications grid records.
 *
 * Through the caller's own client, so the policies decide: a bidder may record
 * only for an assigned profile, and only into their own team. The duplicate
 * cooldown is the database's trigger, and its refusal is returned as a reason
 * so the page can say why and offer the download alone. The blocklist is
 * checked here because the grid only warns about it.
 */
export async function recordApplication(input: {
  profileId: string;
  title: string;
  company: string;
  jobUrl: string;
}): Promise<RecordResult> {
  const actor = await requireActor();
  const teamId = teamIdFor(actor);
  if (!teamId) {
    return { ok: false, reason: "other", error: "Your account can't record applications." };
  }

  const title = input.title.trim();
  const company = input.company.trim();
  const jobUrl = input.jobUrl.trim();
  if (!title || !company || !jobUrl) {
    return { ok: false, reason: "other", error: "Job title, company and job URL are all needed to track it." };
  }
  if (!/^https?:\/\//i.test(jobUrl)) {
    return { ok: false, reason: "other", error: "The job URL should start with http:// or https://." };
  }

  const supabase = await createClient();
  const { data: blocked } = await supabase
    .from("blocked_company")
    .select("name")
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
export async function askFollowUp(input: {
  profileId: string;
  jobDescription: string;
  resume: string;
  question: string;
  /** Earlier questions and answers in this session, oldest first. */
  history: Array<{ question: string; answer: string }>;
}): Promise<FollowUpResult> {
  const actor = await requireActor();
  if (!openRouterConfigured()) return { ok: false, error: "Generation is off." };

  const question = input.question.trim();
  if (!question) return { ok: false, error: "Type a question first." };
  if (question.length > 4000) return { ok: false, error: "That question is too long." };
  if (input.jobDescription.length > MAX_JOB_DESCRIPTION || input.resume.length > 60_000) {
    return { ok: false, error: "The job description or resume is too long." };
  }

  // The profile through RLS: you may only ask about a candidate you may use.
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("candidate_profile")
    .select("id, team_id")
    .eq("id", input.profileId)
    .maybeSingle();
  if (!row) return { ok: false, error: "Profile not found." };

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
