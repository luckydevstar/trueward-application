import { notFound } from "next/navigation";

import { ProfileDetail } from "@/components/profile-detail";
import { requireActor } from "@/lib/actor";
import { canEditProfiles } from "@/lib/scope";
import { teamIdFor } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

export default async function ProfileDetailPage({
  params,
}: PageProps<"/dashboard/profiles/[id]">) {
  const { id } = await params;
  const actor = await requireActor();
  const supabase = await createClient();

  const [profile, attachments] = await Promise.all([
    supabase
      .from("candidate_profile")
      .select(
        "id, full_name, email, phone, address, city, state, postal_code, country, birthday, github_url, linkedin_url, profile, ssn_encrypted",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("profile_attachment")
      .select("id, label, file_url, file_key, file_name, file_type, created_at")
      .eq("profile_id", id)
      .order("created_at", { ascending: false }),
  ]);

  // maybeSingle(), not single(): RLS turns "a profile you aren't assigned" into
  // zero rows, and a missing row must look identical to a forbidden one or ids
  // become probeable.
  if (!profile.data) notFound();

  const { ssn_encrypted, ...row } = profile.data;

  return (
    <ProfileDetail
      profileId={row.id}
      teamId={teamIdFor(actor) ?? ""}
      userId={actor.id}
      canEdit={canEditProfiles(actor.role)}
      // The ciphertext stops here: only the boolean crosses to the client.
      row={{ ...row, has_ssn: ssn_encrypted !== null }}
      attachments={attachments.data ?? []}
    />
  );
}
