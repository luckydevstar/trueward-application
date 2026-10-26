import { InterviewsSheet, type InterviewRow } from "@/components/interviews-sheet";
import { requireActor } from "@/lib/actor";
import type { Interview } from "@/lib/interviews";
import { profileReach, scopeToReach } from "@/lib/profile-scope";
import { isAdminRole } from "@/lib/roles";
import { teamIdFor } from "@/lib/scope";
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
  profile_id: string | null;
  profile: { full_name: string } | null;
};

/**
 * Every interview on Trueward Calendar this person can see —
 * application_interviews() decides: one linked to an application by the
 * application's own rules, with its posting, resume and job description to
 * hand; one booked in its own right (by email, say) for the calendar's users
 * and whoever works its candidate. Outcomes are marked on the calendar event
 * itself, so the calendar and this page are the same record.
 *
 * The calendar's users — subadmins and the super admin — also book
 * interviews here, onto one of its calendars. Bidders can't use the
 * calendar, so they get no form.
 */
export default async function InterviewsPage() {
  const actor = await requireActor();
  const supabase = await createClient();
  const books = isAdminRole(actor.role);
  // Same rule as every page that lists profiles, from the same place — see
  // src/lib/profile-scope.ts. Asked only for someone who books.
  const reach = books ? await profileReach(supabase, actor, teamIdFor(actor) ?? "") : null;

  const [{ data }, calendars, profiles] = await Promise.all([
    // Empty, not an error, until the calendar's schema has been run.
    supabase.rpc("application_interviews" as never),
    // In the calendar's own sidebar order. Not in this app's types.
    books
      ? supabase
          .from("calendar_source" as never)
          .select("id, name")
          .order("position" as never)
          .order("created_at" as never)
      : null,
    reach ? scopeToReach(supabase.from("candidate_profile").select("id, full_name").order("full_name"), reach, "id") : null,
  ]);
  const interviews = (data ?? []) as Interview[];

  const applicationIds = [...new Set(interviews.flatMap((i) => (i.application_id ? [i.application_id] : [])))];
  // One booked in its own right names a candidate instead of an application.
  // RLS on candidate_profile decides whose names come back.
  const profileIds = [
    ...new Set(interviews.flatMap((i) => (!i.application_id && i.interview_profile_id ? [i.interview_profile_id] : []))),
  ];
  // The calendar an event is on, to change it — for the rows this person may.
  const changeable = interviews.filter((i) => actor.role === "super_admin" || i.created_by === actor.id);

  const [{ data: applications }, { data: names }, placed] = await Promise.all([
    applicationIds.length
      ? supabase
          .from("application")
          .select(
            "id, no, no_part, title, company, job_url, resume_url, resume_name, status, job_id, profile_id, profile:candidate_profile(full_name)",
          )
          .in("id", applicationIds)
      : { data: [] },
    profileIds.length ? supabase.from("candidate_profile").select("id, full_name").in("id", profileIds) : { data: [] },
    books && changeable.length
      ? supabase
          .from("calendar_event" as never)
          .select("id, calendar_id")
          .in("id" as never, changeable.map((i) => i.event_id))
      : null,
  ]);
  const byId = new Map(((applications ?? []) as unknown as ApplicationBits[]).map((a) => [a.id, a]));
  const nameOf = new Map((names ?? []).map((p) => [p.id, p.full_name]));
  const calendarOf = new Map(
    ((placed?.data ?? []) as unknown as Array<{ id: string; calendar_id: string }>).map((e) => [e.id, e.calendar_id]),
  );

  const rows = interviews.flatMap((i): InterviewRow[] => {
    const shared = {
      calendarId: calendarOf.get(i.event_id) ?? null,
      // The calendar's rule for who may change an event: its creator, or the super admin.
      canMark: actor.role === "super_admin" || i.created_by === actor.id,
    };
    if (!i.application_id) {
      return [
        {
          ...i,
          ...shared,
          application: null,
          candidate: i.interview_profile_id ? (nameOf.get(i.interview_profile_id) ?? null) : null,
        },
      ];
    }
    const a = byId.get(i.application_id);
    if (!a) return [];
    return [
      {
        ...i,
        ...shared,
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
          profileId: a.profile_id,
        },
        candidate: a.profile?.full_name ?? null,
      },
    ];
  });

  return (
    <InterviewsSheet
      rows={rows}
      canOpenCalendar={isAdminRole(actor.role)}
      booking={
        books
          ? {
              calendars: ((calendars?.data ?? []) as unknown as Array<{ id: string; name: string }>).map((c) => ({
                id: c.id,
                name: c.name,
              })),
              profiles: (profiles?.data ?? []).map((p) => ({ id: p.id, name: p.full_name })),
            }
          : null
      }
    />
  );
}
