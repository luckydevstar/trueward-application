import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./types";

/**
 * Server-side Supabase client, bound to the request's cookies so it acts as the
 * signed-in user rather than anonymously.
 *
 * Must be created per request and never hoisted into a module-level constant:
 * `cookies()` is request-scoped, so a shared client would serve one user's
 * session to everyone.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components can read cookies but not write them. Supabase
            // tries to write here when it refreshes an expiring token; the
            // proxy does the same refresh on every request and *can* write, so
            // swallowing this is correct rather than merely convenient.
          }
        },
      },
    },
  );
}

/**
 * The signed-in user, or null. Uses getUser() rather than getSession(): the
 * session is read straight from the cookie and is therefore spoofable, while
 * getUser() revalidates the JWT against the Supabase Auth server.
 */
export async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
