/**
 * Client-safe role vocabulary and the rules built on it.
 *
 * These predicates mirror the RLS policies in supabase/schema — they are not
 * the enforcement. Their job is to keep the UI from offering actions the
 * database will reject. If the two ever disagree, the database wins and the
 * user sees a failed write, which is the safe direction for them to disagree in.
 */

/**
 * Three roles, one per layer:
 *
 *   super_admin  runs the platform: adds and manages subadmins, reviews every
 *                team's work, changes none of it
 *   subadmin     runs one team: its profiles, its bidders, and who works which
 *                candidate
 *   bidder       works the profiles their subadmin assigns them — records
 *                applications and builds resumes, reads the profile itself
 *
 * `resume_builder` existed once. The database still knows the enum value
 * (Postgres cannot drop one) but a constraint refuses it, and every account
 * that held it was converted to a bidder — see 01_tables.sql.
 */
export const USER_ROLES = ["super_admin", "subadmin", "bidder"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_META: Record<
  UserRole,
  { label: string; description: string; color: string }
> = {
  super_admin: {
    label: "Super admin",
    description:
      "Runs the platform. Adds and manages subadmins, and reviews every team's work.",
    color: "purple",
  },
  subadmin: {
    label: "Subadmin",
    description:
      "Runs one team: their candidates, the bidders they add, and who works which profile.",
    color: "blue",
  },
  bidder: {
    label: "Bidder",
    description:
      "Tracks applications and builds resumes for the profiles assigned to them.",
    color: "default",
  },
};

/**
 * The roles that see a whole team — or, for a super admin, every team.
 *
 * Mirrors is_admin() in supabase/schema/02_functions.sql. It answers *who may
 * read broadly*, not who may write: a super admin reviews, and only a subadmin
 * changes a team's records. That second question is managesTeam().
 */
export function isAdminRole(role: UserRole): boolean {
  return role === "subadmin" || role === "super_admin";
}

/**
 * The role that changes a team's records on anyone's behalf but their own.
 * Mirrors is_subadmin().
 */
export function managesTeam(role: UserRole): boolean {
  return role === "subadmin";
}

export type Actor = {
  id: string;
  role: UserRole;
  createdById: string | null;
};

/** Only these two ever reach the Users page. */
export function canManageUsers(role: UserRole): boolean {
  return isAdminRole(role);
}

/**
 * Which role an actor may hand out — one each.
 *
 * A super admin adds subadmins; that is the act of adding a team. A subadmin
 * adds bidders to their own. Nobody mints a peer: a subadmin who could create
 * another subadmin could create a second team and run both.
 */
export function creatableRoles(role: UserRole): UserRole[] {
  if (role === "super_admin") return ["subadmin"];
  if (role === "subadmin") return ["bidder"];
  return [];
}

type Target = { id: string; role: UserRole; createdById: string | null };

/**
 * Whether an actor may delete a target, reset their password or edit them.
 *
 * Exactly the accounts one layer down that are yours to look after: a super
 * admin manages subadmins (all of them — there is one platform), a subadmin
 * manages the bidders they created. A super admin does not reach past a
 * subadmin into their team; the team's people are the subadmin's to run.
 *
 * Never yourself: deleting your own account signs you out mid-session, and
 * the last super admin removing themselves would leave nobody able to appoint
 * a replacement.
 */
export function canModifyUser(actor: Actor, target: Target): boolean {
  if (actor.id === target.id) return false;
  if (actor.role === "super_admin") return target.role === "subadmin";
  if (actor.role === "subadmin") {
    return target.role === "bidder" && target.createdById === actor.id;
  }
  return false;
}

/**
 * Whether the actor may open the edit form for this account.
 *
 * Broader than canModifyUser, because it includes your own row: changing your
 * own name, email or password is not an escalation. Changing your own email or
 * password does ask for your current password — see updateUser.
 */
export function canEditUser(actor: Actor, target: Target): boolean {
  return actor.id === target.id || canModifyUser(actor, target);
}
