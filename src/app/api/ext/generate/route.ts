import { NextResponse } from "next/server";

import { body, fail, UNAUTHORIZED } from "@/lib/ext-http";
import { startBatch } from "@/lib/jobs/batch";
import { profileStyle } from "@/lib/jobs/style";
import { requestActor } from "@/lib/supabase/request";

/** Room for the first jobs of the batch to run in `after()`. */
export const maxDuration = 300;

/**
 * Generates resumes for the chosen jobs, for one profile, in that profile's
 * style — the one the builder saved for it (src/lib/jobs/style.ts). A
 * template picked in the panel overrides the saved one; none picked keeps it.
 */
export async function POST(request: Request) {
  const ctx = await requestActor(request);
  if (!ctx) return UNAUTHORIZED();
  const input = await body<{ profileId?: string; jobIds?: string[]; template?: string; regenerate?: boolean }>(request);
  if (!input?.profileId || !input.jobIds?.length) return fail("Choose a profile and the jobs to generate for.");

  const saved = await profileStyle(ctx.db, ctx.actor, input.profileId, ctx.token);
  const result = await startBatch(ctx.db, ctx.actor, {
    profileId: input.profileId,
    jobIds: input.jobIds,
    template: input.template || saved.template,
    style: saved.style,
    regenerate: input.regenerate,
  });
  return result.ok
    ? NextResponse.json({ started: result.started, queued: result.queued, skipped: result.skipped })
    : fail(result.error);
}
