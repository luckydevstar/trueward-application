import "server-only";

import { DEFAULT_MODEL, DEFAULT_REASONING } from "@/lib/ai/defaults";
import { COMPANY_RESEARCH_PROMPT, DEFAULT_SYSTEM_PROMPT } from "@/lib/ai/resume-prompt";
import { createAdminClient } from "@/lib/supabase/admin";

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
    // `*` and the kind checked here, not in the query: a database that hasn't
    // run part 1 since the research library arrived has no `kind` column, and
    // filtering on it would fail the read and silently swap in the built-in.
    const { data } = await admin
      .from("generation_prompt")
      .select("*")
      .eq("id", settings.active_prompt_id)
      .maybeSingle();
    if (data?.body.trim() && (data.kind ?? "resume") === "resume") {
      prompt = { id: data.id, name: data.name, body: data.body };
    }
  }

  return {
    model: settings?.model?.trim() || DEFAULT_MODEL,
    reasoning: settings?.reasoning || DEFAULT_REASONING,
    prompt,
  };
}

/**
 * The company research prompt profile adders copy beside the Company context
 * field: the super admin's active one, or the built-in.
 *
 * Read with the service role, like the base prompt: the library is the super
 * admin's, and only this one prompt — the one a subadmin needs to copy — goes
 * to the browser. Falls back to the built-in when generation isn't set up or
 * the schema hasn't been run yet, so the profile form always has one.
 */
export async function loadResearchPrompt(): Promise<{ name: string; body: string }> {
  const builtIn = { name: BUILT_IN_PROMPT_NAME, body: COMPANY_RESEARCH_PROMPT };
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return builtIn;
  }

  const { data: settings } = await admin
    .from("generation_setting")
    .select("active_research_prompt_id")
    .maybeSingle();
  if (!settings?.active_research_prompt_id) return builtIn;

  const { data } = await admin
    .from("generation_prompt")
    .select("name, body")
    .eq("id", settings.active_research_prompt_id)
    .eq("kind", "research")
    .maybeSingle();
  return data?.body.trim() ? data : builtIn;
}
