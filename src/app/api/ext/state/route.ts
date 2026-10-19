import { NextResponse } from "next/server";

import { UNAUTHORIZED } from "@/lib/ext-http";
import { TEMPLATES } from "@/lib/pdf/templates";
import { assignedProfileIds } from "@/lib/profile-scope";
import { canSelfAssign } from "@/lib/scope";
import { requestActor } from "@/lib/supabase/request";

const CONTACT =
  "id, full_name, email, phone, address, city, state, postal_code, country, birthday, github_url, linkedin_url";

/** Numeric job numbers in number order, anything else after them as text. */
const byJobNo = (a: { job_no: string }, b: { job_no: string }) => {
  const x = Number(a.job_no);
  const y = Number(b.job_no);
  if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  return a.job_no.localeCompare(b.job_no, undefined, { numeric: true });
};

/**
 * Everything the extension's panel shows, in one round trip: who is signed
 * in, the profiles they can work, the chosen one's contact details, their job
 * sheet, and where each job's resume stands for that profile.
 *
 * Profiles are the ones the person may *work* — a bidder's assigned ones, a
 * subadmin's team, a super admin's own assignments. Never the SSN.
 */
export async function GET(request: Request) {
  const ctx = await requestActor(request);
  if (!ctx) return UNAUTHORIZED();
  const { db, actor } = ctx;
  const wanted = new URL(request.url).searchParams.get("profileId");

  const [{ data: allProfiles }, { data: sheet }, { data: sheetJobs }] = await Promise.all([
    db.from("candidate_profile").select(CONTACT).order("full_name"),
    db.from("job_sheet").select("url, last_synced_at, last_error").maybeSingle(),
    db.from("sheet_job").select("id, job_no, title, company, url").eq("in_sheet", true),
  ]);

  let profiles = allProfiles ?? [];
  if (canSelfAssign(actor.role)) {
    const mine = await assignedProfileIds(db, actor.id);
    profiles = profiles.filter((p) => mine.has(p.id));
  }
  const profile = profiles.find((p) => p.id === wanted) ?? profiles[0] ?? null;

  const latest = new Map<string, { id: string; status: string; valid: boolean | null; error: string | null; tracked: boolean }>();
  if (profile && sheetJobs?.length) {
    const { data: resumes } = await db
      .from("resume_job")
      .select("id, sheet_job_id, status, valid, error, application_id, created_at")
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
      });
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
    sheet,
    templates: TEMPLATES.map((t) => ({ id: t.id, label: t.label })),
    jobs: [...(sheetJobs ?? [])].sort(byJobNo).map((j) => ({
      id: j.id,
      no: j.job_no,
      title: j.title,
      company: j.company,
      url: j.url,
      resume: latest.get(j.id) ?? null,
    })),
  });
}
