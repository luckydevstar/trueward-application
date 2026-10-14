"use server";

import { requireActor } from "@/lib/actor";
import { createClient } from "@/lib/supabase/server";

export type LabRunRow = {
  model: string;
  ok: boolean;
  error: string | null;
  attempts: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  output: unknown;
  profile_id: string | null;
};

/** A past lab run's results, to reopen its side-by-side view. */
export async function loadLabRun(
  runId: string,
): Promise<{ ok: true; rows: LabRunRow[] } | { ok: false; error: string }> {
  const actor = await requireActor();
  if (actor.role !== "super_admin") return { ok: false, error: "The model lab is the super admin's." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("resume_generation")
    .select(
      "model, ok, error, attempts, prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens, cost_usd, latency_ms, output, profile_id",
    )
    .eq("source", "lab")
    .eq("run_id", runId)
    .order("created_at");
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as LabRunRow[] };
}
