import "server-only";

import { DEFAULT_MODEL, DEFAULT_REASONING } from "@/lib/ai/defaults";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/ai/resume-prompt";
import type { createAdminClient } from "@/lib/supabase/admin";

export type GenerationConfig = {
  model: string;
  reasoning: string;
  /** The active base prompt; id null means the built-in default. */
  prompt: { id: string | null; name: string; body: string };
};

export const BUILT_IN_PROMPT_NAME = "Built-in default";

/**
 * The model, reasoning and active base prompt every Generate uses.
 *
 * Read with the service role: the settings row and the prompt library are the
 * super admin's, and the people generating don't see either — they pick a
 * profile and paste a job. Falls back to the built-in values when the tables
 * are empty or missing, so generation keeps working before the schema is run.
 */
export async function loadGenerationConfig(
  admin: ReturnType<typeof createAdminClient>,
): Promise<GenerationConfig> {
  const { data: settings } = await admin
    .from("generation_setting")
    .select("model, reasoning, active_prompt_id")
    .maybeSingle();

  let prompt: GenerationConfig["prompt"] = {
    id: null,
    name: BUILT_IN_PROMPT_NAME,
    body: DEFAULT_SYSTEM_PROMPT,
  };
  if (settings?.active_prompt_id) {
    const { data } = await admin
      .from("generation_prompt")
      .select("id, name, body")
      .eq("id", settings.active_prompt_id)
      .maybeSingle();
    if (data?.body.trim()) prompt = data;
  }

  return {
    model: settings?.model?.trim() || DEFAULT_MODEL,
    reasoning: settings?.reasoning || DEFAULT_REASONING,
    prompt,
  };
}
