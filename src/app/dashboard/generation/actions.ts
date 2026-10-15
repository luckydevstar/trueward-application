"use server";

import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import { createClient } from "@/lib/supabase/server";
import type { PromptKind } from "@/lib/supabase/types";

export type SaveResult = { ok: true } | { ok: false; error: string };

/** An OpenRouter model id: `vendor/model`, optionally with a `:variant`. */
const MODEL_ID = /^[a-z0-9][\w.-]*\/[\w.:-]+$/i;

/** See reasoningParam() in src/lib/ai/models.ts for what each one sends. */
const REASONING_SETTINGS = ["default", "lowest", "low", "medium", "high"];

const MAX_PROMPT = 50_000;

/*
 * Everything here runs through the caller's own client, so the policies decide:
 * only the super admin may change the settings row or the prompt library, and
 * the checks below exist to say so in a sentence rather than as a refused row.
 */

async function superAdmin() {
  const actor = await requireActor();
  return actor.role === "super_admin" ? actor : null;
}

const refresh = () => {
  revalidatePath("/dashboard/generation");
  revalidatePath("/dashboard/generation/lab");
};

/** The model and reasoning every Generate uses. */
export async function saveGenerationSettings(input: {
  model: string;
  reasoning: string;
}): Promise<SaveResult> {
  const actor = await superAdmin();
  if (!actor) return { ok: false, error: "Only the super admin changes generation settings." };

  const model = input.model.trim();
  if (!MODEL_ID.test(model)) {
    return { ok: false, error: "That doesn't look like an OpenRouter model id, e.g. openai/gpt-6-luna." };
  }
  if (!REASONING_SETTINGS.includes(input.reasoning)) {
    return { ok: false, error: "Unknown reasoning setting." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("generation_setting")
    .update({
      model,
      reasoning: input.reasoning,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data?.length) {
    return { ok: false, error: "The settings row is missing — run supabase/schema part 1 again." };
  }
  refresh();
  return { ok: true };
}

/**
 * Which library prompt is in use; null for the built-in default.
 *
 *   resume    the base prompt every Generate uses
 *   research  the company research prompt profile adders copy
 */
export async function setActivePrompt(
  promptId: string | null,
  kind: PromptKind = "resume",
): Promise<SaveResult> {
  const actor = await superAdmin();
  if (!actor) return { ok: false, error: "Only the super admin chooses the active prompt." };

  const supabase = await createClient();

  // A research prompt as the base prompt, or the other way round, would send
  // the wrong instructions. The loaders refuse a mismatch too; this says so.
  if (promptId) {
    // `*` rather than `kind`, so choosing a base prompt still works on a
    // database that hasn't run part 1 since the research library arrived.
    const { data: prompt } = await supabase
      .from("generation_prompt")
      .select("*")
      .eq("id", promptId)
      .maybeSingle();
    if (!prompt) return { ok: false, error: "That prompt no longer exists." };
    if ((prompt.kind ?? "resume") !== kind) {
      return { ok: false, error: "That prompt is in the other library." };
    }
  }

  const { data, error } = await supabase
    .from("generation_setting")
    .update({
      ...(kind === "research" ? { active_research_prompt_id: promptId } : { active_prompt_id: promptId }),
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data?.length) {
    return { ok: false, error: "The settings row is missing — run supabase/schema part 1 again." };
  }
  refresh();
  return { ok: true };
}

export async function savePrompt(input: {
  /** Absent to add a new prompt. */
  id?: string;
  name: string;
  body: string;
  /** Which library a new prompt joins. An existing prompt keeps its own. */
  kind?: PromptKind;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await superAdmin();
  if (!actor) return { ok: false, error: "Only the super admin manages prompts." };

  const name = input.name.trim();
  const body = input.body.trim();
  if (!name) return { ok: false, error: "Give the prompt a name." };
  if (!body) return { ok: false, error: "The prompt is empty." };
  if (body.length > MAX_PROMPT) return { ok: false, error: "The prompt is too long." };

  const supabase = await createClient();
  const { data, error } = input.id
    ? await supabase
        .from("generation_prompt")
        .update({ name, body, updated_at: new Date().toISOString() })
        .eq("id", input.id)
        .select("id")
    : await supabase
        .from("generation_prompt")
        // `kind` only when it isn't the column's default, for the same reason.
        .insert({ name, body, created_by: actor.id, ...(input.kind === "research" ? { kind: "research" as const } : {}) })
        .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "That prompt could not be saved." };
  refresh();
  return { ok: true, id: data[0].id };
}

/** Deleting the active prompt falls back to the built-in (on delete set null). */
export async function deletePrompt(id: string): Promise<SaveResult> {
  const actor = await superAdmin();
  if (!actor) return { ok: false, error: "Only the super admin manages prompts." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("generation_prompt").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "That prompt no longer exists." };
  refresh();
  return { ok: true };
}
