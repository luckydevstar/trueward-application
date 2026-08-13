import { notFound } from "next/navigation";

import { ProfileDetail } from "@/components/profile-detail";
import { requireActor } from "@/lib/actor";
import { canEditProfile, canViewProfile } from "@/lib/profile-access";
import { createClient } from "@/lib/supabase/server";

export default async function ProfileDetailPage({
  params,
}: PageProps<"/dashboard/profiles/[id]">) {
  const { id } = await params;
  const actor = await requireActor();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("candidate_profile")
    .select(
      "id, team_id, created_by, full_name, email, phone, address, city, state, postal_code, country, birthday, github_url, linkedin_url, profile, ssn_encrypted",
    )
    .eq("id", id)
    .maybeSingle();

  let isAssigned = false;
  if (profile && actor.role === "bidder") {
    const { data: assignment } = await supabase
      .from("profile_assignment")
      .select("id")
      .eq("profile_id", profile.id)
      .eq("team_id", profile.team_id)
      .eq("user_id", actor.id)
      .maybeSingle();
    isAssigned = Boolean(assignment);
  }

  // Forbidden and absent profiles are deliberately indistinguishable, so an id
  // cannot be used to probe another team or builder's candidate list.
  if (!profile || !canViewProfile(actor, profile, isAssigned)) notFound();

  const { data: attachments } = await supabase
    .from("profile_attachment")
    .select("id, label, file_url, file_key, file_name, file_type, created_at")
    .eq("profile_id", profile.id)
    .eq("team_id", profile.team_id)
    .order("created_at", { ascending: false });

  // Keep the access-control columns on the server; the client only needs the
  // profile fields it renders.
  const row = {
    id: profile.id,
    full_name: profile.full_name,
    email: profile.email,
    phone: profile.phone,
    address: profile.address,
    city: profile.city,
    state: profile.state,
    postal_code: profile.postal_code,
    country: profile.country,
    birthday: profile.birthday,
    github_url: profile.github_url,
    linkedin_url: profile.linkedin_url,
    profile: profile.profile,
  };

  return (
    <ProfileDetail
      profileId={row.id}
      canEdit={canEditProfile(actor, profile)}
      // The ciphertext stops here: only the boolean crosses to the client.
      row={{ ...row, has_ssn: profile.ssn_encrypted !== null }}
      attachments={attachments ?? []}
    />
  );
}
