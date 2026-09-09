import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";
import type { Actor } from "@/lib/roles";
import { isAdminRole } from "@/lib/roles";

/**
 * Which candidate profiles an actor may work with.
 *
 * This mirrors `can_use_profile()` in supabase/schema/02_functions.sql:
 *
 *   admin           every profile on the team
 *   resume_builder  the ones they created
 *   bidder          the ones assigned to them, and nothing else
 *   super_admin     none — they hold no team
 *
 * RLS remains the boundary. This exists because a *page payload* is worth
 * scoping too: every page that lists profiles was already doing it, and the
 * resume builder page did it for builders and forgot bidders, so a bidder's
 * profile dropdown offered the whole team's candidates. One rule written twice
 * is one rule that drifts; this is the one copy.
 *
 * Anything reading it must still assume the database will refuse a row it
 * shouldn't have — see CLAUDE.md.
 */
export type ProfileReach =
  /** Admins: no narrowing beyond team_id. */
  | { kind: "team" }
  /**
   * Everyone else: an explicit set of profile ids.
   *
   * An id list rather than a per-role column filter so the same value scopes
   * `candidate_profile.id` and `resume_document.profile_id` — which is what
   * the policies do (both go through `can_use_profile`), and what the previous
   * split of `created_by` here and `profile_id` there could not guarantee.
   */
  | { kind: "listed"; profileIds: string[] };

/**
 * A PostgREST query, reduced to the two methods this applies.
 *
 * Structural rather than the real `PostgrestFilterBuilder`, whose generics
 * differ per `.select()` and would force every caller to name its row type.
 */
type Filterable<T> = {
  eq(column: string, value: string): T;
  in(column: string, values: readonly string[]): T;
};

/** No profile has this id, so an empty reach matches nothing. */
const MATCHES_NOTHING = "00000000-0000-0000-0000-000000000000";

/**
 * Resolves what this actor can reach, reading assignments where the answer
 * isn't derivable from the role alone.
 *
 * Costs one small indexed query for a builder or a bidder and none for an
 * admin, which is the trade for the two lists being provably the same set.
 */
export async function profileReach(
  supabase: SupabaseClient<Database>,
  actor: Actor,
  teamId: string,
): Promise<ProfileReach> {
  // Before the admin check, because isAdminRole() counts a super admin as one.
  // They hold no team, so "every profile on the team" has no team to mean —
  // both callers bail out before this on canRecord(), but a function that is
  // only safe because of what its callers happen to check is not safe.
  if (actor.role === "super_admin") return { kind: "listed", profileIds: [] };

  if (isAdminRole(actor.role)) return { kind: "team" };

  if (actor.role === "resume_builder") {
    const { data } = await supabase
      .from("candidate_profile")
      .select("id")
      .eq("team_id", teamId)
      .eq("created_by", actor.id);
    return { kind: "listed", profileIds: (data ?? []).map((row) => row.id) };
  }

  if (actor.role === "bidder") {
    const { data } = await supabase
      .from("profile_assignment")
      .select("profile_id")
      .eq("team_id", teamId)
      .eq("user_id", actor.id);
    return {
      kind: "listed",
      profileIds: (data ?? []).map((row) => row.profile_id),
    };
  }

  // A role added later with no rule here. Nothing, rather than everything: a
  // new role should have to be granted reach deliberately.
  return { kind: "listed", profileIds: [] };
}

/**
 * Narrows a query to the profiles in `reach`.
 *
 * `column` is where the profile id lives: `id` on candidate_profile,
 * `profile_id` on resume_document, application and profile_attachment.
 */
export function scopeToReach<T extends Filterable<T>>(
  query: T,
  reach: ProfileReach,
  column: "id" | "profile_id",
): T {
  if (reach.kind === "team") return query;
  // A literal `.in(column, [])` is an empty PostgREST list, which is worth not
  // depending on. The sentinel says "match nothing" unambiguously.
  return query.in(
    column,
    reach.profileIds.length ? reach.profileIds : [MATCHES_NOTHING],
  );
}
