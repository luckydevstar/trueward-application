"use server";

import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import { canModifyUser, creatableRoles, type UserRole } from "@/lib/roles";
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
