import "server-only";

import type { Actor } from "@/lib/roles";
import { isAdminRole } from "@/lib/roles";
import { teamIdFor } from "@/lib/scope";

/** The ownership fields required to apply the profile access rules. */
export type ProfileAccessRow = {
  team_id: string;
  created_by: string | null;
};

/** The profile is in the actor's team, before considering their role. */
export function isInActorTeam(actor: Actor, profile: ProfileAccessRow): boolean {
  return teamIdFor(actor) === profile.team_id;
}

/**
 * Whether an actor may change a profile.
 *
 * This is enforced by the profile server actions. It deliberately does not
 * trust an id, team id, or role sent by the browser.
 */
export function canEditProfile(actor: Actor, profile: ProfileAccessRow): boolean {
  if (!isInActorTeam(actor, profile)) return false;
  return (
    isAdminRole(actor.role) ||
    (actor.role === "resume_builder" && profile.created_by === actor.id)
  );
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
  if (actor.role === "resume_builder") return profile.created_by === actor.id;
  return actor.role === "bidder" && isAssigned;
}
