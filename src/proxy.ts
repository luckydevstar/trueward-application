import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { runGate } from "@/lib/gate";

/**
 * Paths the device gate lets through unchecked: the page that explains it, and
 * UploadThing's server-to-server callback, which carries no browser cookies
 * and authorizes uploads itself.
 */
const GATE_OPEN = (pathname: string) =>
  pathname === "/access" || pathname.startsWith("/api/uploadthing");

/**
 * Runs before every matched request. First the device gate (src/lib/gate.ts):
 * a browser that isn't approved goes no further. Then two jobs:
 *
 *  1. Refresh the Supabase session. Access tokens are short-lived, and Server
 *     Components cannot write cookies — so if the refresh didn't happen here it
 *     would have nowhere to persist, and users would be signed out whenever a
 *     token expired mid-session.
 *
 *  2. Bounce anonymous requests to /login before they reach a page.
 *
 * This is an optimistic gate, not the authorization boundary. It only reads a
 * cookie; the real boundary is RLS in Postgres, which holds even if this file
 * is deleted. Note Next 16 renamed `middleware` to `proxy` and pinned it to the
 * nodejs runtime — there is no edge option to opt into here.
 */
export async function proxy(request: NextRequest) {
  const gate = await runGate(request, GATE_OPEN);
  if (gate.blocked) return gate.blocked;

  // Must be `let`: createServerClient replaces this response when it needs to
  // write refreshed auth cookies, and the replacement is what we return.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  /**
   * getClaims(), not getUser().
   *
   * Both verify the token rather than trusting the cookie, so this is not a
   * security trade. The difference is where: with asymmetric signing keys
   * getClaims checks the signature locally through WebCrypto against a cached
   * JWKS, while getUser always calls the auth server. That call sat on the
   * critical path of every single navigation.
   *
   * It still refreshes a session that is about to expire, which is the other
   * job this proxy exists for.
   *
   * On a project still using a legacy symmetric (HS256) secret, getClaims falls
   * back to a server round trip — no worse than before, just no faster. Turning
   * on asymmetric signing keys in the Supabase dashboard is what unlocks it.
   */
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname === "/login" || pathname.startsWith("/auth") || pathname === "/access";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // So a deep link survives the round trip through the login form.
    url.searchParams.set("next", pathname);
    return gate.finish(NextResponse.redirect(url));
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return gate.finish(NextResponse.redirect(url));
  }

  // Returning `response` rather than a fresh NextResponse.next() is essential:
  // a new response would drop the refreshed cookies set above, and the session
  // would silently fail to renew.
  return gate.finish(response);
}

export const config = {
  matcher: [
    /**
     * Everything except static assets, images and the resume fonts. Auth routes are matched
     * deliberately — /auth/callback needs the cookie writer above to persist
     * the session it just exchanged a code for.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ttf|woff2?)$).*)",
  ],
};
