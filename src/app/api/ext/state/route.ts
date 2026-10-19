import { NextResponse } from "next/server";

import { UNAUTHORIZED } from "@/lib/ext-http";
import { applicationNo, jobNo } from "@/lib/numbers";
import { TEMPLATES } from "@/lib/pdf/templates";
import { assignedProfileIds } from "@/lib/profile-scope";
import { canSelfAssign } from "@/lib/scope";
import { requestActor } from "@/lib/supabase/request";

const CONTACT =
  "id, full_name, email, phone, address, city, state, postal_code, country, birthday, github_url, linkedin_url";

/** The newest jobs the panel lists; older ones are on the Jobs page. */
const JOB_LIMIT = 300;

/**
 * Everything the extension's panel shows, in one round trip: who is signed
 * in, the profiles they can work, the chosen one's contact details, their
 * jobs, and for each job where its resume and application stand for that
 * profile.
 *
 * Profiles are the ones the person may *work* — a bidder's assigned ones, a
 * subadmin's team, a super admin's own assignments. Never the SSN.
 */
export async function GET(request: Request) {
  const ctx = await requestActor(request);
  if (!ctx) return UNAUTHORIZED();
  const { db, actor } = ctx;
  const wanted = new URL(request.url).searchParams.get("profileId");

  const [{ data: allProfiles }, { data: jobs }] = await Promise.all([
    db.from("candidate_profile").select(CONTACT).order("full_name"),
    db
      .from("job")
      .select("id, no, title, company, url")
      .eq("created_by", actor.id)
      .is("archived_at", null)
      .order("no", { ascending: false })
      .limit(JOB_LIMIT),
  ]);

  let profiles = allProfiles ?? [];
  if (canSelfAssign(actor.role)) {
    const mine = await assignedProfileIds(db, actor.id);
    profiles = profiles.filter((p) => mine.has(p.id));
  }
  const profile = profiles.find((p) => p.id === wanted) ?? profiles[0] ?? null;

  const resumes = new Map<string, { id: string; status: string; valid: boolean | null; error: string | null; tracked: boolean }>();
  const applied = new Map<string, { no: string; status: string }>();
  const jobIds = (jobs ?? []).map((j) => j.id);
  if (profile && jobIds.length) {
    const [{ data: resumeRows }, { data: applicationRows }] = await Promise.all([
      db
        .from("resume_job")
        .select("id, job_id, status, valid, error, application_id, created_at")
        .eq("profile_id", profile.id)
        .in("job_id", jobIds)
        .order("created_at", { ascending: false }),
      db
        .from("application")
        .select("job_id, no, no_part, status")
        .eq("profile_id", profile.id)
        .in("job_id", jobIds),
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
      if (a.job_id) applied.set(a.job_id, { no: applicationNo(a.no, a.no_part), status: a.status });
    }
  }

  return NextResponse.json({
    me: { name: actor.name, email: actor.email, role: actor.role },
    profiles: profiles.map((p) => ({ id: p.id, name: p.full_name })),
    profile: profile
      ? {
          id: profile.id,
          fullName: profile.full_name,
          email: profile.email,
          phone: profile.phone,
          address: profile.address,
          city: profile.city,
          state: profile.state,
          postalCode: profile.postal_code,
          country: profile.country,
          birthday: profile.birthday,
          linkedin: profile.linkedin_url,
          github: profile.github_url,
        }
      : null,
    templates: TEMPLATES.map((t) => ({ id: t.id, label: t.label })),
    jobs: (jobs ?? []).map((j) => ({
      id: j.id,
      no: jobNo(j.no),
      title: j.title,
      company: j.company,
      url: j.url,
      resume: resumes.get(j.id) ?? null,
      application: applied.get(j.id) ?? null,
    })),
  });
}
