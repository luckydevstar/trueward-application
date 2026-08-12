import { redirect } from "next/navigation";
import { cache } from "react";

import type { Actor } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user as the app's `Actor` — id, role, and who created them,
 * which is everything scope.ts needs.
 *
 * Redirects rather than returning null. Every dashboard route needs an actor,
 * so returning null would only push an identical `if (!actor) redirect(...)`
 * into each of them, and forgetting one would render a page with no scope.
 *
 * Memoised per request with React's cache(). The dashboard layout and the page
 * inside it both need an actor, and each call was two sequential network round
 * trips — validating the JWT against the auth server, then reading app_user.
 * Deduplicating them halves the auth latency of every navigation.
 *
 * cache() is per-request, so this never leaks one user's actor into another's
 * request the way a module-level variable would.
 */
export type CurrentActor = Actor & {
  email: string;
  name: string | null;
  /** Null means "use the role default" — see src/lib/style-access.ts. */
  allowedTemplates: string[] | null;
  allowedAccents: string[] | null;
};

export const requireActor = cache(async (): Promise<CurrentActor> => {
  const supabase = await createClient();

  // getClaims() verifies the JWT's signature the same way getUser() does, but
  // does it locally against a cached JWKS when the project signs
  // asymmetrically. All this needs from it is `sub`, so paying a round trip to
  // the auth server for the rest of the user record was waste on every page.
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  const { data } = await supabase
    .from("app_user")
    .select(
      "id, email, name, role, created_by_id, allowed_templates, allowed_accents",
    )
    .eq("id", userId)
    .single();

  // No app_user row means the handle_new_user trigger didn't fire — an account
  // created before the migration, or a failed signup. Signing them out is
  // better than rendering a dashboard with no team, where every write would
  // fail RLS for reasons the UI couldn't explain.
  if (!data) redirect("/auth/orphaned");

  return {
    id: data.id,
    email: data.email,
    name: data.name,
    role: data.role,
    createdById: data.created_by_id,
    allowedTemplates: data.allowed_templates,
    allowedAccents: data.allowed_accents,
  };
});
