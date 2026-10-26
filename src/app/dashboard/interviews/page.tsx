import { InterviewsSheet, type InterviewRow } from "@/components/interviews-sheet";
import { requireActor } from "@/lib/actor";
import type { Interview } from "@/lib/interviews";
import { isAdminRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Interviews" };

type ApplicationBits = {
  id: string;
  no: number;
  no_part: number;
  title: string;
  company: string;
  job_url: string;
  resume_url: string | null;
  resume_name: string | null;
  status: string;
  job_id: string | null;
  profile: { full_name: string } | null;
};

/**
 * Every interview on Trueward Calendar that belongs to an application this
 * person can see — application_interviews() decides, by the application's own
 * rules — with the application's posting, resume and job description to hand.
 * Outcomes are marked on the calendar event itself, so the calendar and this
 * page are the same record.
 */
export default async function InterviewsPage() {
  const actor = await requireActor();
  const supabase = await createClient();

  // Empty, not an error, until the calendar's schema has been run.
  const { data } = await supabase.rpc("application_interviews" as never);
  const interviews = (data ?? []) as Interview[];

  const ids = [...new Set(interviews.map((i) => i.application_id))];
  const { data: applications } = ids.length
    ? await supabase
        .from("application")
        .select("id, no, no_part, title, company, job_url, resume_url, resume_name, status, job_id, profile:candidate_profile(full_name)")
        .in("id", ids)
    : { data: [] };
  const byId = new Map(((applications ?? []) as unknown as ApplicationBits[]).map((a) => [a.id, a]));

  const rows: InterviewRow[] = interviews.flatMap((i) => {
    const a = byId.get(i.application_id);
    if (!a) return [];
    return [
      {
        ...i,
        application: {
          id: a.id,
          no: a.no,
          part: a.no_part,
          title: a.title,
          company: a.company,
          jobUrl: a.job_url,
          resumeUrl: a.resume_url,
          resumeName: a.resume_name,
          status: a.status,
          jobId: a.job_id,
          candidate: a.profile?.full_name ?? null,
        },
        // The calendar's rule for who may change an event: its creator, or the super admin.
        canMark: actor.role === "super_admin" || i.created_by === actor.id,
      },
    ];
  });

  return <InterviewsSheet rows={rows} canOpenCalendar={isAdminRole(actor.role)} />;
}
