import { Alert } from "antd";

import { UsersPanel } from "@/components/users-panel";
import { requireActor } from "@/lib/actor";
import {
  canChangeRoleOf,
  canEditUser,
  canManageUsers,
  canModifyUser,
  creatableRoles,
} from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Users · Application" };

export default async function UsersPage() {
  const actor = await requireActor();

  if (!canManageUsers(actor.role)) {
    return (
      <Alert
        type="warning"
        showIcon
        title="Not available"
        description="Only admins and super admins manage accounts."
      />
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("app_user")
    .select("id, email, name, role, created_by_id, created_at")
    .order("created_at");

  /**
   * RLS already limits the rows; this adds the per-row "may I do X" answers so
   * the client doesn't re-derive the rules — and so a control it shouldn't
   * offer is never rendered. The server action decides again regardless.
   */
  const rows = (data ?? []).map((u) => {
    const target = { id: u.id, role: u.role, createdById: u.created_by_id };
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      createdAt: u.created_at,
      isSelf: u.id === actor.id,
      canModify: canModifyUser(actor, target),
      canEdit: canEditUser(actor, target),
      canChangeRole: canChangeRoleOf(actor, target),
    };
  });

  return (
    <UsersPanel
      rows={rows}
      creatableRoles={creatableRoles(actor.role)}
      serviceRoleConfigured={Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)}
    />
  );
}
