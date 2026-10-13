import "server-only";

import type { Actor } from "@/lib/roles";
import { isAdminRole, managesTeam } from "@/lib/roles";
import { seesAllTeams, teamIdFor } from "@/lib/scope";

/** The ownership fields required to apply the profile access rules. */
export type ProfileAccessRow = {
  team_id: string;
};

/**
 * The profile is in the actor's team, before considering their role.
 *
 * This is the TypeScript mirror of the database's `in_team()`, and it carries
 * the same super-admin branch for the same reason. A super admin has no team
 * of their own, so `teamIdFor(actor)` is null and `null === <uuid>` is false —
 * every view would be refused, with "Profile not found." as the only
 * explanation.
 *
 * For *reading*. Writing is canEditProfile(), which mirrors `in_own_team()`
 * and deliberately has no such branch.
 */
export function isInActorTeam(actor: Actor, profile: ProfileAccessRow): boolean {
  if (seesAllTeams(actor)) return true;
  return teamIdFor(actor) === profile.team_id;
}

/**
 * Whether an actor may change a profile: its own team's subadmin, and nobody
 * else. A bidder reads the profiles assigned to them; a super admin reviews.
 *
 * This is enforced by the profile server actions. It deliberately does not
 * trust an id, team id, or role sent by the browser.
 */
export function canEditProfile(actor: Actor, profile: ProfileAccessRow): boolean {
  return managesTeam(actor.role) && teamIdFor(actor) === profile.team_id;
}

/**
 * Whether an actor may read a profile. Bidders need a separate assignment
 * lookup; callers pass that result rather than allowing this helper to trust
 * a client-provided assertion.
 */
export function canViewProfile(
  actor: Actor,
  profile: ProfileAccessRow,
  isAssigned = false,
): boolean {
  if (!isInActorTeam(actor, profile)) return false;
  if (isAdminRole(actor.role)) return true;
  return actor.role === "bidder" && isAssigned;
}
