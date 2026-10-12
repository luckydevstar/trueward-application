import { isAdminRole, type Actor, type UserRole } from "@/lib/roles";

/**
 * Who may see and record what.
 *
 * Records belong to a *team*, identified by a subadmin's id:
 *   - a subadmin's team is their own id
 *   - a bidder's and a resume builder's team is the subadmin who created them
 *   - a super admin has no team, and reaches every one of them
 *
 * Within a team, reach narrows by role:
 *   - subadmin        everything in their team
 *   - bidder          applications they recorded, profiles assigned to them
 *   - resume_builder  only the profiles they created, and no applications
 *
 * The database enforces all of this through in_team(), app_role() and
 * can_use_profile(); this module exists so the UI can stamp new rows with the
 * right team_id and hide controls that would fail.
 */

export type Scope =
  /**
   * Super admin: every team's records, and no team of their own.
   *
   * Distinct from "team" rather than a team with a special id, because there
   * is no id that means "all of them" — and because the difference matters at
   * write time: reading everything is coherent, but a new row still has to
   * belong to exactly one team, which a super admin has to choose.
   */
  | { kind: "all" }
  /** Subadmin: every row in their team, and may add. */
  | { kind: "team"; adminId: string }
  /** Bidder: only their own rows, added into their admin's team. */
  | { kind: "own"; userId: string; adminId: string }
  /**
   * Someone with no admin — created out of band, or whose admin was deleted.
   * They can't record, because there'd be no team to record into.
   */
  | { kind: "orphan" };

export function scopeFor(actor: Actor): Scope {
  if (actor.role === "super_admin") return { kind: "all" };
  if (actor.role === "subadmin") return { kind: "team", adminId: actor.id };
  if (!actor.createdById) return { kind: "orphan" };
  return { kind: "own", userId: actor.id, adminId: actor.createdById };
}

/** The team a new record joins, or null if this actor may not record. */
export function teamIdFor(actor: Actor): string | null {
  const scope = scopeFor(actor);
  if (scope.kind === "team") return scope.adminId;
  if (scope.kind === "own") return scope.adminId;
  return null;
}

/**
 * Whether this actor belongs to a team at all — a new record needs one.
 *
 * False for a super admin, deliberately: they can read and fix every team's
 * rows, but a row they *created* would have no team to belong to. Creating is
 * the one thing that needs an answer to "whose?", and theirs is "everyone's",
 * which is not an answer a `team_id` column can hold.
 */
export function canRecord(actor: Actor): boolean {
  return teamIdFor(actor) !== null;
}

/** Whether this actor sees across teams rather than within one. */
export function seesAllTeams(actor: Actor): boolean {
  return scopeFor(actor).kind === "all";
}

/** Whether this actor has any reason to open the records pages. */
export function canBrowseRecords(actor: Actor): boolean {
  return canRecord(actor) || seesAllTeams(actor);
}

/**
 * The tracker is for people who send applications.
 *
 * A super admin manages accounts; a resume builder writes resumes. Neither has
 * a use for the applications grid, the blocklist, or the cooldown that governs
 * them, and the policies refuse both regardless.
 */
export function seesApplications(role: UserRole): boolean {
  return role === "subadmin" || role === "bidder" || role === "super_admin";
}

/**
 * Whether the profiles and resume-builder pages are of any use to this role.
 *
 * Everyone, now. A super admin used to be excluded because app_team_id() was
 * null for them and both pages were permanently empty — that was a symptom of
 * the gap this change closed, not a decision.
 */
export function seesProfiles(): boolean {
  return true;
}

/** Only admins route candidates to people. */
export function canAssignProfiles(role: UserRole): boolean {
  return isAdminRole(role);
}

/**
 * Whether this actor may create and edit candidate profiles.
 *
 * A bidder is deliberately absent: they write resume *content* against a
 * profile someone else owns, never the person's identity.
 */
export function canEditProfiles(role: UserRole): boolean {
  return isAdminRole(role) || role === "resume_builder";
}

/** Resume builders see only what they made, so ownership columns are noise. */
export function seesWholeTeam(role: UserRole): boolean {
  return isAdminRole(role);
}
