import type { ResumeStyle } from "@/lib/supabase/types";

/*
 * A profile's saved resume style, as the server sees it.
 *
 * The builder remembers a style per profile in the browser (profile-style.ts)
 * and also saves it to the person's account — their Supabase user metadata,
 * under STYLES_KEY — so the server can render in it: the Chrome extension's
 * pasted resumes and batches use it. Per person and per profile, like the
 * builder's own: two people working one candidate may style it differently.
 *
 * User metadata rather than a table because it is the person's own record,
 * writable by them and nobody else, with nothing to migrate. It is a style,
 * not a permission, so nothing reads it as one.
 */

export const STYLES_KEY = "resumeStyles";

/** Where a style starts: the builder's reset button and anyone with nothing saved. */
export const DEFAULT_STYLE: ResumeStyle = {
  fontScale: 100,
  headerPosition: "center",
  accent: "slate",
  lineSpacing: 1.4,
  justify: false,
};

/** Template and styling together, as the builder's preset holds them. */
export type SavedStyle = { template: string; style: ResumeStyle };

/** The style fields a PDF is rendered from — anything else in a request is dropped. */
export function cleanStyle(style: ResumeStyle | null | undefined): ResumeStyle | null {
  if (!style) return null;
  const { fontScale, headerPosition, accent, lineSpacing, justify, header, font } = style;
  const picked: ResumeStyle = { fontScale, headerPosition, accent, lineSpacing, justify, header, font };
  // Unset fields left out rather than set to undefined, so the result can be spread over defaults.
  return Object.fromEntries(Object.entries(picked).filter(([, value]) => value !== undefined)) as ResumeStyle;
}

/** The saved style for one profile out of a user's metadata, if it holds one that reads. */
export function savedStyleFrom(metadata: unknown, profileId: string): SavedStyle | null {
  const all = (metadata as Record<string, unknown> | null)?.[STYLES_KEY];
  const entry = (all as Record<string, unknown> | undefined)?.[profileId] as Partial<SavedStyle> | undefined;
  if (!entry || typeof entry.template !== "string" || !entry.style || typeof entry.style !== "object") return null;
  return { template: entry.template, style: cleanStyle(entry.style) ?? {} };
}
