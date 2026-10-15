import { notFound } from "next/navigation";

import { ProfileFormPage } from "@/components/profile-form-page";
import { requireActor } from "@/lib/actor";
import { canEditProfile, canHandleSsn } from "@/lib/profile-access";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Edit profile" };

export default async function EditProfilePage({ params }: PageProps<"/dashboard/profiles/[id]/edit">) {
  const { id } = await params;
  const actor = await requireActor();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("candidate_profile")
    .select(
      "id, team_id, full_name, email, phone, address, city, state, postal_code, country, birthday, github_url, linkedin_url, company_context, profile, ssn_encrypted",
    )
    .eq("id", id)
    .maybeSingle();

  // Absent and not-yours look the same, as on the profile page.
  if (!profile || !canEditProfile(actor, profile)) notFound();

  return (
    <ProfileFormPage
      mode="edit"
      profileId={profile.id}
      canSeeSsn={canHandleSsn(actor, profile)}
      // Only whether one exists crosses to the browser, never the ciphertext.
      hasSsn={profile.ssn_encrypted !== null}
      row={{
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
        company_context: profile.company_context,
        profile: profile.profile,
      }}
    />
  );
}
