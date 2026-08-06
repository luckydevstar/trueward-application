import { BlocklistPanel } from "@/components/blocklist-panel";
import { requireActor } from "@/lib/actor";
import { teamIdFor } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Blocklist" };

export default async function BlocklistPage() {
  const actor = await requireActor();
  const supabase = await createClient();

  const [blocked, cooling] = await Promise.all([
    supabase
      .from("blocked_company")
      .select("id, name, created_at")
      .order("name"),
    /**
     * The cooling-off list is a view over recent applications, not a table.
     * Nothing to expire, and nothing that can disagree with the applications it
     * is computed from. It is security_invoker, so this returns only the
     * profiles the caller can use.
     */
    supabase
      .from("application_cooldown")
      .select("profile_id, profile_name, company, applied_at, reopens_at")
      .order("reopens_at", { ascending: true }),
  ]);

  return (
    <BlocklistPanel
      teamId={teamIdFor(actor) ?? ""}
      userId={actor.id}
      canEdit={actor.role !== "bidder"}
      rows={blocked.data ?? []}
      cooling={cooling.data ?? []}
    />
  );
}
