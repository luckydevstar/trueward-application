import { isAdminRole, type Actor, type UserRole } from "@/lib/roles";

/**
 * Who may see and record what.
 *
 * Records belong to a *team*, identified by an admin's id:
 *   - an admin's team is their own id
 *   - a bidder's and a resume builder's team is the admin who created them
 *   - a super admin has no team; they manage accounts, not records
 *
 * Within a team, reach narrows by role:
 *   - admin           everything
 *   - bidder          applications they recorded, profiles assigned to them
 *   - resume_builder  only the profiles they created, and no applications
 *
 * The database enforces all of this through app_team_id(), app_role() and
 * can_use_profile(); this module exists so the UI can stamp new rows with the
 * right team_id and hide controls that would fail.
 */

export type Scope =
  /** Super admin: no records at all. */
  | { kind: "none" }
  /** Admin: every row in their team, and may add. */
  | { kind: "team"; adminId: string }
  /** Bidder: only their own rows, added into their admin's team. */
  | { kind: "own"; userId: string; adminId: string }
  /**
   * Someone with no admin — created out of band, or whose admin was deleted.
   * They can't record, because there'd be no team to record into.
   */
  | { kind: "orphan" };

export function scopeFor(actor: Actor): Scope {
  if (actor.role === "super_admin") return { kind: "none" };
  if (actor.role === "admin") return { kind: "team", adminId: actor.id };
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

/** Whether this actor belongs to a team at all — profiles need one. */
export function canRecord(actor: Actor): boolean {
  return teamIdFor(actor) !== null;
}

/**
 * The tracker is for people who send applications.
 *
 * A super admin manages accounts; a resume builder writes resumes. Neither has
 * a use for the applications grid, the blocklist, or the cooldown that governs
 * them, and the policies refuse both regardless.
 */
export function seesApplications(role: UserRole): boolean {
  return role === "admin" || role === "bidder";
}

/**
 * Whether the profiles and resume-builder pages are of any use to this role.
 *
 * Everyone except a super admin, who holds no team — app_team_id() is null for
 * them, so both pages would be permanently empty. Offering a dead end is worse
 * than not offering it.
 */
export function seesProfiles(role: UserRole): boolean {
  return role !== "super_admin";
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
