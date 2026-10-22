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
 * person's last generation for that profile — which carries the profile's
 * style from the builder — or, failing that, their last of any. The builder's
 * per-profile style lives in the browser, so this is how the extension
 * follows it.
 */
export async function POST(request: Request) {
  const ctx = await requestActor(request);
  if (!ctx) return UNAUTHORIZED();
  const input = await body<{ profileId?: string; jobIds?: string[]; template?: string; regenerate?: boolean }>(request);
  if (!input?.profileId || !input.jobIds?.length) return fail("Choose a profile and the jobs to generate for.");

  const lastStyle = (profileId?: string) => {
    let query = ctx.db.from("resume_job").select("style").eq("created_by", ctx.actor.id).not("style", "is", null);
    if (profileId) query = query.eq("profile_id", profileId);
    return query.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  };
  const { data: forProfile } = await lastStyle(input.profileId);
  const last = forProfile ?? (await lastStyle()).data;

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
