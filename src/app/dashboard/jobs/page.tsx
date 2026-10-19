import { JobSheet, type JobRow } from "@/components/job-sheet";
import { requireActor } from "@/lib/actor";
import { assignedProfileIds } from "@/lib/profile-scope";
import { canSelfAssign } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Job sheet · Application" };

/** Room for the first jobs of a batch to run in `after()`. */
export const maxDuration = 300;

const byJobNo = (a: { job_no: string }, b: { job_no: string }) => {
  const x = Number(a.job_no);
  const y = Number(b.job_no);
  return Number.isFinite(x) && Number.isFinite(y) ? x - y : a.job_no.localeCompare(b.job_no, undefined, { numeric: true });
};

/**
 * The person's Google Sheet of jobs, and a resume for each — generated in a
 * batch, in the background, for the profile chosen here.
 */
export default async function JobSheetPage({ searchParams }: PageProps<"/dashboard/jobs">) {
  const actor = await requireActor();
  const db = await createClient();
  const params = await searchParams;

  const [{ data: sheet }, { data: sheetJobs }, { data: allProfiles }] = await Promise.all([
    db.from("job_sheet").select("url, last_synced_at, last_error").maybeSingle(),
    db.from("sheet_job").select("id, job_no, title, company, url").eq("in_sheet", true),
    db.from("candidate_profile").select("id, full_name").order("full_name"),
  ]);

  let profiles = allProfiles ?? [];
  if (canSelfAssign(actor.role)) {
    const mine = await assignedProfileIds(db, actor.id);
    profiles = profiles.filter((p) => mine.has(p.id));
  }
  const wanted = typeof params.profile === "string" ? params.profile : null;
  const profile = profiles.find((p) => p.id === wanted) ?? profiles[0] ?? null;

  const latest = new Map<string, JobRow["resume"]>();
  if (profile && sheetJobs?.length) {
    const { data: resumes } = await db
      .from("resume_job")
      .select("id, sheet_job_id, status, valid, error, application_id, started_at, created_at")
      .eq("profile_id", profile.id)
      .not("sheet_job_id", "is", null)
      .order("created_at", { ascending: false });
    for (const r of resumes ?? []) {
      if (!r.sheet_job_id || latest.has(r.sheet_job_id)) continue;
      latest.set(r.sheet_job_id, {
        id: r.id,
        status: r.status,
        valid: r.valid,
        error: r.error,
        tracked: Boolean(r.application_id),
        startedAt: r.started_at ?? r.created_at,
      });
    }
  }

  return (
    <JobSheet
      sheet={sheet}
      profiles={profiles.map((p) => ({ id: p.id, name: p.full_name }))}
      profileId={profile?.id ?? null}
      jobs={[...(sheetJobs ?? [])].sort(byJobNo).map((j) => ({
        id: j.id,
        no: j.job_no,
        title: j.title,
        company: j.company,
        url: j.url,
        resume: latest.get(j.id) ?? null,
      }))}
    />
  );
}
