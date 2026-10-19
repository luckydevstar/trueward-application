import "server-only";

import { UTApi } from "uploadthing/server";

import { trackApplication } from "@/lib/jobs/work";
import { renderJobPdf } from "@/lib/pdf/server";
import type { Actor } from "@/lib/roles";
import type { Db } from "@/lib/supabase/request";

export type ApplyResult =
  | { ok: true; applicationId: string; fileUrl: string | null; fileName: string; alreadyTracked: boolean }
  | { ok: false; error: string; reason: "blocked" | "cooldown" | "other" };

/**
 * Download & track, from the extension: records the application for a
 * generated resume, with the PDF attached, and hands back where to download
 * it from.
 *
 * Recorded first, as in the builder: the duplicate cooldown and the blocklist
 * are why it might be refused, and that should be known before a file is
 * made. The company, title and URL come from the job-sheet row. A resume
 * already tracked isn't tracked twice; its file is handed back again.
 */
export async function applyJob(db: Db, actor: Actor, jobId: string): Promise<ApplyResult> {
  const { data: job } = await db.from("resume_job").select("*").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, reason: "other", error: "That resume isn't there any more." };
  if (job.status !== "ready") return { ok: false, reason: "other", error: "That resume isn't ready yet." };

  const { data: profile } = await db.from("candidate_profile").select("id, profile").eq("id", job.profile_id).maybeSingle();
  if (!profile) return { ok: false, reason: "other", error: "Profile not found." };

  const rendered = await renderJobPdf(job, profile.profile);
  if (!rendered.ok) return { ok: false, reason: "other", error: rendered.error };

  if (job.application_id) {
    const { data: existing } = await db
      .from("application")
      .select("id, resume_url")
      .eq("id", job.application_id)
      .maybeSingle();
    if (existing) {
      return {
        ok: true,
        applicationId: existing.id,
        fileUrl: existing.resume_url,
        fileName: rendered.fileName,
        alreadyTracked: true,
      };
    }
  }

  const target =
    job.content && typeof job.content === "object" && "targetTitle" in job.content
      ? String((job.content as { targetTitle: unknown }).targetTitle ?? "")
      : "";
  const recorded = await trackApplication(db, actor, {
    profileId: job.profile_id,
    title: job.job_title || target,
    company: job.company ?? "",
    jobUrl: job.job_url ?? "",
  });
  if (!recorded.ok) return recorded;

  let fileUrl: string | null = null;
  if (process.env.UPLOADTHING_TOKEN) {
    try {
      const uploaded = await new UTApi().uploadFiles(
        new File([rendered.bytes as BlobPart], rendered.fileName, { type: "application/pdf" }),
      );
      if (uploaded.data) {
        fileUrl = uploaded.data.ufsUrl;
        await db
          .from("application")
          .update({ resume_key: uploaded.data.key, resume_url: uploaded.data.ufsUrl, resume_name: rendered.fileName })
          .eq("id", recorded.id);
      }
    } catch {
      // Tracked without its file; the extension then downloads the PDF
      // directly instead.
    }
  }

  await db
    .from("resume_job")
    .update({ application_id: recorded.id, updated_at: new Date().toISOString() })
    .eq("id", job.id);

  return { ok: true, applicationId: recorded.id, fileUrl, fileName: rendered.fileName, alreadyTracked: false };
}
