import { BlocklistPanel } from "@/components/blocklist-panel";
import { requireActor } from "@/lib/actor";
import { teamIdFor } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Blocklist · Application" };

export default async function BlocklistPage() {
  const actor = await requireActor();
  const supabase = await createClient();

  const { data } = await supabase
    .from("blocked_company")
    .select("id, name, created_at")
    .order("name");

  return (
    <BlocklistPanel
      teamId={teamIdFor(actor) ?? ""}
      userId={actor.id}
      canEdit={actor.role !== "bidder"}
      rows={data ?? []}
    />
  );
}
