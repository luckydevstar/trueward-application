"use server";

import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import { createClient } from "@/lib/supabase/server";

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

/** Which library prompt every Generate uses; null for the built-in default. */
export async function setActivePrompt(promptId: string | null): Promise<SaveResult> {
  const actor = await superAdmin();
  if (!actor) return { ok: false, error: "Only the super admin chooses the active prompt." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("generation_setting")
    .update({
      active_prompt_id: promptId,
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
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await superAdmin();
  if (!actor) return { ok: false, error: "Only the super admin manages base prompts." };

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
        .insert({ name, body, created_by: actor.id })
        .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "That prompt could not be saved." };
  refresh();
  return { ok: true, id: data[0].id };
}

/** Deleting the active prompt falls back to the built-in (on delete set null). */
export async function deletePrompt(id: string): Promise<SaveResult> {
  const actor = await superAdmin();
  if (!actor) return { ok: false, error: "Only the super admin manages base prompts." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("generation_prompt").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "That prompt no longer exists." };
  refresh();
  return { ok: true };
}
