"use server";

import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import { startBatch } from "@/lib/jobs/batch";
import { syncSheet } from "@/lib/jobs/sync";
import { createClient } from "@/lib/supabase/server";
import type { ResumeStyle } from "@/lib/supabase/types";

/** Connects a sheet (with `url`) and syncs it, or re-syncs the connected one. */
export async function syncJobSheet(url?: string) {
  const result = await syncSheet(await createClient(), (await requireActor()).id, url);
  revalidatePath("/dashboard/jobs");
  return result;
}

/** Generates resumes for the chosen rows — see startBatch(). */
export async function generateForJobs(input: {
  profileId: string;
  sheetJobIds: string[];
  template: string;
  style: ResumeStyle | null;
  regenerate: boolean;
}) {
  const result = await startBatch(await createClient(), await requireActor(), input);
  revalidatePath("/dashboard/jobs");
  return result.ok
    ? { ok: true as const, started: result.started, queued: result.queued, skipped: result.skipped }
    : result;
}
