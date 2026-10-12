import { Alert } from "antd";

import { ProfilesList } from "@/components/profiles-list";
import { requireActor } from "@/lib/actor";
import { profileReach, scopeToReach } from "@/lib/profile-scope";
import {
  canAssignProfiles,
  canBrowseRecords,
  canEditProfiles,
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

  // A builder creates and edits their own; only an admin routes them to people.
  const canEdit = canEditProfiles(actor.role);
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

  const [profiles, assignments, members] = await Promise.all([
    scopeToReach(
      (() => {
        const query = supabase
          .from("candidate_profile")
          // ssn_encrypted is never selected. The list only needs to know
          // *whether* one exists, which the boolean below answers without
          // moving ciphertext.
          .select(
            "id, full_name, email, phone, city, state, country, updated_at, ssn_encrypted",
          )
          .order("full_name");
        return everyTeam ? query : query.eq("team_id", teamId);
      })(),
      reach,
      "id",
    ),
    canAssign
      ? (() => {
          const query = supabase
            .from("profile_assignment")
            .select("profile_id, user_id");
          return everyTeam ? query : query.eq("team_id", teamId);
        })()
      : Promise.resolve({ data: [] as never[] }),
    // Every team member, not just bidders. A member is either the team's admin
    // or an account created by that admin; super admins have no team.
    canAssign
      ? (() => {
          const query = supabase
            .from("app_user")
            .select("id, name, email, role")
            .neq("role", "super_admin")
            .order("name");
          // A subadmin's team is themselves plus the accounts they created.
          // A super admin assigns across every team, so there is nobody to
          // exclude.
          return everyTeam
            ? query
            : query.or(`id.eq.${teamId},created_by_id.eq.${teamId}`);
        })()
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const byProfile = new Map<string, string[]>();
  for (const a of assignments.data ?? []) {
    byProfile.set(a.profile_id, [...(byProfile.get(a.profile_id) ?? []), a.user_id]);
  }

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
  }));

  return (
    <ProfilesList
      canEdit={canEdit}
      canAssign={canAssign}
      rows={rows}
      teamMembers={(members.data ?? []).map((m) => ({
        id: m.id,
        label: `${m.name ?? m.email}${m.role === "subadmin" ? " (subadmin)" : ""}`,
      }))}
    />
  );
}
