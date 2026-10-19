import { NextResponse } from "next/server";

import { body, fail, UNAUTHORIZED } from "@/lib/ext-http";
import { startBatch } from "@/lib/jobs/batch";
import { requestActor } from "@/lib/supabase/request";
import type { ResumeStyle } from "@/lib/supabase/types";

/** Room for the first jobs of the batch to run in `after()`. */
export const maxDuration = 300;

/**
 * Generates resumes for the chosen jobs, for one profile. The template
 * comes from the panel; the rest of the style (accent, font, size) from the
 * person's last batch, so the extension follows what they settled on in the
 * app.
 */
export async function POST(request: Request) {
  const ctx = await requestActor(request);
  if (!ctx) return UNAUTHORIZED();
  const input = await body<{ profileId?: string; jobIds?: string[]; template?: string; regenerate?: boolean }>(request);
  if (!input?.profileId || !input.jobIds?.length) return fail("Choose a profile and the jobs to generate for.");

  const { data: last } = await ctx.db
    .from("resume_job")
    .select("style")
    .eq("created_by", ctx.actor.id)
    .not("style", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const result = await startBatch(ctx.db, ctx.actor, {
    profileId: input.profileId,
    jobIds: input.jobIds,
    template: input.template,
    style: (last?.style as ResumeStyle | null) ?? null,
    regenerate: input.regenerate,
  });
  return result.ok
    ? NextResponse.json({ started: result.started, queued: result.queued, skipped: result.skipped })
    : fail(result.error);
}
