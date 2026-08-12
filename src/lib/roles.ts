/**
 * Client-safe role vocabulary and the rules built on it.
 *
 * These predicates mirror the RLS policies in supabase/migrations — they are
 * not the enforcement. Their job is to keep the UI from offering actions the
 * database will reject. If the two ever disagree, the database wins and the
 * user sees a failed write, which is the safe direction for them to disagree in.
 */

export const USER_ROLES = [
  "super_admin",
  "admin",
  "resume_builder",
  "bidder",
] as const;

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
  resume_builder: {
    label: "Resume builder",
    description:
      "Creates candidate profiles and builds resumes from them. Sees only the profiles they created.",
    color: "cyan",
  },
  bidder: {
    label: "Bidder",
    description: "Records applications. No user management.",
    color: "default",
  },
};

/**
 * The privileged roles.
 *
 * Written as a positive list rather than "not a bidder". That phrasing was
 * the same thing while bidder was the only unprivileged role, and quietly
 * stopped being so the moment a second one existed — every check spelled that
 * way would have handed the new role admin rights by default.
 */
export function isAdminRole(role: UserRole): boolean {
  return role === "admin" || role === "super_admin";
}

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
  if (role === "super_admin") return ["admin", "resume_builder", "bidder"];
  if (role === "admin") return ["resume_builder", "bidder"];
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
    return (
      !isAdminRole(target.role) && target.createdById === actor.id
    );
  }
  return false;
}

/**
 * Whether the actor may open the edit form for this account.
 *
 * Broader than canModifyUser, because it includes your own row: changing your
 * own name, email or password is not an escalation, and locking someone out of
 * their own details to protect them from themselves is the wrong trade.
 *
 * What you may change once inside is a separate question — see
 * canChangeRoleOf, which is where the escalation risk actually lives.
 */
export function canEditUser(
  actor: Actor,
  target: { id: string; role: UserRole; createdById: string | null },
): boolean {
  return actor.id === target.id || canModifyUser(actor, target);
}

/**
 * Whether the actor may set this account's role, and to what.
 *
 * Never your own: an admin promoting themselves to super admin, or the last
 * super admin demoting themselves, both leave the hierarchy in a state nobody
 * can undo. The available roles are the ones you could have created in the
 * first place — anything else would let an admin mint a peer indirectly.
 */
export function canChangeRoleOf(
  actor: Actor,
  target: { id: string; role: UserRole; createdById: string | null },
): boolean {
  return canModifyUser(actor, target) && creatableRoles(actor.role).length > 0;
}
