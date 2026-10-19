import "server-only";

import { generateContent, logRow } from "@/lib/ai/generate";
import { loadGenerationConfig } from "@/lib/ai/settings";
import { profileSchema } from "@/lib/document/schema";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Per model call in the background. Two calls at most (the answer and one
 * repair), so the worst case stays inside the builder page's 300s
 * maxDuration with room to write the result.
 */
const JOB_CALL_TIMEOUT_MS = 130_000;

/**
 * Finishes one background generation: runs the model and writes the result
 * onto the job row, and the call onto the generation log.
 *
 * Runs after the response, from startResumeJob's `after()`, with the service
 * role: the caller's checks were made when the row was inserted under their
 * own policies, and nobody is waiting on a session by now. Never throws — a
 * failure is written onto the row, where the builder shows it.
 *
 * Only a row still `running` is touched, so a job deleted while it ran just
 * finishes into nothing.
 */
export async function runResumeJob(jobId: string): Promise<void> {
  const admin = createAdminClient();

  const finish = async (values: {
    status: "ready" | "failed";
    content?: unknown;
    valid?: boolean;
    error?: string | null;
    model?: string | null;
    cost_usd?: number | null;
    latency_ms?: number | null;
  }) => {
    const now = new Date().toISOString();
    await admin
      .from("resume_job")
      .update({ ...values, finished_at: now, updated_at: now })
      .eq("id", jobId)
      .eq("status", "running");
  };

  try {
    const { data: job } = await admin
      .from("resume_job")
      .select("id, profile_id, created_by, status, job:job_id(description)")
      .eq("id", jobId)
      .maybeSingle();
    if (!job || job.status !== "running") return;

    const { data: row } = await admin
      .from("candidate_profile")
      .select("id, team_id, profile, company_context")
      .eq("id", job.profile_id)
      .maybeSingle();
    if (!row) {
      await finish({ status: "failed", error: "The profile no longer exists." });
      return;
    }
    const profile = profileSchema.safeParse(row.profile);
    if (!profile.success) {
      await finish({ status: "failed", error: "This profile doesn't satisfy the schema; fix it on the Profiles page." });
      return;
    }

    const config = await loadGenerationConfig(admin);
    const outcome = await generateContent({
      profile: profile.data,
      model: config.model,
      systemPrompt: config.prompt.body,
      companyContext: row.company_context,
      jobDescription: (job.job as unknown as { description: string } | null)?.description ?? "",
      reasoning: config.reasoning,
      timeoutMs: JOB_CALL_TIMEOUT_MS,
    });

    // The same log row a synchronous Generate writes, so Usage and the
    // per-model averages count background runs like any other.
    await admin.from("resume_generation").insert({
      ...logRow(outcome),
      profile_id: row.id,
      team_id: row.team_id,
      created_by: job.created_by,
      model: config.model,
      source: "builder",
      run_id: null,
      reasoning: config.reasoning,
      prompt_label: config.prompt.name,
      output: null,
    });

    const log = logRow(outcome);
    await finish(
      outcome.content === null
        ? { status: "failed", error: outcome.error ?? "The model didn't return usable JSON.", model: outcome.servedModel, cost_usd: outcome.costUsd, latency_ms: outcome.latencyMs }
        : {
            status: "ready",
            content: outcome.content,
            valid: outcome.valid,
            error: log.error,
            model: outcome.servedModel,
            cost_usd: outcome.costUsd,
            latency_ms: outcome.latencyMs,
          },
    );
  } catch (error) {
    await finish({
      status: "failed",
      error: error instanceof Error ? error.message : "Generation failed.",
    }).catch(() => {});
  }
}
