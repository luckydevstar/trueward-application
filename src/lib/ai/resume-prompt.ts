import { monthYearKey, type ResumeProfile } from "@/lib/document/schema";

/**
 * What the model is told, and the shape it must answer in.
 *
 * Three parts, and only the first is editable:
 *
 *   1. the system prompt — the super admin's, from the Generation settings
 *      page; DEFAULT_SYSTEM_PROMPT below until one is saved
 *   2. the output contract — always appended, because the document schema is
 *      code, not a preference: a prompt edited to say "write a cover letter"
 *      must still come back as resume content the builder can render
 *   3. the facts — the profile's employments and education, the job
 *      description, and the per-resume additional prompt
 *
 * The profile goes in without the candidate's name, email, phone or address.
 * The model writes positioning, not identity — identity is joined from the
 * profile at render time — so there is no reason to send it to a third party.
 */

export const DEFAULT_SYSTEM_PROMPT = `You are an expert resume writer who tailors a candidate's experience to one specific job.

Write for both an applicant tracking system and a hiring manager skimming for ten seconds:
- Mirror the job description's own vocabulary for skills and responsibilities, where the candidate's history genuinely supports it.
- Lead every bullet with a strong verb, say what the candidate did and why it mattered, and include a metric when the source material gives one.
- Prefer the work most relevant to this job; keep older or unrelated roles brief.
- Never invent employers, dates, titles the candidate didn't hold, credentials, or numbers. Everything you write must be supported by the candidate's profile.`;

/** Appended to every system prompt. Not editable — it is the schema, in words. */
export const OUTPUT_CONTRACT = `## Output contract (fixed)

Reply with a single JSON object and nothing else, matching the provided schema:
- targetTitle: the job title this resume targets, usually the posting's title.
- summary: one paragraph, no line breaks.
- skills: grouped categories, each with a name and a list of skills.
- experiences: one entry per employment in the candidate profile, in the order given (most recent first). Use each employment's "employmentId" exactly as given — it is how the resume finds the company, location and dates, which you must not write yourself. Each entry has the job title the candidate held and the bullets for that role.`;

type Employment = ResumeProfile["employments"][number];

/** Newest first, the order the document schema requires experiences in. */
function newestFirst(employments: Employment[]): Employment[] {
  return [...employments].sort(
    (a, b) => monthYearKey(b.startDate) - monthYearKey(a.startDate),
  );
}

const monthYearText = (value: { year: number; month: number | null } | null | undefined) =>
  value ? (value.month ? `${value.year}-${String(value.month).padStart(2, "0")}` : `${value.year}`) : null;

export function buildMessages(input: {
  systemPrompt: string;
  profile: ResumeProfile;
  jobDescription: string;
  additionalPrompt: string;
}) {
  const facts = {
    employments: newestFirst(input.profile.employments).map((e) => ({
      employmentId: e.id,
      company: e.company,
      location: e.location ?? null,
      start: monthYearText(e.startDate),
      end: monthYearText(e.endDate) ?? "present",
      notes: e.additionalInfo ?? null,
    })),
    education: input.profile.education.map((e) => ({
      school: e.school,
      degree: e.degree,
      year: monthYearText(e.year),
      notes: e.additionalInfo ?? null,
    })),
  };

  const system = `${input.systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT}\n\n${OUTPUT_CONTRACT}`;

  const user = [
    "## Candidate profile",
    "The facts you may draw on. Do not contradict them.",
    "```json",
    JSON.stringify(facts, null, 2),
    "```",
    "",
    "## Job description",
    input.jobDescription.trim(),
    ...(input.additionalPrompt.trim()
      ? ["", "## Additional instructions for this resume", input.additionalPrompt.trim()]
      : []),
  ].join("\n");

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

/**
 * The JSON schema the model answers in — contentSchema, written for strict
 * structured output.
 *
 * Hand-written rather than generated from the zod schema: strict mode wants
 * every property required and no extras, which the zod schema (with its
 * defaults and transforms) does not say. The employment ids are an enum of
 * this profile's own, so the model *cannot* answer with one that doesn't
 * resolve — the most common reason pasted JSON used to fail.
 *
 * The answer is still validated against resumeDocumentSchema afterwards;
 * ordering and the one-paragraph summary are rules a JSON schema can't state.
 */
export function contentJsonSchema(employmentIds: string[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["targetTitle", "summary", "skills", "experiences"],
    properties: {
      targetTitle: { type: "string" },
      summary: { type: "string" },
      skills: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "items"],
          properties: {
            name: { type: "string" },
            items: { type: "array", items: { type: "string" } },
          },
        },
      },
      experiences: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["employmentId", "title", "bullets"],
          properties: {
            // An empty enum is invalid JSON Schema; a profile with no
            // employments gets a plain string, and validation then rejects
            // any experience at all.
            employmentId: employmentIds.length
              ? { type: "string", enum: employmentIds }
              : { type: "string" },
            title: { type: "string" },
            bullets: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["text"],
                properties: { text: { type: "string" } },
              },
            },
          },
        },
      },
    },
  };
}
