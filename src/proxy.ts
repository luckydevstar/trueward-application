import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every matched request. Two jobs:
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

  // getUser(), not getSession(): this call is what actually performs the
  // refresh, and it validates the token against the auth server rather than
  // trusting the cookie's contents.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname.startsWith("/auth");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // So a deep link survives the round trip through the login form.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Returning `response` rather than a fresh NextResponse.next() is essential:
  // a new response would drop the refreshed cookies set above, and the session
  // would silently fail to renew.
  return response;
}

export const config = {
  matcher: [
    /**
     * Everything except static assets and image files. Auth routes are matched
     * deliberately — /auth/callback needs the cookie writer above to persist
     * the session it just exchanged a code for.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
