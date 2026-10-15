import "server-only";

import { completeJson, type ChatMessage } from "@/lib/ai/openrouter";
import { modelCatalog, reasoningParam } from "@/lib/ai/models";
import { buildMessages, contentJsonSchema } from "@/lib/ai/resume-prompt";
import {
  fieldErrors,
  resumeDocumentSchema,
  type FieldError,
  type ResumeProfile,
} from "@/lib/document/schema";

/**
 * One generation, start to finish: the builder's Generate button and the
 * model lab both call this, so a model tested in the lab behaves exactly as
 * it will for real.
 *
 * Never throws. Every outcome — including OpenRouter refusing, a timeout, or
 * an answer that never validated — comes back as data, because both callers
 * log every attempt, and a failure is as useful to the averages as a success.
 */
export type GenerationOutcome = {
  /** The parsed answer, or null if none was usable JSON. */
  content: unknown;
  valid: boolean;
  problems: FieldError[];
  /** Set when the call itself failed. */
  error: string | null;
  attempts: number;
  /** The model OpenRouter actually served. */
  servedModel: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costUsd: number | null;
  latencyMs: number;
};

export async function generateContent(input: {
  profile: ResumeProfile;
  model: string;
  /** The base prompt. */
  systemPrompt: string;
  /** The profile's company context, if recorded. */
  companyContext?: string | null;
  /** The job description. */
  jobDescription: string;
  /** "default" | "lowest" | an effort name — see reasoningParam(). */
  reasoning: string;
}): Promise<GenerationOutcome> {
  const started = Date.now();
  const outcome: GenerationOutcome = {
    content: null,
    valid: false,
    problems: [],
    error: null,
    attempts: 0,
    servedModel: input.model,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    costUsd: null,
    latencyMs: 0,
  };

  const catalog = await modelCatalog();
  const reasoning = reasoningParam(input.reasoning, catalog.get(input.model));
  const messages: ChatMessage[] = buildMessages(input);
  const schema = contentJsonSchema(input.profile.employments.map((e) => e.id));

  try {
    /*
     * At most two calls: the answer, and one repair if it fails validation.
     * The repair shows the model its own answer and the exact errors, which
     * fixes the rules a JSON schema can't state (ordering, one paragraph).
     * A third call is rarely better than a person reading the errors.
     */
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      outcome.attempts = attempt;
      const completion = await completeJson({
        model: input.model,
        messages,
        schemaName: "resume_content",
        schema,
        reasoning,
      });
      outcome.servedModel = completion.model;
      outcome.promptTokens += completion.promptTokens ?? 0;
      outcome.completionTokens += completion.completionTokens ?? 0;
      outcome.cachedTokens += completion.cachedTokens ?? 0;
      outcome.reasoningTokens += completion.reasoningTokens ?? 0;
      if (completion.costUsd !== null) {
        outcome.costUsd = (outcome.costUsd ?? 0) + completion.costUsd;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(completion.content);
      } catch {
        outcome.problems = [{ path: "", message: "the reply was not valid JSON" }];
        messages.push(
          { role: "assistant", content: completion.content },
          { role: "user", content: "That was not valid JSON. Reply with the JSON object only." },
        );
        continue;
      }

      outcome.content = parsed;
      const check = resumeDocumentSchema.safeParse({
        schemaVersion: 2,
        profile: input.profile,
        content: parsed,
      });
      if (check.success) {
        outcome.valid = true;
        outcome.problems = [];
        break;
      }

      outcome.problems = fieldErrors(check.error);
      messages.push(
        { role: "assistant", content: completion.content },
        {
          role: "user",
          content:
            "That JSON failed validation:\n" +
            outcome.problems.map((p) => `- ${p.path || "(root)"}: ${p.message}`).join("\n") +
            "\nReturn the corrected JSON object only.",
        },
      );
    }
  } catch (error) {
    outcome.error = error instanceof Error ? error.message : "Generation failed.";
  }

  if (!outcome.error && outcome.content === null) {
    outcome.error = "The model didn't return usable JSON.";
  }
  outcome.latencyMs = Date.now() - started;
  return outcome;
}

/** The row the generation log stores for an outcome. */
export function logRow(outcome: GenerationOutcome) {
  return {
    attempts: outcome.attempts,
    prompt_tokens: outcome.promptTokens || null,
    completion_tokens: outcome.completionTokens || null,
    cached_tokens: outcome.cachedTokens || null,
    reasoning_tokens: outcome.reasoningTokens || null,
    cost_usd: outcome.costUsd,
    latency_ms: outcome.latencyMs,
    ok: outcome.valid && !outcome.error,
    error:
      outcome.error ??
      (outcome.valid
        ? null
        : outcome.problems.map((p) => `${p.path}: ${p.message}`).join("; ").slice(0, 2000)),
  };
}
