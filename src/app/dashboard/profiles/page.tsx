import { Alert } from "antd";

import { ProfilesList } from "@/components/profiles-list";
import { requireActor } from "@/lib/actor";
import { canRecord, teamIdFor } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Profiles" };

export default async function ProfilesPage() {
  const actor = await requireActor();

  if (!canRecord(actor)) {
    return (
      <Alert
        type="warning"
        showIcon
        message="No team"
        description="Your account isn't attached to a team, so there are no profiles to show."
      />
    );
  }

  const canEdit = actor.role !== "bidder";
  const supabase = await createClient();

  const [profiles, assignments, members] = await Promise.all([
    supabase
      .from("candidate_profile")
      // ssn_encrypted is never selected. The list only needs to know *whether*
      // one exists, which the boolean below answers without moving ciphertext.
      .select(
        "id, full_name, email, phone, city, state, country, updated_at, ssn_encrypted",
      )
      .order("full_name"),
    supabase.from("profile_assignment").select("profile_id, user_id"),
    canEdit
      ? supabase
          .from("app_user")
          .select("id, name, email, role")
          .eq("role", "bidder")
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
      teamId={teamIdFor(actor)!}
      userId={actor.id}
      canEdit={canEdit}
      rows={rows}
      teamMembers={(members.data ?? []).map((m) => ({
        id: m.id,
        label: m.name ?? m.email,
      }))}
    />
  );
}
