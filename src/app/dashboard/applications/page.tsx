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

  const [applications, blocked] = await Promise.all([
    supabase
      .from("application")
      .select(
        "id, title, company, job_url, status, billing, notes, applied_at, resume_key, resume_url, resume_name",
      )
      .order("applied_at", { ascending: false }),
    supabase.from("blocked_company").select("normalized_name"),
  ]);

  return (
    <ApplicationsGrid
      teamId={teamIdFor(actor)!}
      userId={actor.id}
      rows={applications.data ?? []}
      blockedNames={(blocked.data ?? []).map((b) => b.normalized_name)}
    />
  );
}
