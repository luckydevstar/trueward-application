import { Alert } from "antd";

import { UsersPanel } from "@/components/users-panel";
import { requireActor } from "@/lib/actor";
import { fetchAll } from "@/lib/fetch-all";
import {
  canEditUser,
  canManageUsers,
  canModifyUser,
  creatableRoles,
} from "@/lib/roles";
import { ACCENT_NAMES } from "@/lib/pdf/resume-pdf";
import { TEMPLATES } from "@/lib/pdf/templates";
import { seesAllTeams } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const actor = await requireActor();

  if (!canManageUsers(actor.role)) {
    return (
      <Alert
        type="warning"
        showIcon
        title="Not available"
        description="Only subadmins and the super admin manage accounts."
      />
    );
  }

  const supabase = await createClient();
  const everyTeam = seesAllTeams(actor);

  /*
   * RLS decides the list: a subadmin sees themselves and the bidders they
   * added; the super admin sees every account, so they can review who is on
   * which team. Being able to *see* an account is not being able to manage
   * it — the per-row answers below say which.
   */
  const [{ data }, profileTeams] = await Promise.all([
    supabase
      .from("app_user")
      // `*`: see requireActor() on finance_access.
      .select("*")
      .order("created_at"),
    // Only the super admin's view counts profiles per team, for the delete
    // dialog: removing a subadmin should say what it is about to move.
    everyTeam
      ? fetchAll<{ team_id: string }>((from, to) =>
          supabase.from("candidate_profile").select("team_id").range(from, to),
        )
      : Promise.resolve({ rows: [] as { team_id: string }[], error: null }),
  ]);

  const users = data ?? [];
  const nameOf = new Map(users.map((u) => [u.id, u.name ?? u.email]));

  const profileCount = new Map<string, number>();
  for (const { team_id } of profileTeams.rows) {
    profileCount.set(team_id, (profileCount.get(team_id) ?? 0) + 1);
  }
  const userCount = new Map<string, number>();
  for (const u of users) {
    if (u.role === "bidder" && u.created_by_id) {
      userCount.set(u.created_by_id, (userCount.get(u.created_by_id) ?? 0) + 1);
    }
  }

  /**
   * The per-row "may I do X" answers, so the client doesn't re-derive the
   * rules — and so a control it shouldn't offer is never rendered. The server
   * actions decide again regardless.
   */
  const rows = users.map((u) => {
    const target = { id: u.id, role: u.role, createdById: u.created_by_id };
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      createdAt: u.created_at,
      allowedTemplates: u.allowed_templates ?? [],
      allowedAccents: u.allowed_accents ?? [],
      financeAccess: u.role === "super_admin" || Boolean(u.finance_access),
      isSelf: u.id === actor.id,
      canModify: canModifyUser(actor, target),
      canEdit: canEditUser(actor, target),
      // Whose team the account is on. A subadmin's team is their own; a
      // bidder's is whoever added them. Null for the super admin, and for a
      // bidder whose subadmin is gone.
      team:
        u.role === "subadmin"
          ? (u.name ?? u.email)
          : u.role === "bidder" && u.created_by_id
            ? (nameOf.get(u.created_by_id) ?? null)
            : null,
      teamSize:
        u.role === "subadmin"
          ? {
              users: userCount.get(u.id) ?? 0,
              profiles: profileCount.get(u.id) ?? 0,
            }
          : null,
    };
  });

  return (
    <UsersPanel
      rows={rows}
      creatableRoles={creatableRoles(actor.role)}
      showTeams={everyTeam}
      // Who may open Trueward Finance is the super admin's call alone.
      canGrantFinance={actor.role === "super_admin"}
      subadmins={users
        .filter((u) => u.role === "subadmin")
        .map((u) => ({ id: u.id, label: u.name ?? u.email }))}
      allTemplates={TEMPLATES.map((t) => ({ value: t.id, label: t.label }))}
      allAccents={ACCENT_NAMES}
      serviceRoleConfigured={Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)}
    />
  );
}
