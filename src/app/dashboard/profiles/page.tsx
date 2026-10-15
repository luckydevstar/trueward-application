import { Alert } from "antd";

import { ProfilesList } from "@/components/profiles-list";
import { requireActor } from "@/lib/actor";
import { profileReach, scopeToReach } from "@/lib/profile-scope";
import {
  canAssignProfiles,
  canBrowseRecords,
  canEditProfiles,
  canSelfAssign,
  seesAllTeams,
  teamIdFor,
} from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Profiles" };

export default async function ProfilesPage() {
  const actor = await requireActor();

  if (!canBrowseRecords(actor)) {
    return (
      <Alert
        type="warning"
        showIcon
        title="No team"
        description="Your account isn't attached to a team, so there are no profiles to show."
      />
    );
  }

  // The subadmin keeps the team's profiles and routes them to bidders. The
  // super admin corrects, deletes and re-homes any team's profiles but cannot
  // create one — it would have no team. A bidder sees only theirs.
  const canCreate = canEditProfiles(actor.role);
  const canEdit = canCreate || seesAllTeams(actor);
  const canAssign = canAssignProfiles(actor.role);
  const teamId = teamIdFor(actor) ?? "";
  const supabase = await createClient();

  // Same rule as the resume builder page, from the same place — see
  // src/lib/profile-scope.ts for why it is not written out twice.
  const reach = await profileReach(supabase, actor, teamId);

  /*
   * A super admin has no team, and pinning the query to `teamId` would
   * therefore filter on the empty string and return nothing. They are the one
   * actor whose answer is "every team", so the filter is dropped for them and
   * RLS — which already admits them through in_team() — is what decides.
   */
  const everyTeam = seesAllTeams(actor);

  // Who works which profile: changeable by the subadmin, visible to the super
  // admin reviewing them.
  const showsAssignments = canAssign || everyTeam;

  const [profiles, assignments, members] = await Promise.all([
    scopeToReach(
      (() => {
        const query = supabase
          .from("candidate_profile")
          // ssn_encrypted is never selected. The list only needs to know
          // *whether* one exists, which the boolean below answers without
          // moving ciphertext.
          .select(
            "id, full_name, email, phone, city, state, country, updated_at, ssn_encrypted, team_id",
          )
          .order("full_name");
        return everyTeam ? query : query.eq("team_id", teamId);
      })(),
      reach,
      "id",
    ),
    showsAssignments
      ? (() => {
          const query = supabase
            .from("profile_assignment")
            .select("profile_id, user_id");
          return everyTeam ? query : query.eq("team_id", teamId);
        })()
      : Promise.resolve({ data: [] as never[] }),
    // Bidders only: an assignment is how a bidder reaches a profile, and the
    // subadmin already reaches all of them. The policy refuses anyone else.
    showsAssignments
      ? (() => {
          const query = supabase
            .from("app_user")
            .select("id, name, email")
            .eq("role", "bidder")
            .order("name");
          // A subadmin's bidders are the accounts they created. A super admin
          // reviews every team, so there is nobody to exclude.
          return everyTeam ? query : query.eq("created_by_id", teamId);
        })()
      : Promise.resolve({ data: [] as never[] }),
  ]);

  /*
   * An assignment names a bidder or the super admin (working the profile
   * themselves) — the policy admits nobody else. Split here, because the two
   * are shown and changed differently: bidders are the subadmin's to route,
   * the super admin's is theirs alone.
   */
  const bidderIds = new Set((members.data ?? []).map((m) => m.id));
  const byProfile = new Map<string, string[]>();
  const superAdminWorks = new Set<string>();
  for (const a of assignments.data ?? []) {
    if (bidderIds.has(a.user_id)) {
      byProfile.set(a.profile_id, [...(byProfile.get(a.profile_id) ?? []), a.user_id]);
    } else if (!everyTeam || a.user_id === actor.id) {
      // In the super admin's own view, "assigned to me" means them, not any
      // super admin.
      superAdminWorks.add(a.profile_id);
    }
  }

  /*
   * The teams a profile can be handed to, and who owns each one.
   *
   * Only a super admin can hand profiles over, so this is only fetched for
   * them — a subadmin would see a control they cannot use, and the function
   * would refuse it anyway.
   */
  const subadmins = everyTeam
    ? ((
        await supabase
          .from("app_user")
          .select("id, name, email")
          .eq("role", "subadmin")
          .order("name")
      ).data ?? [])
    : [];

  const teamName = new Map(subadmins.map((s) => [s.id, s.name ?? s.email]));

  const rows = (profiles.data ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    email: p.email,
    phone: p.phone,
    city: p.city,
    state: p.state,
    country: p.country,
    updated_at: p.updated_at,
    // Only whether one exists — the ciphertext never leaves the server.
    has_ssn: p.ssn_encrypted !== null,
    assignee_ids: byProfile.get(p.id) ?? [],
    super_admin_works: superAdminWorks.has(p.id),
    team_id: p.team_id,
    // Null for a team with no subadmin — the old owner's team, say, after
    // they were promoted. Shown as "unassigned" rather than as a blank.
    team_label: teamName.get(p.team_id) ?? null,
  }));

  return (
    <ProfilesList
      canCreate={canCreate}
      canEdit={canEdit}
      canAssign={canAssign}
      showAssignees={showsAssignments}
      rows={rows}
      canHandOver={everyTeam}
      canSelfAssign={canSelfAssign(actor.role)}
      subadmins={subadmins.map((sa) => ({
        id: sa.id,
        label: sa.name ?? sa.email,
      }))}
      teamMembers={(members.data ?? []).map((m) => ({
        id: m.id,
        label: m.name ?? m.email,
      }))}
    />
  );
}
