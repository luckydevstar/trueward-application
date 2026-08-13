"use server";

import { requireActor } from "@/lib/actor";
import { canEditProfile } from "@/lib/profile-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type SsnResult =
  | { ok: true; ssn: string | null }
  | { ok: false; error: string };

/**
 * The symmetric key for SSN encryption.
 *
 * Server-only and never persisted: it is not in the database, so a dump of
 * candidate_profile yields ciphertext alone. Losing it means losing every
 * stored SSN — that is the intended trade, and it should be backed up wherever
 * you keep other break-glass secrets.
 */
function encryptionKey(): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    throw new Error(
      "APP_ENCRYPTION_KEY must be set to at least 16 characters for SSN storage.",
    );
  }
  return key;
}

/**
 * Decrypts a candidate's SSN and records that it happened.
 *
 * Two independent gates, because either alone is insufficient:
 *
 *  1. The actor must be an admin, or the resume builder who owns this profile.
 *  2. The profile must be in that actor's team. These are checked here because
 *     this deployment intentionally has RLS disabled.
 *
 * Every successful reveal writes to ssn_access_log, which has no update or
 * delete policy — the trail cannot be edited from the app.
 */
export async function revealSsn(profileId: string): Promise<SsnResult> {
  const actor = await requireActor();

  if (actor.role === "bidder" || actor.role === "super_admin") {
    return { ok: false, error: "Only admins can reveal a Social Security number." };
  }

  const supabase = await createClient();

  // Gate 2: prove the caller may edit this row before decrypting anything.
  const { data: visible } = await supabase
    .from("candidate_profile")
    .select("id, team_id, created_by")
    .eq("id", profileId)
    .maybeSingle();

  if (!visible || !canEditProfile(actor, visible)) {
    return { ok: false, error: "Profile not found." };
  }

  let key: string;
  try {
    key = encryptionKey();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Encryption is not configured.",
    };
  }

  // The decrypt itself needs the service-role client: ssn_encrypted is typed
  // out of the public surface, and the RPC runs the pgcrypto function with a
  // key that must never travel to the browser. The row was already authorized
  // above, so this widens nothing.
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reveal_ssn", {
    target: profileId,
    key,
  });

  if (error) return { ok: false, error: error.message };

  // The server already checked actor and team before writing the audit entry.
  await supabase.from("ssn_access_log").insert({
    profile_id: profileId,
    actor_id: actor.id,
    team_id: visible.team_id,
  });

  return { ok: true, ssn: data ?? null };
}

/**
 * Stores an SSN, encrypted. Passing an empty value clears it.
 *
 * Separate from the ordinary profile update so the plaintext has exactly one
 * entry point into the system, and so a routine edit of someone's phone number
 * cannot accidentally carry an SSN in its payload.
 */
export async function setSsn(
  profileId: string,
  plain: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireActor();

  if (actor.role === "bidder" || actor.role === "super_admin") {
    return { ok: false, error: "Only admins can set a Social Security number." };
  }

  const digits = plain.replace(/\D/g, "");
  if (digits && digits.length !== 9) {
    return { ok: false, error: "A Social Security number has 9 digits." };
  }

  const supabase = await createClient();
  const { data: visible } = await supabase
    .from("candidate_profile")
    .select("id, team_id, created_by")
    .eq("id", profileId)
    .maybeSingle();

  if (!visible || !canEditProfile(actor, visible)) {
    return { ok: false, error: "Profile not found." };
  }

  let key: string;
  try {
    key = encryptionKey();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Encryption is not configured.",
    };
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("store_ssn", {
    target: profileId,
    plain: digits,
    key,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
