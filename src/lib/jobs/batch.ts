import "server-only";

import { after } from "next/server";

import { JOB_STALE_MS, MAX_RUNNING_JOBS } from "@/lib/ai/defaults";
import { runResumeJob } from "@/lib/ai/jobs";
import { openRouterConfigured } from "@/lib/ai/openrouter";
import { profileSchema } from "@/lib/document/schema";
import { generationsLastHour, HOURLY_LIMIT, NOT_ASSIGNED, worksProfile } from "@/lib/jobs/work";
import { templateSpec } from "@/lib/pdf/templates";
import type { Actor } from "@/lib/roles";
import type { Db } from "@/lib/supabase/request";
import type { ResumeJobRow, ResumeStyle } from "@/lib/supabase/types";

/** The most one batch may hold — a day's list, but not a runaway one. */
export const MAX_BATCH = 50;

export type BatchResult =
  | { ok: true; started: number; queued: number; skipped: number; jobs: ResumeJobRow[] }
  | { ok: false; error: string };

/** The style fields a PDF is rendered from — anything else in a request is dropped. */
export function cleanStyle(style: ResumeStyle | null | undefined): ResumeStyle | null {
  if (!style) return null;
  const { fontScale, headerPosition, accent, lineSpacing, justify, header, font } = style;
  return { fontScale, headerPosition, accent, lineSpacing, justify, header, font };
}

/**
 * Generates a resume for each chosen job, for one profile.
 *
 * Up to MAX_RUNNING_JOBS run at once per person: as many as are free start
 * now, in `after()`; the rest wait as `queued` for the queue runner, which
 * pg_cron calls each minute. Rows already generated (or on their way) for
 * this profile are skipped unless `regenerate` is set.
 *
 * Inserted through the caller's own client, so the resume_job policies decide
 * whether they may work the profile — the same as a single Generate.
 */
export async function startBatch(
  db: Db,
  actor: Actor,
  input: {
    profileId: string;
    jobIds: string[];
    template?: string | null;
    style?: ResumeStyle | null;
    regenerate?: boolean;
  },
): Promise<BatchResult> {
  if (!openRouterConfigured()) return { ok: false, error: "Generation is off: OPENROUTER_API_KEY is not set." };
  const ids = [...new Set(input.jobIds)];
  if (!ids.length) return { ok: false, error: "Choose the jobs to generate for." };
  if (ids.length > MAX_BATCH) return { ok: false, error: `Up to ${MAX_BATCH} jobs at a time.` };

  const { data: profile } = await db
    .from("candidate_profile")
    .select("id, team_id, profile")
    .eq("id", input.profileId)
    .maybeSingle();
  if (!profile) return { ok: false, error: "Profile not found." };
  if (!(await worksProfile(db, actor, profile.id))) return { ok: false, error: NOT_ASSIGNED };
  if (!profileSchema.safeParse(profile.profile).success) {
    return { ok: false, error: "This profile doesn't satisfy the schema; fix it on the Profiles page first." };
  }

  // Your own jobs only: the policies would refuse a generation for anyone else's.
  const { data: jobRows } = await db.from("job").select("id").in("id", ids).eq("created_by", actor.id);
  const rows = jobRows ?? [];
  if (!rows.length) return { ok: false, error: "Those jobs aren't on your list any more." };

  // Already generated, or on its way, for this profile: not again unless asked.
  let todo = rows;
  if (!input.regenerate) {
    const { data: existing } = await db
      .from("resume_job")
      .select("job_id")
      .eq("profile_id", profile.id)
      .in("job_id", rows.map((r) => r.id))
      .in("status", ["queued", "running", "ready"]);
    const done = new Set((existing ?? []).map((e) => e.job_id));
    todo = rows.filter((r) => !done.has(r.id));
  }
  const skipped = rows.length - todo.length;
  if (!todo.length) return { ok: true, started: 0, queued: 0, skipped, jobs: [] };

  // The hourly limit counts what is already waiting too, so a batch can't
  // queue its way past it.
  const staleBefore = new Date(Date.now() - JOB_STALE_MS).toISOString();
  const [lastHour, { data: pending }] = await Promise.all([
    generationsLastHour(actor.id),
    db.from("resume_job").select("status, started_at, created_at").eq("created_by", actor.id).in("status", ["queued", "running"]),
  ]);
  const live = (pending ?? []).filter((j) => j.status === "queued" || (j.started_at ?? j.created_at) > staleBefore);
  const remaining = HOURLY_LIMIT - lastHour - live.length;
  if (todo.length > remaining) {
    return {
      ok: false,
      error:
        remaining > 0
          ? `That's more than the hourly limit allows right now — ${remaining} more can be generated this hour.`
          : `That's the hourly limit (${HOURLY_LIMIT}) reached. Try again shortly.`,
    };
  }

  const running = live.filter((j) => j.status === "running").length;
  const free = Math.max(0, MAX_RUNNING_JOBS - running);
  const template = templateSpec(input.template ?? "banner").id;
  const style = cleanStyle(input.style);
  const now = new Date().toISOString();

  const { data: jobs, error } = await db
    .from("resume_job")
    .insert(
      todo.map((row, index) => ({
        profile_id: profile.id,
        team_id: profile.team_id,
        created_by: actor.id,
        job_id: row.id,
        template,
        style,
        status: index < free ? ("running" as const) : ("queued" as const),
        started_at: index < free ? now : null,
      })),
    )
    .select("*");
  if (error || !jobs) return { ok: false, error: error?.message ?? "The batch couldn't be started." };

  const started = jobs.filter((j) => j.status === "running");
  after(() => Promise.allSettled(started.map((j) => runResumeJob(j.id))));
  return { ok: true, started: started.length, queued: jobs.length - started.length, skipped, jobs };
}
