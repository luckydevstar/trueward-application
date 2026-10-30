import "server-only";

import { fail, fetchTokens, tokenResponse } from "@/lib/ext-http";
import { isAdminRole } from "@/lib/roles";
import { tokenClient } from "@/lib/supabase/request";

/**
 * The desktop clock (trueward-clock) signs in with an admin's email and
 * password, nothing more: its routes, /api/clock/*, are outside the device
 * gate (proxy.ts), so the clock is never a device to approve. In exchange
 * they serve admins only — the super admin and subadmins — checked at
 * sign-in, at every renewal, and on every question.
 *
 * That doesn't open the data any wider. The token is the admin's own, RLS
 * still decides what it reads, and Supabase's sign-in is reachable without
 * the gate anyway — the anon key ships in the site's scripts.
 */

export const ADMINS_ONLY = "The clock is for admins. Sign in with a super admin or subadmin account.";

/** Signs a session out on Supabase, so a refused one can't be renewed either. */
async function endSession(accessToken: string) {
  await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/logout?scope=local`, {
    method: "POST",
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  }).catch(() => null);
}

/** Signs an admin in, or renews their session; anyone else's is ended on the spot. */
export async function adminTokens(grant: "password" | "refresh_token", payload: Record<string, string>) {
  const result = await fetchTokens(grant, payload);
  if (!result.ok) return fail(result.error, 401);
  const { tokens } = result;

  const db = tokenClient(tokens.access_token);
  const { data: auth } = await db.auth.getClaims(tokens.access_token);
  const userId = auth?.claims?.sub;
  const { data: user } = userId
    ? await db.from("app_user").select("role").eq("id", userId).maybeSingle()
    : { data: null };
  if (user && isAdminRole(user.role)) return tokenResponse(tokens);

  await endSession(tokens.access_token);
  return fail(ADMINS_ONLY, 403);
}
