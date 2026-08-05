import type { Actor } from "@/lib/roles";

/**
 * Who may see and record what.
 *
 * Records belong to a *team*, identified by an admin's id:
 *   - an admin's team is their own id
 *   - a bidder's team is the admin who created them
 *   - a super admin has no team; they manage accounts, not records
 *
 * Visibility is narrower than ownership: an admin sees their whole team, but a
 * bidder sees only the rows they recorded themselves.
 *
 * The database enforces all of this through app_team_id() and app_role(); this
 * module exists so the UI can stamp new rows with the right team_id and hide
 * controls that would fail.
 */

export type Scope =
  /** Super admin: no records at all. */
  | { kind: "none" }
  /** Admin: every row in their team, and may add. */
  | { kind: "team"; adminId: string }
  /** Bidder: only their own rows, added into their admin's team. */
  | { kind: "own"; userId: string; adminId: string }
  /**
   * A bidder with no admin — created out of band, or whose admin was deleted.
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

export function canRecord(actor: Actor): boolean {
  return teamIdFor(actor) !== null;
}

/** Super admins land on Users; the applications view isn't theirs. */
export function seesApplications(role: Actor["role"]): boolean {
  return role !== "super_admin";
}
