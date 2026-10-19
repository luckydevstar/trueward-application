import "server-only";

import { cleanJob, type JobFields, type JobFieldsInput } from "@/lib/jobs/fields";
import type { Db } from "@/lib/supabase/request";
import type { JobRow } from "@/lib/supabase/types";

/*
 * A person's jobs: the postings they apply to, each holding the only copy of
 * its description. Written through the caller's own client, so the job
 * policies (schema part 4) decide — a job is its creator's alone to change.
 */

export type JobResult = { ok: true; job: JobRow; existed: boolean } | { ok: false; error: string };

/** Adds a job from the Jobs page or the extension, or finds the one with this description already. */
export async function addJob(db: Db, actorId: string, input: JobFieldsInput): Promise<JobResult> {
  const clean = cleanJob(input, { complete: true });
  if (!clean.ok) return clean;
  return findOrCreateJob(db, actorId, clean.value);
}

/**
 * The job with this exact description, or a new one. Pasting a posting
 * twice — regenerating in the builder, or adding it again from the
 * extension — finds the job it already is, so its description is stored once
 * and its number stays the one its applications carry. Details the existing
 * job is missing are filled in from the new ones; nothing it has is replaced.
 */
export async function findOrCreateJob(db: Db, actorId: string, fields: JobFields): Promise<JobResult> {
  const { data: existing } = await db
    .from("job")
    .select("*")
    .eq("created_by", actorId)
    .eq("description", fields.description)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const fill: Partial<JobRow> = {};
    if (!existing.company && fields.company) fill.company = fields.company;
    if (!existing.url && fields.url) fill.url = fields.url;
    if (existing.archived_at) fill.archived_at = null;
    if (!Object.keys(fill).length) return { ok: true, job: existing, existed: true };
    const { data: updated, error } = await db
      .from("job")
      .update({ ...fill, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select("*")
      .single();
    return error || !updated ? { ok: false, error: error?.message ?? "Couldn't update the job." } : { ok: true, job: updated, existed: true };
  }

  const { data: job, error } = await db
    .from("job")
    .insert({ ...fields, created_by: actorId })
    .select("*")
    .single();
  if (error || !job) return { ok: false, error: error?.message ?? "Couldn't add the job." };
  return { ok: true, job, existed: false };
}

/** Saves edits to one of your jobs. Its number never changes. */
export async function updateJob(db: Db, id: string, input: JobFieldsInput): Promise<JobResult> {
  const clean = cleanJob(input, { complete: true });
  if (!clean.ok) return clean;
  const { data: job, error } = await db
    .from("job")
    .update({ ...clean.value, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!job) return { ok: false, error: "That job isn't yours, or it's gone." };
  return { ok: true, job, existed: true };
}
