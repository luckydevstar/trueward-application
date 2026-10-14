import { ResumeBuilder } from "@/components/resume-builder";
import { requireActor } from "@/lib/actor";
import { openRouterConfigured } from "@/lib/ai/openrouter";
import { profileSchema } from "@/lib/document/schema";
import { profileReach, scopeToReach } from "@/lib/profile-scope";
import { managesTeam } from "@/lib/roles";
import { seesAllTeams, teamIdFor } from "@/lib/scope";
import { allowedAccents, allowedTemplates } from "@/lib/style-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Resume builder" };

/**
 * Seconds this page's server actions may run — the generation call to the
 * model takes tens of seconds. The OpenRouter client gives up at 55, so a
 * slow model fails with a sentence rather than a platform timeout.
 */
export const maxDuration = 60;

/**
 * Whether the Generate button works, with which model — shown beside it so
 * whoever generates knows what they're spending — and the saved resume base
 * prompt, which pre-fills the builder's base-prompt field. Read with the
 * service role: the settings row is the super admin's to change, but the
 * builder's users are meant to see and edit the prompt they generate with.
 */
async function generation() {
  if (!openRouterConfigured()) return { enabled: false, model: null, basePrompt: "" };
  try {
    const { data } = await createAdminClient()
      .from("generation_setting")
      .select("model, system_prompt")
      .maybeSingle();
    return { enabled: true, model: data?.model ?? null, basePrompt: data?.system_prompt ?? "" };
  } catch {
    // No service-role key: the action could not log or read settings either.
    return { enabled: false, model: null, basePrompt: "" };
  }
}

export default async function ResumesPage() {
  const actor = await requireActor();
  const supabase = await createClient();

  /*
   * A super admin has no team and reaches every one, so the team filter is
   * dropped for them rather than pinning the query to an id they don't have.
   * Everyone else without a team genuinely has nothing to show.
   */
  const everyTeam = seesAllTeams(actor);
  const teamId = teamIdFor(actor) ?? "";

  if (!teamId && !everyTeam) {
    return (
      <ResumeBuilder
        profiles={[]}
        documents={[]}
        teamId=""
        userId={actor.id}
        templates={allowedTemplates(actor.allowedTemplates)}
        accents={allowedAccents(actor.allowedAccents)}
        canEditAny={false}
        readOnly
        generation={{ enabled: false, model: null, basePrompt: "" }}
      />
    );
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

  const [profiles, documents, ai] = await Promise.all([
    scopeToReach(
      (() => {
        const query = supabase
          .from("candidate_profile")
          .select("id, full_name, profile")
          .order("full_name");
        return everyTeam ? query : query.eq("team_id", teamId);
      })(),
      reach,
      "id",
    ),
    scopeToReach(
      (() => {
        const query = supabase
          .from("resume_document")
          .select(
            "id, title, profile_id, content, template, style, updated_at, created_by",
          )
          .order("updated_at", { ascending: false });
        return everyTeam ? query : query.eq("team_id", teamId);
      })(),
      reach,
      "profile_id",
    ),
    generation(),
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
      templates={allowedTemplates(actor.allowedTemplates)}
      accents={allowedAccents(actor.allowedAccents)}
      canEditAny={managesTeam(actor.role)}
      // A super admin reviews every team's resumes and saves none — they have
      // no team for a new one to belong to.
      readOnly={everyTeam}
      generation={ai}
    />
  );
}
