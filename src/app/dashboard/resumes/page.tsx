import { ResumeBuilder } from "@/components/resume-builder";
import { requireActor } from "@/lib/actor";
import { profileSchema } from "@/lib/document/schema";
import { teamIdFor } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Resume builder" };

export default async function ResumesPage() {
  const actor = await requireActor();
  const supabase = await createClient();

  // RLS already narrows this to the profiles assigned to the caller (or, for an
  // admin, their whole team) via can_use_profile — no filter needed here.
  const [profiles, documents] = await Promise.all([
    supabase
      .from("candidate_profile")
      .select("id, full_name, profile")
      .order("full_name"),
    supabase
      .from("resume_document")
      .select("id, title, profile_id, content, template, style, updated_at")
      .order("updated_at", { ascending: false }),
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
    />
  );
}
