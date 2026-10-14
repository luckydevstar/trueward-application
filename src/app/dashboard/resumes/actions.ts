"use server";

import { requireActor } from "@/lib/actor";
import { generateContent, logRow } from "@/lib/ai/generate";
import { openRouterConfigured } from "@/lib/ai/openrouter";
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

const MAX_BASE_PROMPT = 50_000;
const MAX_ADDITIONAL_PROMPT = 30_000;

/**
 * Writes a resume's content from exactly what the person supplied: the
 * selected profile, their resume base prompt, and their additional prompt
 * (the job description and anything else). The app adds only the response
 * contract, and the platform's model and reasoning setting.
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
  basePrompt: string;
  additionalPrompt: string;
}): Promise<GenerateResult> {
  const actor = await requireActor();

  if (!openRouterConfigured()) {
    return { ok: false, error: "Generation is off: OPENROUTER_API_KEY is not set." };
  }

  const basePrompt = input.basePrompt.trim();
  const additionalPrompt = input.additionalPrompt.trim();
  if (!basePrompt) return { ok: false, error: "Enter the resume base prompt first." };
  if (!additionalPrompt) {
    return { ok: false, error: "Enter the additional prompt — the job description and anything else." };
  }
  if (basePrompt.length > MAX_BASE_PROMPT) return { ok: false, error: "The base prompt is too long." };
  if (additionalPrompt.length > MAX_ADDITIONAL_PROMPT) {
    return { ok: false, error: "The additional prompt is too long — trim the job description to the posting itself." };
  }

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("candidate_profile")
    .select("id, team_id, profile")
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
    .eq("source", "builder")
    .gte("created_at", since);
  if ((count ?? 0) >= HOURLY_LIMIT) {
    return {
      ok: false,
      error: `That's ${HOURLY_LIMIT} generations in the last hour — the limit. Try again shortly.`,
    };
  }

  const { data: settings } = await admin
    .from("generation_setting")
    .select("model, reasoning")
    .maybeSingle();
  const model = settings?.model?.trim() || "anthropic/claude-sonnet-5.5";
  const reasoning = settings?.reasoning ?? "lowest";

  const outcome = await generateContent({
    profile: profile.data,
    model,
    systemPrompt: basePrompt,
    additionalPrompt,
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
    prompt_label: null,
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
