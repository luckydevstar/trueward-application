"use server";

import { requireActor } from "@/lib/actor";
import { canEditProfile } from "@/lib/profile-access";
import type { ProfileRowValues } from "@/lib/profile-form";
import { canAssignProfiles, canEditProfiles, teamIdFor } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

type Result<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const ok = (): Result<undefined> => ({ ok: true, data: undefined });
const fail = (error: string): Result<never> => ({ ok: false, error });

async function editableProfile(profileId: string) {
  const actor = await requireActor();
  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from("candidate_profile")
    .select("id, team_id, created_by")
    .eq("id", profileId)
    .maybeSingle();

  if (error || !profile || !canEditProfile(actor, profile)) return null;
  return { actor, supabase, profile };
}

/** Creates a profile using the authenticated server-side actor. */
export async function createProfile(
  row: ProfileRowValues,
): Promise<Result<{ id: string }>> {
  const actor = await requireActor();
  const teamId = teamIdFor(actor);
  if (!teamId || !canEditProfiles(actor.role)) {
    return fail("You do not have permission to create profiles.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("candidate_profile")
    .insert({
      full_name: row.full_name,
      email: row.email,
      phone: row.phone,
      address: row.address,
      city: row.city,
      state: row.state,
      postal_code: row.postal_code,
      country: row.country,
      birthday: row.birthday,
      github_url: row.github_url,
      linkedin_url: row.linkedin_url,
      profile: row.profile,
      team_id: teamId,
      created_by: actor.id,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Could not create the profile.");
  return { ok: true, data };
}

/** Updates a profile only when it belongs to the server-side actor's scope. */
export async function updateProfile(
  profileId: string,
  row: ProfileRowValues,
): Promise<Result> {
  const access = await editableProfile(profileId);
  if (!access) return fail("Profile not found.");

  const { error } = await access.supabase
    .from("candidate_profile")
    .update({
      full_name: row.full_name,
      email: row.email,
      phone: row.phone,
      address: row.address,
      city: row.city,
      state: row.state,
      postal_code: row.postal_code,
      country: row.country,
      birthday: row.birthday,
      github_url: row.github_url,
      linkedin_url: row.linkedin_url,
      profile: row.profile,
    })
    .eq("id", access.profile.id)
    .eq("team_id", access.profile.team_id);

  return error ? fail(error.message) : ok();
}

/** Deletes a profile only when it belongs to the server-side actor's scope. */
export async function deleteProfile(profileId: string): Promise<Result> {
  const access = await editableProfile(profileId);
  if (!access) return fail("Profile not found.");

  const { error } = await access.supabase
    .from("candidate_profile")
    .delete()
    .eq("id", access.profile.id)
    .eq("team_id", access.profile.team_id);

  return error ? fail(error.message) : ok();
}

/** Replaces an admin-managed profile's assignment set. */
export async function replaceProfileAssignees(
  profileId: string,
  requestedUserIds: string[],
): Promise<Result> {
  const actor = await requireActor();
  const teamId = teamIdFor(actor);
  if (!teamId || !canAssignProfiles(actor.role)) {
    return fail("Only an admin can change profile assignments.");
  }

  const userIds = [...new Set(requestedUserIds)];
  const supabase = await createClient();
  const [{ data: profile }, { data: members }, { data: assignments }] =
    await Promise.all([
      supabase
        .from("candidate_profile")
        .select("id")
        .eq("id", profileId)
        .eq("team_id", teamId)
        .maybeSingle(),
      supabase
        .from("app_user")
        .select("id")
        .or(`id.eq.${teamId},created_by_id.eq.${teamId}`)
        .neq("role", "super_admin"),
      supabase
        .from("profile_assignment")
        .select("user_id")
        .eq("profile_id", profileId)
        .eq("team_id", teamId),
    ]);

  if (!profile) return fail("Profile not found.");
  const memberIds = new Set((members ?? []).map((member) => member.id));
  if (userIds.some((id) => !memberIds.has(id))) {
    return fail("Profiles can only be assigned to members of this team.");
  }

  const current = new Set((assignments ?? []).map((assignment) => assignment.user_id));
  const added = userIds.filter((id) => !current.has(id));
  const removed = [...current].filter((id) => !userIds.includes(id));

  if (added.length) {
    const { error } = await supabase.from("profile_assignment").insert(
      added.map((user_id) => ({
        profile_id: profileId,
        user_id,
        team_id: teamId,
        assigned_by: actor.id,
      })),
    );
    if (error) return fail(error.message);
  }

  if (removed.length) {
    const { error } = await supabase
      .from("profile_assignment")
      .delete()
      .eq("profile_id", profileId)
      .eq("team_id", teamId)
      .in("user_id", removed);
    if (error) return fail(error.message);
  }

  return ok();
}

type AttachmentInput = {
  label: string;
  file_key: string;
  file_url: string;
  file_name: string;
  file_type: string;
  file_size: number;
};

/** Stores uploaded-file metadata after checking that the actor may edit its profile. */
export async function addProfileAttachments(
  profileId: string,
  files: AttachmentInput[],
): Promise<Result> {
  if (!files.length) return ok();
  const access = await editableProfile(profileId);
  if (!access) return fail("Profile not found.");

  const { error } = await access.supabase.from("profile_attachment").insert(
    files.map((file) => ({
      ...file,
      profile_id: access.profile.id,
      team_id: access.profile.team_id,
      created_by: access.actor.id,
    })),
  );
  return error ? fail(error.message) : ok();
}

/** Removes attachment metadata only when its profile is editable by the actor. */
export async function deleteProfileAttachment(attachmentId: string): Promise<Result> {
  const actor = await requireActor();
  const supabase = await createClient();
  const { data: attachment } = await supabase
    .from("profile_attachment")
    .select("id, profile_id, team_id")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!attachment) return fail("Attachment not found.");

  const { data: profile } = await supabase
    .from("candidate_profile")
    .select("team_id, created_by")
    .eq("id", attachment.profile_id)
    .maybeSingle();
  if (!profile || !canEditProfile(actor, profile)) return fail("Attachment not found.");

  const { error } = await supabase
    .from("profile_attachment")
    .delete()
    .eq("id", attachment.id)
    .eq("team_id", attachment.team_id);
  return error ? fail(error.message) : ok();
}
