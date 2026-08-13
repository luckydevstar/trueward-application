import { Alert } from "antd";

import { ProfilesList } from "@/components/profiles-list";
import { requireActor } from "@/lib/actor";
import { canAssignProfiles, canEditProfiles, canRecord, teamIdFor } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Profiles" };

export default async function ProfilesPage() {
  const actor = await requireActor();

  if (!canRecord(actor)) {
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
  const teamId = teamIdFor(actor)!;
  const supabase = await createClient();

  /**
   * RLS is intentionally disabled in this deployment, so this query carries
   * the same team/ownership restriction in application code. In particular a
   * resume builder must never receive another builder's profile in the page
   * payload.
   */
  let profileQuery = supabase
    .from("candidate_profile")
    // ssn_encrypted is never selected. The list only needs to know *whether*
    // one exists, which the boolean below answers without moving ciphertext.
    .select(
      "id, full_name, email, phone, city, state, country, updated_at, ssn_encrypted",
    )
    .eq("team_id", teamId)
    .order("full_name");

  if (actor.role === "resume_builder") {
    profileQuery = profileQuery.eq("created_by", actor.id);
  } else if (actor.role === "bidder") {
    const { data: assignments } = await supabase
      .from("profile_assignment")
      .select("profile_id")
      .eq("team_id", teamId)
      .eq("user_id", actor.id);
    const assignedIds = (assignments ?? []).map((assignment) => assignment.profile_id);
    if (!assignedIds.length) profileQuery = profileQuery.in("id", ["00000000-0000-0000-0000-000000000000"]);
    else profileQuery = profileQuery.in("id", assignedIds);
  }

  const [profiles, assignments, members] = await Promise.all([
    profileQuery,
    canAssign
      ? supabase
          .from("profile_assignment")
          .select("profile_id, user_id")
          .eq("team_id", teamId)
      : Promise.resolve({ data: [] as never[] }),
    // Every team member, not just bidders. A member is either the team's admin
    // or an account created by that admin; super admins have no team.
    canAssign
      ? supabase
          .from("app_user")
          .select("id, name, email, role")
          .or(`id.eq.${teamId},created_by_id.eq.${teamId}`)
          .neq("role", "super_admin")
          .order("name")
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
        label: `${m.name ?? m.email}${m.role === "admin" ? " (admin)" : ""}`,
      }))}
    />
  );
}
