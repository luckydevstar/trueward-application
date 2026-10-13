import { ACCENT_NAMES } from "@/lib/pdf/resume-pdf";
import { TEMPLATES, type TemplateSpec } from "@/lib/pdf/templates";

/**
 * Which resume styles an account may use.
 *
 * Every account gets the whole set unless whoever manages it narrowed it —
 * a subadmin for their bidders, the super admin for a subadmin. There used to
 * be a narrower default for resume builders, whose work went out unreviewed;
 * that role is gone, and a bidder's work goes out under their subadmin's eye.
 */

/**
 * Resolves an account's allowance.
 *
 * `override` is the per-account column; null or empty means everything.
 * Unknown ids are dropped rather than passed on — a template removed from the
 * code would otherwise linger in someone's saved allowance and render as a
 * broken option.
 *
 * Never returns an empty list. An account allowed nothing could not produce a
 * document at all, which is a worse outcome than ignoring a bad setting.
 */
function resolve<T extends string>(
  all: readonly T[],
  override: string[] | null | undefined,
): T[] {
  if (!override?.length) return [...all];

  const filtered = all.filter((value) => override.includes(value));
  return filtered.length ? filtered : [...all];
}

export function allowedTemplates(override?: string[] | null): TemplateSpec[] {
  const ids = resolve(
    TEMPLATES.map((t) => t.id),
    override,
  );
  return TEMPLATES.filter((t) => ids.includes(t.id));
}

export function allowedAccents(override?: string[] | null): string[] {
  return resolve(ACCENT_NAMES, override);
}

/**
 * Snaps a stored choice back inside the allowance.
 *
 * A saved resume — or a remembered preference in localStorage — can name a
 * template the account is no longer allowed. Falling back to the first
 * permitted one renders something rather than nothing, and matches what the
 * picker will show.
 */
export function coerceChoice<T extends string>(
  value: T | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value && allowed.includes(value)) return value;
  return allowed[0] ?? fallback;
}
