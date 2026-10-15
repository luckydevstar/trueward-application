import { monthYearKey, type ResumeProfile } from "@/lib/document/schema";

/**
 * What the model is told, and the shape it must answer in.
 *
 *   system  the active base prompt (the super admin's choice, or the built-in
 *           default below), then the output contract — appended because the
 *           document schema is code, not a preference: whatever the base
 *           prompt says, the answer must come back as resume content the
 *           builder can render
 *   user    the selected profile's employments and education, its company
 *           context if one is recorded, then the job description
 *
 * The profile goes in without the candidate's name, email, phone or address.
 * The model writes positioning, not identity — identity is joined from the
 * profile at render time — so there is no reason to send it to a third party.
 *
 * DEFAULT_SYSTEM_PROMPT is the built-in base prompt: used when no library
 * prompt is active, and shown read-only on the Generation page.
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
  /** The base prompt. */
  systemPrompt: string;
  profile: ResumeProfile;
  /** What each employer does, as recorded on the profile. */
  companyContext?: string | null;
  /** The job description, as pasted. */
  jobDescription: string;
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

  const system = `${input.systemPrompt.trim()}\n\n${OUTPUT_CONTRACT}`;

  const user = [
    "## Candidate profile",
    "```json",
    JSON.stringify(facts, null, 2),
    "```",
    ...(input.companyContext?.trim() ? ["", "## Company context", input.companyContext.trim()] : []),
    "",
    "## Job description",
    input.jobDescription.trim(),
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

/**
 * A prompt the profile adder copies into any AI assistant with web access,
 * together with the profile's employments, to draft the profile's company
 * context.
 *
 * Facts only: what each employer actually does, who its customers are, and
 * how it ran during the candidate's dates. The resume model uses this to speak
 * an employer's real domain; it is not a place for anything the candidate did,
 * which belongs in each employment's notes.
 */
export const COMPANY_RESEARCH_PROMPT = `You are a careful company researcher. For each employer in the employment list below, write a short factual profile that a resume writer will use to describe the candidate's work in that employer's real domain.

For each employer, in the same order, give:
- Company and period: the exact name, employment id and dates from the list.
- Business model: own product, consulting/services, or hybrid.
- Core business: two or three sentences on what the company actually does, its industry, and its main products or services.
- Customers and users: who buys from it, and who uses its products or services.
- Context during the employment dates: anything notable about the company in that period (for example, a product that launched later and so did not exist yet).

Rules:
- Use only verified facts from official company sources or credible coverage. If you can't confirm something, say so plainly instead of guessing.
- If several companies share a name, use the location and dates to pick the right one, and say which you chose.
- Describe the company only. Do not describe the candidate's projects, responsibilities, technologies or results, and do not suggest any.
- Do not include personal or contact information.
- Keep each employer to about 80–150 words. Return only the profiles, as plain text.

Employment list:`;
