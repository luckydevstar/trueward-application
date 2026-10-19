/**
 * What a job is made of, and how much of it — shared by the Jobs page, the
 * builder, the extension and the server, so all four refuse the same things.
 * Pure: no server imports, safe in a client component.
 */

/** The database's own limit too (job_description_length, schema part 1). */
export const MAX_JOB_DESCRIPTION = 30_000;

export type JobFields = {
  title: string;
  company: string | null;
  url: string | null;
  description: string;
};

export type JobFieldsInput = {
  title?: string | null;
  company?: string | null;
  url?: string | null;
  description?: string | null;
};

/**
 * Trims and checks a job. On the Jobs page every field is asked for — a job
 * there is something you'll apply to, and applying needs a company and a
 * link. The builder only needs the description; the rest can follow at Apply.
 */
export function cleanJob(
  input: JobFieldsInput,
  { complete }: { complete: boolean },
): { ok: true; value: JobFields } | { ok: false; error: string } {
  const description = (input.description ?? "").trim();
  const title = (input.title ?? "").trim();
  const company = (input.company ?? "").trim();
  const url = (input.url ?? "").trim();

  if (!description) return { ok: false, error: "Paste the job description." };
  if (description.length > MAX_JOB_DESCRIPTION) {
    return { ok: false, error: "That job description is too long — trim it to the posting itself." };
  }
  if (complete && !title) return { ok: false, error: "Give the job a title." };
  if (complete && !company) return { ok: false, error: "Which company is it at?" };
  if (complete && !url) return { ok: false, error: "Add the link to the posting." };
  if (url && !/^https?:\/\/\S+$/i.test(url)) return { ok: false, error: "The link should start with http:// or https://." };
  if (title.length > 200 || company.length > 200 || url.length > 2000) {
    return { ok: false, error: "The title, company or link is too long." };
  }

  return {
    ok: true,
    value: {
      title: title || firstLine(description),
      company: company || null,
      url: url || null,
      description,
    },
  };
}

/** A title for a job pasted without one: the posting's first line. */
export function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  return line.slice(0, 120) || "Untitled job";
}
