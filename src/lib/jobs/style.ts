import "server-only";

import { templateSpec } from "@/lib/pdf/templates";
import type { CurrentActor } from "@/lib/actor";
import { cleanStyle, DEFAULT_STYLE, savedStyleFrom, type SavedStyle } from "@/lib/resume-style";
import { allowedAccents, allowedTemplates, coerceChoice } from "@/lib/style-access";
import type { Db } from "@/lib/supabase/request";
import type { ResumeStyle } from "@/lib/supabase/types";

export type ProfileStyle = SavedStyle & {
  /** Where it came from: saved in the builder, the last resume made, or nothing yet. */
  source: "saved" | "recent" | "default";
};

/**
 * The style a server-rendered resume for this profile is drawn in, for this
 * person — the extension's pasted resumes and its batches.
 *
 * In order: the style the builder saved to their account for the profile
 * (src/lib/resume-style.ts); else the style of the last resume they made or
 * saved for it, which is what the builder kept on that row; else the last
 * they used on any profile; else the default. Snapped inside what the account
 * is allowed, as the builder's picker is.
 *
 * `token` is the request's bearer token (the extension's), or null for a
 * cookie session.
 */
export async function profileStyle(
  db: Db,
  actor: CurrentActor,
  profileId: string,
  token: string | null,
): Promise<ProfileStyle> {
  const { data: account } = await db.auth.getUser(token ?? undefined);
  const saved = savedStyleFrom(account.user?.user_metadata, profileId);

  let found: ProfileStyle | null = saved ? { ...saved, source: "saved" } : null;
  if (!found) {
    const [{ data: job }, { data: document }] = await Promise.all([
      db
        .from("resume_job")
        .select("template, style, updated_at")
        .eq("created_by", actor.id)
        .eq("profile_id", profileId)
        .not("style", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("resume_document")
        .select("template, style, updated_at")
        .eq("created_by", actor.id)
        .eq("profile_id", profileId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const latest = [job, document]
      .filter((row): row is NonNullable<typeof row> => Boolean(row?.style))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    if (latest) {
      found = { template: latest.template ?? "banner", style: (latest.style as ResumeStyle) ?? {}, source: "recent" };
    }
  }
  if (!found) {
    const { data: last } = await db
      .from("resume_job")
      .select("template, style")
      .eq("created_by", actor.id)
      .not("style", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    found = last?.style
      ? { template: last.template ?? "banner", style: last.style as ResumeStyle, source: "recent" }
      : { template: "banner", style: DEFAULT_STYLE, source: "default" };
  }

  const templates = allowedTemplates(actor.allowedTemplates).map((t) => t.id);
  const accents = allowedAccents(actor.allowedAccents);
  const style = { ...DEFAULT_STYLE, ...(cleanStyle(found.style) ?? {}) };
  return {
    source: found.source,
    template: templateSpec(coerceChoice(found.template, templates, "banner")).id,
    style: { ...style, accent: coerceChoice(style.accent, accents, accents[0]) },
  };
}
