import { managesTeam, type Actor, type UserRole } from "@/lib/roles";

/**
 * Who may see and record what.
 *
 * Records belong to a *team*, identified by a subadmin's id:
 *   - a subadmin's team is their own id
 *   - a bidder's team is the subadmin who created them
 *   - a super admin has no team, and reviews every one of them
 *
 * Within a team, reach narrows by role:
 *   - subadmin  everything in their team, and the only one who changes it
 *   - bidder    the profiles assigned to them (read-only), the applications
 *               and resumes they record against those
 *
 * The database enforces all of this through in_team(), in_own_team(),
 * is_subadmin() and can_use_profile(); this module exists so the UI can stamp
 * new rows with the right team_id and hide controls that would fail.
 */

export type Scope =
  /**
   * Super admin: every team's records, and no team of their own.
   *
   * Distinct from "team" rather than a team with a special id, because there
   * is no id that means "all of them" — and because the difference matters at
   * write time: a new row has to belong to exactly one team, which is why a
   * super admin reviews rather than records.
   */
  | { kind: "all" }
  /** Subadmin: every row in their team, and may add. */
  | { kind: "team"; adminId: string }
  /** Bidder: their own rows, for assigned profiles, in their subadmin's team. */
  | { kind: "own"; userId: string; adminId: string }
  /**
   * Someone with no subadmin — created out of band, or signed up on their own.
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
 * False for a super admin, deliberately: a row they created would have no team
 * to belong to, and the policies' in_own_team() refuses it for the same
 * reason.
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

/** Only the subadmin routes candidates to people. */
export function canAssignProfiles(role: UserRole): boolean {
  return managesTeam(role);
}

/**
 * Whether this actor may take a profile on themselves and work it like a
 * bidder: generate, save resumes, record applications.
 *
 * The super admin only. They have no team, so what they write joins the
 * profile's team — see works_in_team() in supabase/schema/02_functions.sql.
 */
export function canSelfAssign(role: UserRole): boolean {
  return role === "super_admin";
}

/**
 * Whether this actor may create and edit candidate profiles.
 *
 * A bidder is deliberately absent: they write resume *content* against a
 * profile their subadmin keeps, never the person's identity. A super admin is
 * absent because they review.
 */
export function canEditProfiles(role: UserRole): boolean {
  return managesTeam(role);
}
