import { ResumeBuilder } from "@/components/resume-builder";
import { requireActor } from "@/lib/actor";
import { profileSchema } from "@/lib/document/schema";
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

  // RLS is disabled in this deployment. Scope the profile query here so a
  // resume builder receives only profiles they created, never the team-wide
  // list. (Builders cannot use the tracker, so only admin/builder cases reach
  // this page.)
  let profileQuery = supabase
    .from("candidate_profile")
    .select("id, full_name, profile")
    .eq("team_id", teamId)
    .order("full_name");
  let documentQuery = supabase
    .from("resume_document")
    .select("id, title, profile_id, content, template, style, updated_at")
    .eq("team_id", teamId)
    .order("updated_at", { ascending: false });

  if (actor.role === "resume_builder") {
    profileQuery = profileQuery.eq("created_by", actor.id);
    documentQuery = documentQuery.eq("created_by", actor.id);
  }

  const [profiles, documents] = await Promise.all([profileQuery, documentQuery]);

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
