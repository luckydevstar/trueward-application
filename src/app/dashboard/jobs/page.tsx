import { JobsBoard, type BoardJob } from "@/components/jobs-board";
import { requireActor } from "@/lib/actor";
import { applicationNo, jobNo } from "@/lib/numbers";
import { assignedProfileIds } from "@/lib/profile-scope";
import { canSelfAssign } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Jobs" };

/** Room for the first jobs of a batch to run in `after()`. */
export const maxDuration = 300;

/**
 * The person's jobs — the postings they apply to — and, for the profile
 * chosen here, where each one's resume and application stand. Descriptions
 * stay on the server until a job is opened; the list is titles and states.
 */
export default async function JobsPage({ searchParams }: PageProps<"/dashboard/jobs">) {
  const actor = await requireActor();
  const db = await createClient();
  const params = await searchParams;

  const [{ data: jobs }, { data: allProfiles }] = await Promise.all([
    db
      .from("job")
      .select("id, no, title, company, url, archived_at, created_at")
      .eq("created_by", actor.id)
      .order("no", { ascending: false }),
    db.from("candidate_profile").select("id, full_name").order("full_name"),
  ]);

  let profiles = allProfiles ?? [];
  if (canSelfAssign(actor.role)) {
    const mine = await assignedProfileIds(db, actor.id);
    profiles = profiles.filter((p) => mine.has(p.id));
  }
  const wanted = typeof params.profile === "string" ? params.profile : null;
  const profile = profiles.find((p) => p.id === wanted) ?? profiles[0] ?? null;

  const ids = (jobs ?? []).map((j) => j.id);
  const resumes = new Map<string, BoardJob["resume"]>();
  const applications = new Map<string, BoardJob["applications"]>();
  if (ids.length) {
    const [{ data: resumeRows }, { data: applicationRows }] = await Promise.all([
      profile
        ? db
            .from("resume_job")
            .select("id, job_id, status, valid, error, application_id, started_at, created_at")
            .eq("profile_id", profile.id)
            .in("job_id", ids)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as never[] }),
      db.from("application").select("id, job_id, no, no_part, status, profile_id").in("job_id", ids).order("no_part"),
    ]);
    for (const r of resumeRows ?? []) {
      if (resumes.has(r.job_id)) continue;
      resumes.set(r.job_id, {
        id: r.id,
        status: r.status,
        valid: r.valid,
        error: r.error,
        tracked: Boolean(r.application_id),
      });
    }
    for (const a of applicationRows ?? []) {
      if (!a.job_id) continue;
      const list = applications.get(a.job_id) ?? [];
      list.push({ no: applicationNo(a.no, a.no_part), status: a.status, mine: a.profile_id === profile?.id });
      applications.set(a.job_id, list);
    }
  }

  return (
    <JobsBoard
      profiles={profiles.map((p) => ({ id: p.id, name: p.full_name }))}
      profileId={profile?.id ?? null}
      openJobId={typeof params.job === "string" ? params.job : null}
      jobs={(jobs ?? []).map((j) => ({
        id: j.id,
        no: jobNo(j.no),
        title: j.title,
        company: j.company,
        url: j.url,
        archived: Boolean(j.archived_at),
        createdAt: j.created_at,
        resume: resumes.get(j.id) ?? null,
        applications: applications.get(j.id) ?? [],
      }))}
    />
  );
}
