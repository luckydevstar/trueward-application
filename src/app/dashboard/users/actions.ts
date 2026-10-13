"use server";

import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import {
  canEditUser,
  canModifyUser,
  creatableRoles,
  type UserRole,
} from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { verifyPassword } from "@/lib/supabase/verify-password";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Creates an account one layer down: a subadmin, if a super admin is asking;
 * a bidder on their own team, if a subadmin is.
 *
 * Runs with the service-role key, so RLS is not in the loop — every check here
 * is the only check. The actor is re-read from the session rather than taken
 * from the caller's arguments, because arguments to a Server Action are
 * attacker-controlled.
 */
export async function createUser(input: {
  email: string;
  password: string;
  name: string;
  role: UserRole;
}): Promise<ActionResult> {
  const actor = await requireActor();

  if (!creatableRoles(actor.role).includes(input.role)) {
    return { ok: false, error: `You can't create a ${input.role}.` };
  }
  if (input.password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email: input.email.trim(),
    password: input.password,
    // Admin-created accounts skip the confirmation email — the admin already
    // vouched for the address by typing it.
    email_confirm: true,
    user_metadata: { name: input.name.trim() },
  });

  if (error || !data.user) {
    return { ok: false, error: error?.message ?? "Could not create the user." };
  }

  // The handle_new_user trigger has already inserted the app_user row with the
  // default 'bidder' role and no creator. Stamping both here is what places a
  // bidder on the actor's team — and records which super admin added a
  // subadmin, whose own team is simply their id.
  const { error: updateError } = await admin
    .from("app_user")
    .update({ role: input.role, created_by_id: actor.id })
    .eq("id", data.user.id);

  if (updateError) {
    // Roll back the auth user, or the address is taken by an account that can
    // never be finished.
    await admin.auth.admin.deleteUser(data.user.id);
    return { ok: false, error: updateError.message };
  }

  revalidatePath("/dashboard/users");
  return { ok: true };
}

/**
 * Updates an account's name, email, password or style allowances.
 *
 * Every field is authorized separately, and all of it server-side. Arguments to
 * a Server Action are attacker-controlled, so the actor is re-read from the
 * session and the target is re-read through the *user-scoped* client — an id
 * outside the caller's visibility simply isn't found rather than being
 * editable.
 *
 * Roles never change here. Each actor creates exactly one role, so there is
 * nothing to move an account to that would not also move it out of its
 * manager's reach.
 *
 * Changing your *own* email or password asks for your current one. Whoever
 * manages an account resets it without — that is what managing it means, and
 * the person whose password it is was never in that conversation.
 */
export async function updateUser(input: {
  id: string;
  name?: string;
  email?: string;
  password?: string;
  currentPassword?: string;
  allowedTemplates?: string[];
  allowedAccents?: string[];
}): Promise<ActionResult> {
  const actor = await requireActor();

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("app_user")
    .select("id, email, role, created_by_id")
    .eq("id", input.id)
    .maybeSingle();

  if (!target) return { ok: false, error: "User not found." };

  const asTarget = {
    id: target.id,
    role: target.role,
    createdById: target.created_by_id,
  };

  if (!canEditUser(actor, asTarget)) {
    return { ok: false, error: "You can't edit this account." };
  }

  if (input.password !== undefined && input.password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (input.email !== undefined && !input.email.includes("@")) {
    return { ok: false, error: "That doesn't look like an email." };
  }

  const email = input.email?.trim();
  const emailChanged = email !== undefined && email !== target.email;
  const passwordChanged = input.password !== undefined;

  if (actor.id === target.id && (emailChanged || passwordChanged)) {
    if (!input.currentPassword) {
      return {
        ok: false,
        error: "Enter your current password to change your email or password.",
      };
    }
    if (!(await verifyPassword(actor.email, input.currentPassword))) {
      return { ok: false, error: "Your current password isn't right." };
    }
  }

  const admin = createAdminClient();

  // auth.users first: it owns the credential, and a failure there must not
  // leave app_user claiming an email the person cannot sign in with.
  const authPatch: {
    email?: string;
    password?: string;
    user_metadata?: { name: string };
  } = {};
  if (emailChanged) authPatch.email = email;
  if (passwordChanged) authPatch.password = input.password;
  if (input.name !== undefined) authPatch.user_metadata = { name: input.name.trim() };

  if (Object.keys(authPatch).length) {
    const { error } = await admin.auth.admin.updateUserById(input.id, authPatch);
    if (error) return { ok: false, error: error.message };
  }

  // app_user mirrors auth.users, and only the signup trigger keeps them in
  // step — it fires on insert, never on update. Without this the list would go
  // on showing the old email indefinitely.
  const rowPatch: {
    name?: string;
    email?: string;
    allowed_templates?: string[] | null;
    allowed_accents?: string[] | null;
  } = {};
  if (input.name !== undefined) rowPatch.name = input.name.trim();
  if (emailChanged) rowPatch.email = email;

  // Style allowances are set by whoever manages the account, and only over
  // someone else — there is no reason to restrict your own palette, and
  // letting you do it invites locking yourself out of a template you then
  // cannot restore.
  if (canModifyUser(actor, asTarget)) {
    // Empty means "everything", stored as null rather than an empty array so
    // the fallback in style-access.ts can tell them apart.
    if (input.allowedTemplates !== undefined) {
      rowPatch.allowed_templates = input.allowedTemplates.length
        ? input.allowedTemplates
        : null;
    }
    if (input.allowedAccents !== undefined) {
      rowPatch.allowed_accents = input.allowedAccents.length
        ? input.allowedAccents
        : null;
    }
  }

  if (Object.keys(rowPatch).length) {
    const { error } = await admin.from("app_user").update(rowPatch).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/dashboard/users");
  return { ok: true };
}

/**
 * Removes an account.
 *
 * A bidder goes on their own: their applications and resumes stay with the
 * team, their assignments go with them.
 *
 * A subadmin is a team, and every team_id foreign key cascades from their
 * account — deleting it outright would delete every profile, resume and
 * application the team ever recorded. So a subadmin with anything on their
 * team is first handed to `inheritorId`, another subadmin, by
 * transfer_team(); only then is the account deleted, by which point the
 * cascade has nothing to take. A subadmin with an empty team can go without
 * one.
 *
 * The transfer and the delete are two steps, not one transaction: the delete
 * is an Auth API call. If it fails after the transfer, the old subadmin is
 * left with an empty team — harmless, and the same button finishes the job.
 */
export async function deleteUser(
  targetId: string,
  inheritorId?: string,
): Promise<ActionResult> {
  const actor = await requireActor();

  // Read the target through the *user-scoped* client, so an id outside the
  // actor's visibility simply isn't found rather than being deletable.
  const supabase = await createClient();
  const { data: target } = await supabase
    .from("app_user")
    .select("id, role, created_by_id")
    .eq("id", targetId)
    .maybeSingle();

  if (!target) return { ok: false, error: "User not found." };

  if (
    !canModifyUser(actor, {
      id: target.id,
      role: target.role,
      createdById: target.created_by_id,
    })
  ) {
    return { ok: false, error: "You can't remove this account." };
  }

  if (target.role === "subadmin") {
    if (inheritorId) {
      if (inheritorId === target.id) {
        return { ok: false, error: "Choose a different subadmin to take over." };
      }
      // The function re-checks everything — super admin, both ends subadmins —
      // and moves the team in one transaction.
      const { error } = await supabase.rpc("transfer_team", {
        from_team: target.id,
        to_team: inheritorId,
      });
      if (error) return { ok: false, error: error.message };
    } else if (await teamHasRecords(supabase, target.id)) {
      return {
        ok: false,
        error:
          "This subadmin's team still has users or records. Choose a subadmin to take them over first.",
      };
    }
  }

  // Deleting from auth.users cascades to app_user via the foreign key.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(targetId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/users");
  revalidatePath("/dashboard/profiles");
  return { ok: true };
}

/**
 * Whether deleting this subadmin outright would take anything with it.
 *
 * Counted through the caller's own client: only a super admin gets here, and
 * in_team() lets them read every team, so a zero is a real zero rather than
 * "nothing you can see". Each count is a HEAD request — no rows move.
 */
async function teamHasRecords(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teamId: string,
): Promise<boolean> {
  const counts = await Promise.all([
    supabase.from("app_user").select("id", { count: "exact", head: true }).eq("created_by_id", teamId),
    supabase.from("candidate_profile").select("id", { count: "exact", head: true }).eq("team_id", teamId),
    supabase.from("application").select("id", { count: "exact", head: true }).eq("team_id", teamId),
    supabase.from("resume_document").select("id", { count: "exact", head: true }).eq("team_id", teamId),
    supabase.from("blocked_company").select("id", { count: "exact", head: true }).eq("team_id", teamId),
  ]);

  // A failed count is treated as "has records": refusing a delete that would
  // have been safe costs a retry, the opposite costs a team's data.
  return counts.some(({ count, error }) => error !== null || (count ?? 0) > 0);
}
