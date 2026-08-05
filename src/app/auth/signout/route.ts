import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * POST, not GET: a GET sign-out can be triggered by any `<img>` or prefetch
 * pointing at this URL, which turns into a cross-site logout.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), {
    // 303 so the browser follows with GET; a plain redirect from a POST would
    // re-POST to /login.
    status: 303,
  });
}
