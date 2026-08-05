import { createClient } from "@supabase/supabase-js";

import type { Database } from "./types";

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only for the one thing the anon key genuinely cannot do: creating an auth
 * user on someone else's behalf. Every caller must perform its own
 * authorization first — there is no policy underneath this to catch a mistake.
 *
 * Created per call rather than at module scope so importing this file from a
 * client component fails loudly (the env var is undefined in the browser)
 * instead of quietly shipping a service key in the bundle. The missing
 * NEXT_PUBLIC_ prefix on the key is what keeps it server-only.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — user management is disabled.",
    );
  }

  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
