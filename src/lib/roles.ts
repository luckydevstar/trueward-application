/**
 * Client-safe role vocabulary and the rules built on it.
 *
 * These predicates mirror the RLS policies in supabase/migrations — they are
 * not the enforcement. Their job is to keep the UI from offering actions the
 * database will reject. If the two ever disagree, the database wins and the
 * user sees a failed write, which is the safe direction for them to disagree in.
 */

export const USER_ROLES = ["super_admin", "admin", "bidder"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_META: Record<
  UserRole,
  { label: string; description: string; color: string }
> = {
  super_admin: {
    label: "Super admin",
    description: "Manages everyone. Can create admins and bidders.",
    color: "purple",
  },
  admin: {
    label: "Admin",
    description: "Can create and manage bidders they add.",
    color: "blue",
  },
  bidder: {
    label: "Bidder",
    description: "Records applications. No user management.",
    color: "default",
  },
};

export type Actor = {
  id: string;
  role: UserRole;
  createdById: string | null;
};

/** Only these two ever reach the Users page. */
export function canManageUsers(role: UserRole): boolean {
  return role === "super_admin" || role === "admin";
}

/**
 * Which roles an actor may hand out.
 *
 * A super admin can mint admins and bidders. An admin can only mint bidders —
 * otherwise any admin could promote a peer (or themselves via a second
 * account) and the hierarchy would be decorative.
 */
export function creatableRoles(role: UserRole): UserRole[] {
  if (role === "super_admin") return ["admin", "bidder"];
  if (role === "admin") return ["bidder"];
  return [];
}

/**
 * Whether an actor may delete a target or change its role.
 *
 * You may act on an account you could have created; admins only on the bidders
 * they actually created.
 *
 * Never on yourself: deleting your own account signs you out mid-session, and
 * the last super admin demoting themselves would leave nobody able to appoint
 * a replacement.
 */
export function canModifyUser(
  actor: Actor,
  target: { id: string; role: UserRole; createdById: string | null },
): boolean {
  if (actor.id === target.id) return false;
  if (actor.role === "super_admin") return true;
  if (actor.role === "admin") {
    return target.role === "bidder" && target.createdById === actor.id;
  }
  return false;
}
