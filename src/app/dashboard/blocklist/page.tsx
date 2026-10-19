import { BlocklistPanel } from "@/components/blocklist-panel";
import { requireActor } from "@/lib/actor";
import { managesTeam } from "@/lib/roles";
import { seesAllTeams, teamIdFor } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Blocklist" };

export default async function BlocklistPage() {
  const actor = await requireActor();

  const supabase = await createClient();

  const [blocked, cooling] = await Promise.all([
    supabase
      .from("blocked_company")
      .select("id, name, created_at, team_id")
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

  // The super admin reads every team's list; each row says whose — a team is
  // its subadmin, so it's named after them.
  const everyTeam = seesAllTeams(actor);
  const teamNames = new Map<string, string>();
  if (everyTeam && blocked.data?.length) {
    const ids = [...new Set(blocked.data.map((b) => b.team_id))];
    const { data: leads } = await supabase.from("app_user").select("id, name, email").in("id", ids);
    for (const lead of leads ?? []) teamNames.set(lead.id, lead.name ?? lead.email);
  }

  return (
    <BlocklistPanel
      teamId={teamIdFor(actor) ?? ""}
      userId={actor.id}
      // The subadmin's list to keep. A super admin reviews every team's, and
      // has no team for a new entry to belong to.
      canEdit={managesTeam(actor.role)}
      rows={(blocked.data ?? []).map(({ team_id, ...row }) => ({ ...row, team: teamNames.get(team_id) ?? null }))}
      showTeam={everyTeam}
      cooling={cooling.data ?? []}
    />
  );
}
