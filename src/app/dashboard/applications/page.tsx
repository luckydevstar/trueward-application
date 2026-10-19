import { Alert } from "antd";

import { ApplicationsGrid } from "@/components/applications-grid";
import type { Interview } from "@/components/interview-cell";
import { requireActor } from "@/lib/actor";
import { ROW_COLUMNS, type ApplicationRow as Row } from "@/lib/application-row";
import { fetchAll } from "@/lib/fetch-all";
import { assignedProfileIds } from "@/lib/profile-scope";
import { isAdminRole, managesTeam } from "@/lib/roles";
import { canBrowseRecords, seesAllTeams, teamIdFor } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Applications" };

export default async function ApplicationsPage() {
  const actor = await requireActor();

  if (!canBrowseRecords(actor)) {
    return (
      <Alert
        type="warning"
        showIcon
        title="No team"
        description="Your account isn't attached to a team, so there's nowhere to record applications. A subadmin needs to set your account up."
      />
    );
  }

  const supabase = await createClient();

  /**
   * Four reads, awaited together so the page costs one round trip rather than
   * four sequential ones.
   *
   * None of them filters by team or by assignment. RLS already narrows
   * applications to "my team, and either mine or for a profile I share", and
   * candidate_profile to the profiles I can use — which, for a bidder, is
   * exactly the assigned ones the entry row may offer. A filter here would be
   * a second copy of those rules, free to drift from them.
   */
  const everyTeam = seesAllTeams(actor);
  const [applications, profiles, members, blocked, mine, interviews] = await Promise.all([
    /*
     * Paged, because PostgREST caps a response at 1,000 rows and says nothing
     * about it. Without this the grid showed the newest 1,000 applications
     * and reported that as the total — the missing ones were simply absent,
     * with no error and no gap to notice.
     *
     * The order matters as much as the range: `applied_at desc` with `id` as
     * the tiebreak, so two applications recorded in the same second cannot
     * swap places between pages and appear twice or not at all.
     */
    fetchAll<Row>((from, to) =>
      supabase
        .from("application")
        .select(ROW_COLUMNS)
        .order("applied_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    ),
    supabase.from("candidate_profile").select("id, full_name, team_id").order("full_name"),
    supabase.from("app_user").select("id, name, email"),
    supabase.from("blocked_company").select("normalized_name"),
    // A super admin records only for the profiles assigned to themselves.
    everyTeam ? assignedProfileIds(supabase, actor.id) : Promise.resolve(null),
    // Interviews from Trueward Calendar, for the applications this person can
    // see — a function, because bidders can't read the calendar itself.
    // Empty until the calendar's schema has been run.
    supabase.rpc("application_interviews" as never),
  ]);

  const byApplication: Record<string, Interview[]> = {};
  for (const i of ((interviews.data ?? []) as Interview[])) {
    (byApplication[i.application_id] ??= []).push(i);
  }

  const rows = applications.rows;

  return (
    <ApplicationsGrid
      // Empty for a super admin, who browses every team and belongs to none.
      // What they record joins the profile's team instead, and only for a
      // profile assigned to them; with none, the grid hides its entry row.
      teamId={teamIdFor(actor) ?? ""}
      readOnly={everyTeam && !mine?.size}
      userId={actor.id}
      isAdmin={isAdminRole(actor.role)}
      canChangeAny={managesTeam(actor.role)}
      interviews={byApplication}
      isSuperAdmin={actor.role === "super_admin"}
      rows={rows}
      profiles={(profiles.data ?? []).map((p) => ({
        id: p.id,
        label: p.full_name,
        teamId: p.team_id,
        workable: mine ? mine.has(p.id) : true,
      }))}
      // Only people who actually appear in the visible rows: a filter listing
      // the whole team would offer options that select nothing.
      appliers={(members.data ?? [])
        .filter((m) => rows.some((r) => r.created_by === m.id))
        .map((m) => ({ id: m.id, label: m.name ?? m.email }))}
      blockedNames={(blocked.data ?? []).map((b) => b.normalized_name)}
    />
  );
}
