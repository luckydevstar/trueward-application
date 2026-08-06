import { Alert } from "antd";

import { ApplicationsGrid } from "@/components/applications-grid";
import { requireActor } from "@/lib/actor";
import { canRecord, teamIdFor } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Applications" };

export default async function ApplicationsPage() {
  const actor = await requireActor();

  if (!canRecord(actor)) {
    return (
      <Alert
        type="warning"
        showIcon
        title="No team"
        description="Your account isn't attached to a team, so there's nowhere to record applications. An admin needs to set your account up."
      />
    );
  }

  const supabase = await createClient();

  /**
   * Four reads, awaited together so the page costs one round trip rather than
   * four sequential ones.
   *
   * None of them filters by team or by assignment. RLS already narrows
   * applications to "my team, and either mine or for a profile I share", and
   * candidate_profile to the profiles I can use — a filter here would be a
   * second copy of those rules, free to drift from them.
   */
  const [applications, profiles, members, blocked] = await Promise.all([
    supabase
      .from("application")
      .select(
        "id, title, company, job_url, status, billing, notes, applied_at, resume_key, resume_url, resume_name, profile_id, created_by",
      )
      .order("applied_at", { ascending: false }),
    supabase.from("candidate_profile").select("id, full_name").order("full_name"),
    supabase.from("app_user").select("id, name, email"),
    supabase.from("blocked_company").select("normalized_name"),
  ]);

  const rows = applications.data ?? [];

  return (
    <ApplicationsGrid
      teamId={teamIdFor(actor)!}
      userId={actor.id}
      isAdmin={actor.role !== "bidder"}
      rows={rows}
      profiles={(profiles.data ?? []).map((p) => ({
        id: p.id,
        label: p.full_name,
      }))}
      // Only people who actually appear in the visible rows: a filter listing
      // the whole team would offer options that select nothing.
      appliers={(members.data ?? [])
        .filter((m) => rows.some((r) => r.created_by === m.id))
        .map((m) => ({ id: m.id, label: m.name ?? m.email }))}
      blockedNames={(blocked.data ?? []).map((b) => b.normalized_name)}
    />
  );
}
