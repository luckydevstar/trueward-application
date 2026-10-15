import { Alert } from "antd";

import { GenerationSettings, type ModelStats } from "@/components/generation-settings";
import { requireActor } from "@/lib/actor";
import { DEFAULT_MODEL, DEFAULT_REASONING } from "@/lib/ai/defaults";
import { openRouterConfigured } from "@/lib/ai/openrouter";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/ai/resume-prompt";
import { fetchAll } from "@/lib/fetch-all";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Generation · Application" };

/** The window the averages are taken over. */
const DAYS = 30;

type Pricing = { id: string; input: number; output: number };

/** Start of the averaging window. Out of the component: it reads the clock. */
function windowStart(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * OpenRouter's public model list, for the picker and its prices.
 *
 * Cached for an hour — prices move, but not by the minute — and allowed to
 * fail: without it the model field is still free text, just without prices.
 * Only models that support strict structured output are offered, since the
 * builder needs the answer to follow the schema.
 */
async function openRouterModels(): Promise<Pricing[]> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const { data } = (await response.json()) as {
      data: Array<{
        id: string;
        supported_parameters?: string[];
        pricing?: { prompt?: string; completion?: string };
      }>;
    };
    return data
      .filter((m) => m.supported_parameters?.includes("structured_outputs"))
      .filter((m) => !m.id.endsWith(":batch"))
      .map((m) => ({
        id: m.id,
        // Per token in the API; per million is how anyone compares them.
        input: Number(m.pricing?.prompt ?? 0) * 1e6,
        output: Number(m.pricing?.completion ?? 0) * 1e6,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

export default async function GenerationPage() {
  const actor = await requireActor();

  if (actor.role !== "super_admin") {
    return (
      <Alert
        type="warning"
        showIcon
        title="Not available"
        description="Generation settings are the super admin's."
      />
    );
  }

  const supabase = await createClient();
  const since = windowStart(DAYS);

  const [{ data: settings }, { data: prompts }, log, models] = await Promise.all([
    supabase
      .from("generation_setting")
      .select("model, reasoning, active_prompt_id, updated_at")
      .maybeSingle(),
    supabase.from("generation_prompt").select("id, name, body, updated_at").order("created_at"),
    fetchAll<{
      model: string;
      ok: boolean;
      attempts: number;
      prompt_tokens: number | null;
      completion_tokens: number | null;
      cost_usd: number | null;
      latency_ms: number | null;
    }>((from, to) =>
      supabase
        .from("resume_generation")
        .select("model, ok, attempts, prompt_tokens, completion_tokens, cost_usd, latency_ms")
        // Real resumes only; the model lab keeps its own numbers.
        .eq("source", "builder")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .range(from, to),
    ),
    openRouterModels(),
  ]);

  // Averages per model. Cost and tokens only over the rows that report them,
  // so a call OpenRouter didn't price doesn't drag the average to zero.
  const byModel = new Map<string, typeof log.rows>();
  for (const row of log.rows) {
    byModel.set(row.model, [...(byModel.get(row.model) ?? []), row]);
  }
  const mean = (values: Array<number | null>) => {
    const known = values.filter((v): v is number => typeof v === "number");
    return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
  };
  const stats: ModelStats[] = [...byModel.entries()]
    .map(([model, rows]) => ({
      model,
      runs: rows.length,
      validRate: rows.filter((r) => r.ok).length / rows.length,
      repairRate: rows.filter((r) => r.attempts > 1).length / rows.length,
      avgPromptTokens: mean(rows.map((r) => r.prompt_tokens)),
      avgCompletionTokens: mean(rows.map((r) => r.completion_tokens)),
      avgCostUsd: mean(rows.map((r) => (r.cost_usd === null ? null : Number(r.cost_usd)))),
      avgLatencyMs: mean(rows.map((r) => r.latency_ms)),
    }))
    .sort((a, b) => b.runs - a.runs);

  return (
    <GenerationSettings
      builtInPrompt={DEFAULT_SYSTEM_PROMPT}
      prompts={prompts ?? []}
      activePromptId={settings?.active_prompt_id ?? null}
      model={settings?.model ?? DEFAULT_MODEL}
      reasoning={settings?.reasoning ?? DEFAULT_REASONING}
      updatedAt={settings?.updated_at ?? null}
      configured={openRouterConfigured()}
      models={models}
      stats={stats}
      days={DAYS}
    />
  );
}
