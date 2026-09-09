import { ResumeBuilder } from "@/components/resume-builder";
import { requireActor } from "@/lib/actor";
import { profileSchema } from "@/lib/document/schema";
import { profileReach, scopeToReach } from "@/lib/profile-scope";
import { teamIdFor } from "@/lib/scope";
import { allowedAccents, allowedTemplates } from "@/lib/style-access";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Resume builder" };

export default async function ResumesPage() {
  const actor = await requireActor();
  const supabase = await createClient();

  const teamId = teamIdFor(actor);
  if (!teamId) {
    return <ResumeBuilder profiles={[]} documents={[]} teamId="" userId={actor.id} templates={allowedTemplates(actor.role, actor.allowedTemplates)} accents={allowedAccents(actor.role, actor.allowedAccents)} />;
  }

  /**
   * What this actor may work with, resolved once and applied to both queries.
   *
   * The bug this replaces: the old version narrowed only for `resume_builder`
   * and let every other role through on `team_id` alone — so a bidder's
   * profile dropdown listed the whole team's candidates rather than the ones
   * assigned to them. Documents had the same hole.
   *
   * Both queries take the same id set, which is what the policies do — they
   * both go through can_use_profile() — and is why this cannot drift into
   * scoping one list differently from the other again.
   */
  const reach = await profileReach(supabase, actor, teamId);

  const [profiles, documents] = await Promise.all([
    scopeToReach(
      supabase
        .from("candidate_profile")
        .select("id, full_name, profile")
        .eq("team_id", teamId)
        .order("full_name"),
      reach,
      "id",
    ),
    scopeToReach(
      supabase
        .from("resume_document")
        .select("id, title, profile_id, content, template, style, updated_at")
        .eq("team_id", teamId)
        .order("updated_at", { ascending: false }),
      reach,
      "profile_id",
    ),
  ]);

  // Parsed on the server so a profile that no longer satisfies the schema
  // surfaces as a disabled option with a reason, rather than crashing the
  // renderer once someone selects it.
  const parsed = (profiles.data ?? []).map((p) => {
    const result = profileSchema.safeParse(p.profile);
    return {
      id: p.id,
      fullName: p.full_name,
      profile: result.success ? result.data : null,
      error: result.success
        ? null
        : (result.error.issues[0]?.message ?? "Invalid profile"),
    };
  });

  return (
    <ResumeBuilder
      profiles={parsed}
      documents={documents.data ?? []}
      teamId={teamIdFor(actor) ?? ""}
      userId={actor.id}
      templates={allowedTemplates(actor.role, actor.allowedTemplates)}
      accents={allowedAccents(actor.role, actor.allowedAccents)}
    />
  );
}
