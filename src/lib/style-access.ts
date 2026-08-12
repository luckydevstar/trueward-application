import { ACCENT_NAMES } from "@/lib/pdf/resume-pdf";
import { TEMPLATES, type TemplateSpec } from "@/lib/pdf/templates";
import type { UserRole } from "@/lib/roles";

/**
 * Which resume styles a role gets when nothing is set on the account.
 *
 * A resume builder produces work that goes out under someone else's name, so
 * their default is the restrained end of the set — the banner's full-bleed
 * colour block and the rust accent are the two loudest choices, and neither is
 * a good default for output nobody reviews.
 *
 * This is a starting point, not a rule: an admin can widen or narrow any
 * individual account, and the per-account setting wins outright.
 */
const ROLE_DEFAULTS: Partial<
  Record<UserRole, { templates?: string[]; accents?: string[] }>
> = {
  resume_builder: {
    templates: TEMPLATES.map((t) => t.id).filter((id) => id !== "banner"),
    accents: ACCENT_NAMES.filter((name) => name !== "rust"),
  },
};

/**
 * Resolves an account's allowance.
 *
 * `override` is the per-account column; null or empty falls through to the
 * role default, and a role with no entry gets everything. Unknown ids are
 * dropped rather than passed on — a template removed from the code would
 * otherwise linger in someone's saved allowance and render as a broken option.
 *
 * Never returns an empty list. An account allowed nothing could not produce a
 * document at all, which is a worse outcome than ignoring a bad setting.
 */
function resolve<T extends string>(
  all: readonly T[],
  override: string[] | null | undefined,
  roleDefault: string[] | undefined,
): T[] {
  const wanted = override?.length ? override : roleDefault;
  if (!wanted?.length) return [...all];

  const filtered = all.filter((value) => wanted.includes(value));
  return filtered.length ? filtered : [...all];
}

export function allowedTemplates(
  role: UserRole,
  override?: string[] | null,
): TemplateSpec[] {
  const ids = resolve(
    TEMPLATES.map((t) => t.id),
    override,
    ROLE_DEFAULTS[role]?.templates,
  );
  return TEMPLATES.filter((t) => ids.includes(t.id));
}

export function allowedAccents(
  role: UserRole,
  override?: string[] | null,
): string[] {
  return resolve(ACCENT_NAMES, override, ROLE_DEFAULTS[role]?.accents);
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
