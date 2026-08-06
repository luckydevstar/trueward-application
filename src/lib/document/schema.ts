import { z } from "zod";

/**
 * The canonical resume artifact.
 *
 * Split into two halves along the line that actually matters:
 *
 *   profile — who you are and where you worked. Set once. Never regenerated.
 *   content — how you're positioned for one job. Regenerated per JD.
 *
 * That boundary is made structural, not merely documented. A model that only
 * ever authors `content` is not *instructed* to leave your name, phone,
 * employers, and dates alone — it is unable to reach them. Employment facts are
 * referenced by `employmentId`; a reference that doesn't resolve is a hard
 * validation failure rather than an invented employer.
 *
 * The two halves are stored apart, which is what gives the split teeth at rest
 * as well as in memory: `profile` lives on candidate_profile, `content` on
 * resume_document, and they are joined only at render time by
 * renderedExperiences() below. Regenerating positioning for a new job rewrites
 * one row and cannot touch the other.
 *
 * This schema is the single source of truth — the editor imports the type and
 * the writes validate against it, so a model's contract cannot drift from the
 * validator.
 */

// --------------------------------------------------------------- month/year

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const MONTH_LOOKUP: Record<string, number> = {};
MONTHS.forEach((name, i) => {
  MONTH_LOOKUP[name.toLowerCase()] = i + 1;
  MONTH_LOOKUP[name.toLowerCase().slice(0, 3)] = i + 1;
});
MONTH_LOOKUP.sept = 9;

export type MonthYear = { year: number; month: number | null };

const ISO_MONTH = /^(\d{4})-(\d{1,2})$/;
const TEXT_MONTH = /^([A-Za-z]+)\.?\s+(\d{4})$/;
const YEAR_ONLY = /^(\d{4})$/;

/**
 * Dates arrive as "June 2024", "2024-06", "Jun 2024". All of them normalize
 * here, so the template formats one way and satisfies the "consistent date
 * formatting" rule without trusting the input to be consistent.
 */
export function parseMonthYear(raw: string): MonthYear {
  const s = raw.trim();

  const iso = ISO_MONTH.exec(s);
  if (iso) {
    const month = Number(iso[2]);
    if (month < 1 || month > 12) throw new Error(`month out of range in ${raw}`);
    return { year: Number(iso[1]), month };
  }

  const text = TEXT_MONTH.exec(s);
  if (text) {
    const month = MONTH_LOOKUP[text[1].toLowerCase()];
    if (!month) throw new Error(`unrecognized month name: ${text[1]}`);
    return { year: Number(text[2]), month };
  }

  const year = YEAR_ONLY.exec(s);
  if (year) return { year: Number(year[1]), month: null };

  throw new Error(
    `cannot parse date "${raw}"; expected 'June 2024', '2024-06', or '2024'`,
  );
}

export function formatMonthYear(value: MonthYear | null, fallback = ""): string {
  if (!value) return fallback;
  if (value.month === null) return String(value.year);
  return `${MONTHS[value.month - 1]} ${value.year}`;
}

/** Sortable key. Month-less dates sort before any month in the same year. */
export function monthYearKey(value: MonthYear): number {
  return value.year * 100 + (value.month ?? 0);
}

const monthYearString = z.string().min(1).transform((raw, ctx) => {
  try {
    const parsed = parseMonthYear(raw);
    if (parsed.year < 1950 || parsed.year > 2100) {
      ctx.addIssue({ code: "custom", message: `year out of range: ${parsed.year}` });
      return z.NEVER;
    }
    return parsed;
  } catch (err) {
    ctx.addIssue({
      code: "custom",
      message: err instanceof Error ? err.message : "invalid date",
    });
    return z.NEVER;
  }
});

/**
 * Accepts either the authored form ("June 2024") or an already-parsed
 * {year, month}, which makes the schema idempotent: parse(parse(x)) == parse(x).
 *
 * That property is load-bearing, not theoretical. The editor validates on the
 * client for instant feedback and then POSTs the document, where the route
 * handler validates again — so a parsed date is round-tripped straight back
 * through this schema. Without the object form, every valid document would be
 * rejected by the server the moment the client had already parsed it.
 *
 * An already-parsed object is rendered back to its canonical string and run
 * through the ONE string parser, rather than being a second union branch. A
 * failing z.union() reports a useless "Invalid input"; this way a typo surfaces
 * as `unrecognized month name: Septempber`, which is the whole point of having
 * a real parser.
 */
const monthYear = z.preprocess((value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const { year, month } = value as { year?: unknown; month?: unknown };
    if (typeof year === "number" && Number.isInteger(year)) {
      if (month === null || month === undefined) return String(year);
      if (typeof month === "number" && Number.isInteger(month) && month >= 1 && month <= 12) {
        return `${MONTHS[month - 1]} ${year}`;
      }
    }
    // Malformed object — leave it alone so the string parser rejects it loudly
    // rather than silently dropping a bad month.
    return value;
  }
  return value;
}, monthYearString);

// ===========================================================================
// profile — stable. the model never writes any of this.
// ===========================================================================

export const linkSchema = z.object({
  label: z.string().min(1),
  url: z.string().min(1),
});

export const contactSchema = z.object({
  email: z.string().min(1),
  phone: z.string().nullish(),
  /**
   * Address parts are carried separately rather than pre-joined, because which
   * of them belongs in the header is a per-resume decision — a US resume
   * conventionally shows city and state and omits the country, which a single
   * "Boston, MA, United States" string can no longer walk back.
   *
   * Street address is deliberately absent: it is on the profile for records,
   * not on the resume.
   */
  city: z.string().nullish(),
  state: z.string().nullish(),
  postalCode: z.string().nullish(),
  country: z.string().nullish(),
  /**
   * Legacy pre-joined form. Documents written before the split still carry it,
   * so it stays readable and is used as a fallback when no parts are present.
   * Nothing writes it any more.
   */
  location: z.string().nullish(),
  links: z.array(linkSchema).default([]),
});

export const employmentSchema = z
  .object({
    id: z.string().min(1), // the handle `content` references
    company: z.string().min(1),
    location: z.string().nullish(),
    startDate: monthYear,
    endDate: monthYear.nullish(), // null/absent renders as "Present"
    /**
     * Raw context — projects, stack, team size, what actually happened here.
     * Never rendered: it is source material for whatever writes `content`, so
     * the detail can be exhaustive without bloating the page.
     */
    additionalInfo: z.string().nullish(),
  })
  // superRefine, not refine: Zod 4 dropped the function-form message, and a
  // plain refine would report this as a bare "Invalid input" — losing the
  // company name and dates that make the error worth reading.
  .superRefine((e, ctx) => {
    if (e.endDate && monthYearKey(e.endDate) < monthYearKey(e.startDate)) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message:
          `${e.company}: endDate ${formatMonthYear(e.endDate)} precedes ` +
          `startDate ${formatMonthYear(e.startDate)}`,
      });
    }
  });

export const educationSchema = z.object({
  school: z.string().min(1),
  degree: z.string().min(1),
  year: monthYear.nullish(),
  location: z.string().nullish(),
  /** Coursework, honours, thesis — same role as employment's, never rendered. */
  additionalInfo: z.string().nullish(),
});

export const profileSchema = z
  .object({
    fullName: z.string().min(1),
    contact: contactSchema,
    employments: z.array(employmentSchema).default([]),
    education: z.array(educationSchema).default([]),
  })
  .superRefine((profile, ctx) => {
    const seen = new Set<string>();
    profile.employments.forEach((e, i) => {
      if (seen.has(e.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["employments", i, "id"],
          message: `duplicate employment id: ${e.id}`,
        });
      }
      seen.add(e.id);
    });
  });

// ===========================================================================
// content — positioning. the only half a model authors.
// ===========================================================================

export const bulletSchema = z.object({
  text: z.string().min(1),

  // Unused in v1. The Writer agent populates these once the evidence store
  // exists; the grounding validator then asserts they resolve (§7.3).
  evidenceIds: z.array(z.string()).default([]),
  metricIds: z.array(z.string()).default([]),
});

export const skillCategorySchema = z.object({
  name: z.string().min(1),
  items: z.array(z.string().min(1)).min(1),
});

/**
 * Positioning for one employment. Carries no company, location, or dates —
 * those live in the profile and are joined at render time, so the model has no
 * way to alter them.
 */
export const experienceContentSchema = z.object({
  employmentId: z.string().min(1),
  title: z.string().min(1),
  bullets: z.array(bulletSchema).default([]),
});

export const contentSchema = z.object({
  targetTitle: z.string().min(1),
  summary: z
    .string()
    .min(1)
    .refine((s) => !s.trim().includes("\n\n"), "summary must be a single paragraph")
    .transform((s) => s.split(/\s+/).filter(Boolean).join(" ")),
  skills: z.array(skillCategorySchema).default([]),
  experiences: z.array(experienceContentSchema).default([]),
});

// ===========================================================================
// document — the join
// ===========================================================================

export const resumeDocumentSchema = z
  .object({
    schemaVersion: z.literal(2).default(2),
    profile: profileSchema,
    content: contentSchema,
  })
  .superRefine((doc, ctx) => {
    const known = new Map(doc.profile.employments.map((e) => [e.id, e]));
    const used = new Set<string>();

    // The check that makes the split load-bearing: a model that invents an
    // employer produces an id nothing resolves, and the document is rejected
    // instead of rendered.
    doc.content.experiences.forEach((x, i) => {
      if (!known.has(x.employmentId)) {
        ctx.addIssue({
          code: "custom",
          path: ["content", "experiences", i, "employmentId"],
          message:
            `unknown employmentId "${x.employmentId}"; profile defines ` +
            `[${[...known.keys()].sort().map((k) => `"${k}"`).join(", ")}]`,
        });
        return;
      }
      if (used.has(x.employmentId)) {
        ctx.addIssue({
          code: "custom",
          path: ["content", "experiences", i, "employmentId"],
          message: `employmentId used more than once: ${x.employmentId}`,
        });
      }
      used.add(x.employmentId);
    });

    const keys = doc.content.experiences
      .map((x) => known.get(x.employmentId))
      .filter((e): e is NonNullable<typeof e> => Boolean(e))
      .map((e) => monthYearKey(e.startDate));

    const descending = [...keys].sort((a, b) => b - a);
    if (keys.join() !== descending.join()) {
      ctx.addIssue({
        code: "custom",
        path: ["content", "experiences"],
        message: "experiences must be ordered most-recent-first",
      });
    }
  });

export type Link = z.infer<typeof linkSchema>;
export type Contact = z.infer<typeof contactSchema>;
export type Employment = z.infer<typeof employmentSchema>;
export type EducationBlock = z.infer<typeof educationSchema>;
export type ResumeProfile = z.infer<typeof profileSchema>;
export type Bullet = z.infer<typeof bulletSchema>;
export type SkillCategory = z.infer<typeof skillCategorySchema>;
export type ExperienceContent = z.infer<typeof experienceContentSchema>;
export type ResumeContent = z.infer<typeof contentSchema>;
export type ResumeDocument = z.infer<typeof resumeDocumentSchema>;

/** profile ∪ content for one job, assembled for the template. */
export type RenderedExperience = {
  employment: Employment;
  title: string;
  bullets: Bullet[];
};

export function renderedExperiences(doc: ResumeDocument): RenderedExperience[] {
  const known = new Map(doc.profile.employments.map((e) => [e.id, e]));
  return doc.content.experiences.map((x) => ({
    employment: known.get(x.employmentId)!, // guaranteed by superRefine above
    title: x.title,
    bullets: x.bullets,
  }));
}

export type FieldError = { path: string; message: string };

/** Flatten Zod issues into the shape the editor renders. */
export function fieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
