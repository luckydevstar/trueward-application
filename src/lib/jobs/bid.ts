import "server-only";

import type { CurrentActor } from "@/lib/actor";
import { contentSchema, fieldErrors, resumeDocumentSchema, type FieldError } from "@/lib/document/schema";
import { applyJob, type ApplyResult } from "@/lib/jobs/apply";
import { cleanJob, type JobFieldsInput } from "@/lib/jobs/fields";
import { findOrCreateJob } from "@/lib/jobs/jobs";
import { profileStyle } from "@/lib/jobs/style";
import { NOT_ASSIGNED, trackApplication, worksProfile } from "@/lib/jobs/work";
import { applicationNo, jobNo } from "@/lib/numbers";
import { templateSpec } from "@/lib/pdf/templates";
import { allowedTemplates } from "@/lib/style-access";
import type { Db } from "@/lib/supabase/request";

/*
 * Applying from the posting itself, in the Chrome extension: the panel reads
 * the job off the page, the person pastes resume JSON written elsewhere, the
 * PDF downloads in the profile's style, and Done records the bid.
 *
 * The pasted resume is kept as a generation (resume_job, status ready) for
 * the job — so it downloads, records and attaches through the same paths as
 * a generated one (/api/resume-jobs/:id/pdf, applyJob), and shows in the
 * builder's list where it can be opened and edited.
 */

export type PastedResume =
  | { ok: true; resumeJobId: string; job: { id: string; no: string }; template: string; styleSource: string }
  | { ok: false; error: string; problems?: FieldError[] };

/** Strips the ```json fence a model wraps its output in. */
const unfence = (value: string) =>
  value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

/**
 * Validates pasted resume JSON against the profile and keeps it, for the job
 * on the page, in the profile's saved style — or in `template`, when the
 * person picked one, with the rest of the profile's style (accent, font,
 * spacing). Saving again for the same job replaces the earlier paste rather
 * than adding another.
 */
export async function savePastedResume(
  db: Db,
  actor: CurrentActor,
  token: string | null,
  input: { profileId: string; content: unknown; job: JobFieldsInput; resumeJobId?: string | null; template?: string | null },
): Promise<PastedResume> {
  let value = input.content;
  if (typeof value === "string") {
    const raw = unfence(value);
    if (!raw) return { ok: false, error: "Paste the resume JSON first." };
    try {
      value = JSON.parse(raw);
    } catch (error) {
      return { ok: false, error: `That isn't valid JSON — ${error instanceof Error ? error.message : "it doesn't parse"}.` };
    }
  }

  const { data: profile } = await db
    .from("candidate_profile")
    .select("id, team_id, profile")
    .eq("id", input.profileId)
    .maybeSingle();
  if (!profile) return { ok: false, error: "Profile not found." };
  if (!(await worksProfile(db, actor, profile.id))) return { ok: false, error: NOT_ASSIGNED };

  const content = contentSchema.safeParse(value);
  if (!content.success) {
    return { ok: false, error: "The resume JSON doesn't match the schema.", problems: fieldErrors(content.error) };
  }
  const doc = resumeDocumentSchema.safeParse({ schemaVersion: 2, profile: profile.profile, content: content.data });
  if (!doc.success) {
    return { ok: false, error: "The resume JSON doesn't fit this profile.", problems: fieldErrors(doc.error) };
  }

  const fields = cleanJob(input.job, { complete: false });
  if (!fields.ok) return fields;
  const found = await findOrCreateJob(db, actor.id, fields.value);
  if (!found.ok) return found;

  const style = await profileStyle(db, actor, profile.id, token);
  // A template picked in the panel, if the account may use it; else the profile's.
  const picked = input.template?.trim();
  const template =
    picked && allowedTemplates(actor.allowedTemplates).some((t) => t.id === picked) ? templateSpec(picked).id : style.template;
  const now = new Date().toISOString();
  const row = {
    content: doc.data.content,
    valid: true,
    error: null,
    job_id: found.job.id,
    template,
    style: style.style,
    updated_at: now,
    finished_at: now,
  };

  let resumeJobId: string | null = null;
  if (input.resumeJobId) {
    // The earlier paste, while it's still this profile's and not yet sent.
    const { data } = await db
      .from("resume_job")
      .update(row)
      .eq("id", input.resumeJobId)
      .eq("profile_id", profile.id)
      .eq("status", "ready")
      .is("application_id", null)
      .select("id");
    resumeJobId = data?.[0]?.id ?? null;
  }
  if (!resumeJobId) {
    const { data, error } = await db
      .from("resume_job")
      .insert({
        ...row,
        profile_id: profile.id,
        team_id: profile.team_id,
        created_by: actor.id,
        status: "ready",
        model: null,
        started_at: now,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "The resume couldn't be kept." };
    resumeJobId = data.id;
  }

  return {
    ok: true,
    resumeJobId,
    job: { id: found.job.id, no: jobNo(found.job.no) },
    template,
    styleSource: picked && template !== style.template ? "picked" : style.source,
  };
}

export type BidResult = ApplyResult;

/**
 * Done: records the bid for the posting on the page — as its job (found or
 * added from the description), with the pasted resume's PDF attached when
 * there is one. The same refusals as everywhere else: the cooldown and the
 * blocklist come back as reasons, not errors.
 */
export async function recordBid(
  db: Db,
  actor: CurrentActor,
  input: {
    profileId: string;
    resumeJobId?: string | null;
    title?: string | null;
    company?: string | null;
    url?: string | null;
    description?: string | null;
  },
): Promise<BidResult> {
  const title = input.title?.trim() ?? "";
  const company = input.company?.trim() ?? "";
  const url = input.url?.trim() ?? "";
  if (!title || !company || !url) {
    return { ok: false, reason: "other", error: "The job title, company and link are all needed to record it." };
  }

  let jobId: string | null = null;
  if (input.description?.trim()) {
    const fields = cleanJob({ title, company, url, description: input.description }, { complete: true });
    if (!fields.ok) return { ok: false, reason: "other", error: fields.error };
    const found = await findOrCreateJob(db, actor.id, fields.value);
    if (!found.ok) return { ok: false, reason: "other", error: found.error };
    jobId = found.job.id;
  }

  if (input.resumeJobId) {
    const { data: resume } = await db
      .from("resume_job")
      .select("id, profile_id, job_id, application_id")
      .eq("id", input.resumeJobId)
      .maybeSingle();
    if (!resume) return { ok: false, reason: "other", error: "That resume isn't there any more — paste it again." };
    if (resume.profile_id !== input.profileId) {
      return { ok: false, reason: "other", error: "That resume is for another profile — paste it again for this one." };
    }
    // The description was edited after pasting: the resume goes with the job it now is.
    if (jobId && resume.job_id !== jobId && !resume.application_id) {
      await db.from("resume_job").update({ job_id: jobId, updated_at: new Date().toISOString() }).eq("id", resume.id);
    }
    return applyJob(db, actor, resume.id, { title, company, url });
  }

  const recorded = await trackApplication(db, actor, { profileId: input.profileId, title, company, jobUrl: url, jobId });
  if (!recorded.ok) return recorded;
  return {
    ok: true,
    applicationId: recorded.id,
    fileUrl: null,
    fileName: "",
    alreadyTracked: false,
    number: applicationNo(recorded.no, recorded.part),
  };
}
