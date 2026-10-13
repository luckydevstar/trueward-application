import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Whether `password` is this account's current password.
 *
 * For self-service changes to the credentials themselves. The edit goes
 * through the service role, which needs no proof of anything — so without this
 * a session left open on someone's laptop, or a stolen cookie, could set a new
 * password or email and keep the account for good. Asking for the current
 * password turns a borrowed session back into a borrowed session.
 *
 * Signs in with a throwaway client that persists nothing, so the caller's own
 * session is untouched, then revokes the session that sign-in created.
 */
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  const verifier = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
  );

  const { data, error } = await verifier.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;

  // `local` ends only the session just created, not the caller's others.
  await verifier.auth.signOut({ scope: "local" });
  return true;
}
