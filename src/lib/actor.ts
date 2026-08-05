import { redirect } from "next/navigation";

import type { Actor } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user as the app's `Actor` — id, role, and who created them,
 * which is everything scope.ts needs.
 *
 * Redirects rather than returning null. Every dashboard route needs an actor,
 * so returning null would only push an identical `if (!actor) redirect(...)`
 * into each of them, and forgetting one would render a page with no scope.
 */
export async function requireActor(): Promise<Actor & { email: string; name: string | null }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("app_user")
    .select("id, email, name, role, created_by_id")
    .eq("id", user.id)
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
  };
}
