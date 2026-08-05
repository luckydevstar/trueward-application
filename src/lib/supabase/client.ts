import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./types";

/**
 * Browser-side Supabase client. Safe to call on every render — the underlying
 * client is memoized per set of arguments, so this does not open a new
 * connection each time.
 *
 * Only ever sees the anon key, so every query it issues is subject to RLS.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
