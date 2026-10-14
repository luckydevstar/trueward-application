"use server";

import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import { createClient } from "@/lib/supabase/server";

export type SaveResult = { ok: true } | { ok: false; error: string };

/** An OpenRouter model id: `vendor/model`, optionally with a `:variant`. */
const MODEL_ID = /^[a-z0-9][\w.-]*\/[\w.:-]+$/i;

/** See reasoningParam() in src/lib/ai/models.ts for what each one sends. */
const REASONING_SETTINGS = ["lowest", "low", "medium", "high", "default"] as const;

/**
 * Saves the generation settings.
 *
 * Through the caller's own client, so the policy is what decides: only the
 * super admin may update the row, and only as themselves (updated_by).
 */
export async function saveGenerationSettings(input: {
  systemPrompt: string;
  model: string;
  reasoning: string;
}): Promise<SaveResult> {
  const actor = await requireActor();
  if (actor.role !== "super_admin") {
    return { ok: false, error: "Only the super admin changes generation settings." };
  }

  const model = input.model.trim();
  if (!MODEL_ID.test(model)) {
    return { ok: false, error: "That doesn't look like an OpenRouter model id, e.g. anthropic/claude-sonnet-5.5." };
  }
  if (!(REASONING_SETTINGS as readonly string[]).includes(input.reasoning)) {
    return { ok: false, error: "Unknown reasoning setting." };
  }
  if (input.systemPrompt.length > 50_000) {
    return { ok: false, error: "The system prompt is too long." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("generation_setting")
    .update({
      system_prompt: input.systemPrompt,
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

  revalidatePath("/dashboard/generation");
  return { ok: true };
}
