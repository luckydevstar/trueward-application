import { OverviewCards } from "@/components/overview-cards";
import { requireActor } from "@/lib/actor";
import { APPLICATION_STATUSES } from "@/lib/status";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Overview · Application" };

export default async function DashboardPage() {
  // Called for the redirect alone: an anonymous or orphaned session never
  // reaches the query below.
  await requireActor();

  const supabase = await createClient();

  // No team filter: RLS already restricts these rows to the actor's scope, and
  // a redundant `.eq("team_id", …)` here would be a second source of truth that
  // could drift from the policy.
  const { data: rows } = await supabase
    .from("application")
    .select("status, billing");

  const applications = rows ?? [];
  const byStatus = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0]));
  let unbilled = 0;

  for (const row of applications) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    if (row.billing === "unbilled") unbilled += 1;
  }

  return (
    <OverviewCards
      total={applications.length}
      byStatus={byStatus}
      unbilled={unbilled}
    />
  );
}
