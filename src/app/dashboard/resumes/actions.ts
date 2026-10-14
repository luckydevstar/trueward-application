"use server";

import { requireActor } from "@/lib/actor";
import { completeJson, openRouterConfigured, type ChatMessage } from "@/lib/ai/openrouter";
import { buildMessages, contentJsonSchema } from "@/lib/ai/resume-prompt";
import {
  fieldErrors,
  profileSchema,
  resumeDocumentSchema,
  type FieldError,
} from "@/lib/document/schema";
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
const MAX_ADDITIONAL_PROMPT = 4_000;

/**
 * Writes a resume's content for one profile and one job, with the platform's
 * model and system prompt.
 *
 * The profile is read through the caller's own client, so RLS decides whether
 * they may use it — a bidder gets only their assigned profiles, exactly as on
 * the page. Settings and the log go through the service role: the system
 * prompt is not the caller's to read, and the log is not theirs to write.
 *
 * Nothing is saved here. The content goes into the editor, where the person
 * reviews it, and Save is the same as for pasted JSON.
 */
export async function generateResumeContent(input: {
  profileId: string;
  jobDescription: string;
  additionalPrompt: string;
}): Promise<GenerateResult> {
  const actor = await requireActor();

  if (!openRouterConfigured()) {
    return { ok: false, error: "Generation is off: OPENROUTER_API_KEY is not set." };
  }

  const jobDescription = input.jobDescription.trim();
  const additionalPrompt = input.additionalPrompt.trim();
  if (!jobDescription) return { ok: false, error: "Paste the job description first." };
  if (jobDescription.length > MAX_JOB_DESCRIPTION) {
    return { ok: false, error: "That job description is too long — trim it to the posting itself." };
  }
  if (additionalPrompt.length > MAX_ADDITIONAL_PROMPT) {
    return { ok: false, error: "The additional prompt is too long." };
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
    .gte("created_at", since);
  if ((count ?? 0) >= HOURLY_LIMIT) {
    return {
      ok: false,
      error: `That's ${HOURLY_LIMIT} generations in the last hour — the limit. Try again shortly.`,
    };
  }

  const { data: settings } = await admin
    .from("generation_setting")
    .select("system_prompt, model")
    .maybeSingle();
  const model = settings?.model?.trim() || "anthropic/claude-sonnet-5.5";

  const employmentIds = profile.data.employments.map((e) => e.id);
  const messages: ChatMessage[] = buildMessages({
    systemPrompt: settings?.system_prompt ?? "",
    profile: profile.data,
    jobDescription,
    additionalPrompt,
  });
  const schema = contentJsonSchema(employmentIds);

  const started = Date.now();
  let attempts = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let costUsd: number | null = null;
  let modelUsed = model;
  let content: unknown = null;
  let problems: FieldError[] = [];

  const log = (ok: boolean, error: string | null) =>
    admin.from("resume_generation").insert({
      profile_id: row.id,
      team_id: row.team_id,
      created_by: actor.id,
      model,
      attempts,
      prompt_tokens: promptTokens || null,
      completion_tokens: completionTokens || null,
      cost_usd: costUsd,
      latency_ms: Date.now() - started,
      ok,
      error,
    });

  try {
    /*
     * At most two calls: the answer, and one repair if it fails validation.
     * The repair shows the model its own answer and the exact errors, which
     * fixes the rules a JSON schema can't state (ordering, one paragraph).
     * A third call is rarely better than a person reading the errors, which
     * the editor shows.
     */
    for (attempts = 1; attempts <= 2; attempts += 1) {
      const completion = await completeJson({
        model,
        messages,
        schemaName: "resume_content",
        schema,
      });
      modelUsed = completion.model;
      promptTokens += completion.promptTokens ?? 0;
      completionTokens += completion.completionTokens ?? 0;
      if (completion.costUsd !== null) costUsd = (costUsd ?? 0) + completion.costUsd;

      let parsed: unknown;
      try {
        parsed = JSON.parse(completion.content);
      } catch {
        problems = [{ path: "", message: "the reply was not valid JSON" }];
        messages.push(
          { role: "assistant", content: completion.content },
          { role: "user", content: "That was not valid JSON. Reply with the JSON object only." },
        );
        continue;
      }

      content = parsed;
      const check = resumeDocumentSchema.safeParse({
        schemaVersion: 2,
        profile: profile.data,
        content: parsed,
      });
      if (check.success) {
        problems = [];
        break;
      }

      problems = fieldErrors(check.error);
      messages.push(
        { role: "assistant", content: completion.content },
        {
          role: "user",
          content:
            "That JSON failed validation:\n" +
            problems.map((p) => `- ${p.path || "(root)"}: ${p.message}`).join("\n") +
            "\nReturn the corrected JSON object only.",
        },
      );
    }
    attempts = Math.min(attempts, 2);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed.";
    await log(false, message);
    return { ok: false, error: message };
  }

  if (content === null) {
    await log(false, "no parseable JSON");
    return { ok: false, error: "The model didn't return usable JSON. Try again." };
  }

  const valid = problems.length === 0;
  await log(valid, valid ? null : problems.map((p) => `${p.path}: ${p.message}`).join("; ").slice(0, 2000));

  return {
    ok: true,
    content: JSON.stringify(content, null, 2),
    valid,
    model: modelUsed,
    attempts,
    tokens: promptTokens + completionTokens || null,
    costUsd,
    latencyMs: Date.now() - started,
  };
}
