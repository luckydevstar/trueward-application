import { Alert } from "antd";

import { ModelLab, type LabHistoryRow } from "@/components/model-lab";
import { requireActor } from "@/lib/actor";
import { DEFAULT_MODEL, DEFAULT_REASONING } from "@/lib/ai/defaults";
import { modelCatalog } from "@/lib/ai/models";
import { openRouterConfigured } from "@/lib/ai/openrouter";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/ai/resume-prompt";
import { profileSchema } from "@/lib/document/schema";
import { fetchAll } from "@/lib/fetch-all";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Model lab · Application" };

/**
 * The model lab: one profile and one job, several models side by side, and
 * what each cost. Temporary scaffolding for choosing a model — it shares the
 * builder's generation code, so what it measures is what production does.
 *
 * Its runs are logged with source = 'lab', apart from real resumes, so they
 * neither inflate the Generation page's averages nor count against anyone's
 * hourly limit.
 */

/** Start of the history window. Out of the component: it reads the clock. */
function windowStart(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * The OpenRouter balance, best effort: shown so a run's cost can be read
 * against what's left. Not cached — it changes with every run.
 */
async function openRouterCredit(): Promise<{ total: number; used: number } | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    const { data } = (await response.json()) as {
      data?: { total_credits?: number; total_usage?: number };
    };
    if (typeof data?.total_credits !== "number") return null;
    return { total: data.total_credits, used: data.total_usage ?? 0 };
  } catch {
    return null;
  }
}

export default async function ModelLabPage() {
  const actor = await requireActor();
  if (actor.role !== "super_admin") {
    return (
      <Alert type="warning" showIcon title="Not available" description="The model lab is the super admin's." />
    );
  }

  const supabase = await createClient();
  const [profiles, settings, prompts, catalog, history, credit] = await Promise.all([
    supabase.from("candidate_profile").select("id, full_name, profile").order("full_name"),
    supabase.from("generation_setting").select("model, reasoning, active_prompt_id").maybeSingle(),
    // Filtered here rather than in the query; see the Generation page.
    supabase.from("generation_prompt").select("*").order("created_at"),
    modelCatalog(),
    fetchAll<LabHistoryRow>((from, to) =>
      supabase
        .from("resume_generation")
        .select(
          "run_id, model, ok, attempts, prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens, cost_usd, latency_ms, prompt_label, reasoning, created_at",
        )
        .eq("source", "lab")
        .gte("created_at", windowStart(30))
        .order("created_at", { ascending: false })
        .range(from, to),
    ),
    openRouterCredit(),
  ]);

  return (
    <ModelLab
      configured={openRouterConfigured()}
      profiles={(profiles.data ?? []).flatMap((p) => {
        const parsed = profileSchema.safeParse(p.profile);
        return parsed.success ? [{ id: p.id, fullName: p.full_name, profile: parsed.data }] : [];
      })}
      models={[...catalog.values()]
        .filter((m) => m.structured)
        .map((m) => ({
          id: m.id,
          price: m.price,
          reasoningMandatory: m.reasoningMandatory,
          efforts: m.efforts,
        }))
        .sort((a, b) => a.id.localeCompare(b.id))}
      builtInPrompt={DEFAULT_SYSTEM_PROMPT}
      prompts={(prompts.data ?? [])
        .filter((p) => (p.kind ?? "resume") === "resume")
        .map((p) => ({ id: p.id, name: p.name, body: p.body }))}
      activePromptId={settings.data?.active_prompt_id ?? null}
      savedModel={settings.data?.model ?? DEFAULT_MODEL}
      savedReasoning={settings.data?.reasoning ?? DEFAULT_REASONING}
      history={history.rows}
      credit={credit}
    />
  );
}
