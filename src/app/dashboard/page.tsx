import { OverviewCards } from "@/components/overview-cards";
import { requireActor } from "@/lib/actor";
import { APPLICATION_STATUSES } from "@/lib/status";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Overview" };

const WEEK_MS = 7 * 86_400_000;

type InterviewRow = { title: string; starts_at: string; outcome: string | null };

/** The next seven days' interviews, soonest first — cancelled ones aren't coming. */
function interviewsThisWeek(rows: InterviewRow[]) {
  const now = Date.now();
  return rows
    .filter((i) => {
      const at = Date.parse(i.starts_at);
      return at >= now && at < now + WEEK_MS && i.outcome !== "cancelled";
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((i) => ({ title: i.title, startsAt: i.starts_at }));
}

export default async function DashboardPage() {
  // An anonymous or orphaned session is redirected here and never reaches the
  // query below. The role picks which steps the guide shows.
  const actor = await requireActor();

  const supabase = await createClient();

  // No team filter: RLS already restricts these rows to the actor's scope, and
  // a redundant `.eq("team_id", …)` here would be a second source of truth that
  // could drift from the policy. The rest is the person's own work: their
  // drafts and jobs (RLS returns nobody else's), and the interviews on the
  // applications they can see.
  const [{ data: rows }, { count: ready }, { data: jobs }, interviews] = await Promise.all([
    supabase.from("application").select("status, billing"),
    supabase
      .from("resume_job")
      .select("id", { count: "exact", head: true })
      .eq("status", "ready")
      .is("application_id", null),
    supabase.from("job").select("id").eq("created_by", actor.id).is("archived_at", null),
    // Empty until the calendar's schema has been run.
    supabase.rpc("application_interviews" as never),
  ]);

  const applications = rows ?? [];
  const byStatus = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0]));
  let unbilled = 0;

  for (const row of applications) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    if (row.billing === "unbilled") unbilled += 1;
  }

  const jobIds = (jobs ?? []).map((j) => j.id);
  let toApply = jobIds.length;
  if (jobIds.length) {
    const { data: applied } = await supabase.from("application").select("job_id").in("job_id", jobIds);
    toApply -= new Set((applied ?? []).map((a) => a.job_id)).size;
  }

  const upcoming = interviewsThisWeek((interviews.data ?? []) as InterviewRow[]);

  return (
    <OverviewCards
      total={applications.length}
      byStatus={byStatus}
      unbilled={unbilled}
      role={actor.role}
      next={{ ready: ready ?? 0, toApply, interviews: upcoming }}
    />
  );
}
