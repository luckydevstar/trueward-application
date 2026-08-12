"use server";

import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import {
  canChangeRoleOf,
  canEditUser,
  canModifyUser,
  creatableRoles,
  type UserRole,
} from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Creates a team member.
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
    email: input.email,
    password: input.password,
    // Admin-created accounts skip the confirmation email — the admin already
    // vouched for the address by typing it.
    email_confirm: true,
    user_metadata: { name: input.name },
  });

  if (error || !data.user) {
    return { ok: false, error: error?.message ?? "Could not create the user." };
  }

  // The handle_new_user trigger has already inserted the app_user row with the
  // default 'bidder' role and no creator. Stamping both here is what places the
  // new account on the actor's team — without it they'd be an orphan who can
  // sign in but has no team to record into.
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
 * Updates an account's name, email, password or role.
 *
 * Every field is authorized separately, and all of it server-side. Arguments to
 * a Server Action are attacker-controlled, so the actor is re-read from the
 * session and the target is re-read through the *user-scoped* client — an id
 * outside the caller's visibility simply isn't found rather than being
 * editable.
 *
 * The split that matters: you may always edit your own name, email and
 * password, but never your own role. Self-service details are not an
 * escalation; self-promotion is.
 */
export async function updateUser(input: {
  id: string;
  name?: string;
  email?: string;
  password?: string;
  role?: UserRole;
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

  // Only treated as a role change when it actually differs, so submitting the
  // form unchanged doesn't trip the self-promotion guard on your own row.
  const roleChanged = input.role !== undefined && input.role !== target.role;
  if (roleChanged) {
    if (!canChangeRoleOf(actor, asTarget)) {
      return { ok: false, error: "You can't change this account's role." };
    }
    if (!creatableRoles(actor.role).includes(input.role!)) {
      return { ok: false, error: `You can't assign the ${input.role} role.` };
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
  if (input.email !== undefined) authPatch.email = input.email.trim();
  if (input.password !== undefined) authPatch.password = input.password;
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
    role?: UserRole;
    allowed_templates?: string[] | null;
    allowed_accents?: string[] | null;
  } = {};
  if (input.name !== undefined) rowPatch.name = input.name.trim();
  if (input.email !== undefined) rowPatch.email = input.email.trim();
  if (roleChanged) rowPatch.role = input.role;

  // Style allowances are an admin's to set, and only over someone else — there
  // is no reason to restrict your own palette, and letting you do it invites
  // locking yourself out of a template you then cannot restore.
  if (canModifyUser(actor, asTarget)) {
    // Empty means "back to the role default", stored as null rather than an
    // empty array so the fallback in style-access.ts can tell them apart.
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

export async function deleteUser(targetId: string): Promise<ActionResult> {
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

  // Deleting from auth.users cascades to app_user via the foreign key.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(targetId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/users");
  return { ok: true };
}
