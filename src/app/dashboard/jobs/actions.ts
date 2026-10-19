"use server";

import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import { startBatch } from "@/lib/jobs/batch";
import { cleanJob } from "@/lib/jobs/fields";
import { addJob, findOrCreateJob, updateJob } from "@/lib/jobs/jobs";
import { pastedJobs } from "@/lib/jobs/paste";
import { jobNo } from "@/lib/numbers";
import { createClient } from "@/lib/supabase/server";
import type { ResumeStyle } from "@/lib/supabase/types";

type JobInput = { id?: string | null; title: string; company: string; url: string; description: string };

/** Adds a job, or saves edits to one. */
export async function saveJob(input: JobInput) {
  const actor = await requireActor();
  const db = await createClient();
  const result = input.id ? await updateJob(db, input.id, input) : await addJob(db, actor.id, input);
  if (!result.ok) return result;
  revalidatePath("/dashboard/jobs");
  return { ok: true as const, id: result.job.id, no: jobNo(result.job.no), existed: !input.id && result.existed };
}

/** The most rows one paste may add. */
const MAX_PASTE = 200;

/**
 * Adds the rows pasted from a spreadsheet. Each is checked like a job typed
 * in; a row that fails is reported by its line and the rest still go in. A
 * description already on the list is that job, not a second one.
 */
export async function importJobs(text: string) {
  const actor = await requireActor();
  const rows = pastedJobs(text);
  if (!rows.length) return { ok: false as const, error: "Nothing to add — paste rows copied from a spreadsheet." };
  if (rows.length > MAX_PASTE) return { ok: false as const, error: `Up to ${MAX_PASTE} rows at a time.` };

  const db = await createClient();
  let added = 0;
  let existing = 0;
  const problems: string[] = [];
  for (const [index, row] of rows.entries()) {
    const clean = cleanJob(row, { complete: true });
    if (!clean.ok) {
      problems.push(`Row ${index + 1}: ${clean.error}`);
      continue;
    }
    const result = await findOrCreateJob(db, actor.id, clean.value);
    if (!result.ok) problems.push(`Row ${index + 1}: ${result.error}`);
    else if (result.existed) existing += 1;
    else added += 1;
  }
  revalidatePath("/dashboard/jobs");
  return { ok: true as const, added, existing, problems };
}

/** Takes jobs off the list, or puts them back. Nothing else about them changes. */
export async function archiveJobs(ids: string[], archived: boolean) {
  await requireActor();
  const db = await createClient();
  const { data, error } = await db
    .from("job")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .in("id", ids)
    .select("id");
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/dashboard/jobs");
  return { ok: true as const, count: data?.length ?? 0 };
}

/**
 * Deletes a job and its drafts. One with applications is kept — its
 * description is the record of what was applied to — and the database says
 * so (the foreign key restricts), which is turned into the advice to archive.
 */
export async function deleteJob(id: string) {
  await requireActor();
  const db = await createClient();
  const { data, error } = await db.from("job").delete().eq("id", id).select("id");
  if (error?.code === "23503") {
    return { ok: false as const, error: "It has applications, so it's kept for them. Archive it instead." };
  }
  if (error) return { ok: false as const, error: error.message };
  if (!data?.length) return { ok: false as const, error: "That job isn't yours, or it's already gone." };
  revalidatePath("/dashboard/jobs");
  return { ok: true as const };
}

/** Reads one job's description, to edit — the list doesn't carry them. */
export async function jobDescription(id: string) {
  await requireActor();
  const db = await createClient();
  const { data } = await db.from("job").select("description").eq("id", id).maybeSingle();
  return data?.description ?? null;
}

/** Generates resumes for the chosen jobs — see startBatch(). */
export async function generateForJobs(input: {
  profileId: string;
  jobIds: string[];
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
