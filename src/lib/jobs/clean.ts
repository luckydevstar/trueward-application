import "server-only";

import { modelCatalog, reasoningParam } from "@/lib/ai/models";
import { completeJson, openRouterConfigured, type ChatMessage } from "@/lib/ai/openrouter";
import { loadGenerationConfig } from "@/lib/ai/settings";
import { MAX_JOB_DESCRIPTION } from "@/lib/jobs/fields";
import { assemble, linesOf } from "@/lib/jobs/page-lines";
import { NOT_ASSIGNED, worksProfile } from "@/lib/jobs/work";
import type { Actor } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Db } from "@/lib/supabase/request";

/*
 * The extension's Check reads a job posting off whatever page is open. On a
 * board with structured data (most applicant-tracking systems) that is
 * already clean; on a page without it — LinkedIn's search view above all —
 * the best the extension can do is the page's text, with the posting buried
 * in search results, buttons, insights and footers.
 *
 * The model finds the posting in that text: its title, the hiring company,
 * and which lines are the description. It answers with line numbers, never
 * with text, so the description that comes back is the page's own words —
 * nothing reworded, summarised or invented — and the reply stays a few dozen
 * tokens however long the posting is.
 */

/** Cleanings per person per hour — a runaway-loop guard, well above working by hand. */
const HOURLY_LIMIT = Number(process.env.CLEAN_HOURLY_LIMIT ?? 200);

/** The page text the extension sends is capped at this too. */
export const MAX_PAGE_TEXT = 60_000;

const PROMPT = `You read the text of a web page a job seeker has open, and find the one job posting on it they are applying to.

The text was copied from the page, one numbered line per line. It may hold much more than the posting: site navigation, search results and other recommended jobs, buttons, applicant counts and insights, ads, the company's profile box, the footer. On a job board's search page, the posting being viewed is the one shown in full — usually under a heading like "About the job" — and the page title and address usually name it.

Answer with:
- found: false if the text holds no job posting's description.
- title: the job title exactly as the posting gives it.
- company: the name of the company that is hiring — not the job board or applicant-tracking system (LinkedIn, Indeed, Glassdoor, Greenhouse, Lever, Workday, Ashby, …), and not the site's name unless the site is the employer's own. For a posting by a staffing agency, the company the posting names as the hiring company, else the agency.
- sections: the line ranges (inclusive) that hold the posting's description — everything the employer wrote about the job: the company and team introduction, the role, responsibilities, requirements and nice-to-haves, compensation and benefits, location and working arrangements, how to apply, and the equal-opportunity statement. Leave out the heading lines that only repeat the title, company and location, and everything the site added: buttons (Apply, Save, Show more), "posted … ago", applicant counts, match scores, hiring and salary insights, premium offers, follower counts, the site's "About the company" box, other jobs, navigation and footers. Use several ranges to step over site lines in the middle of the description.

Give line numbers only; never copy text into sections.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["found", "title", "company", "sections"],
  properties: {
    found: { type: "boolean" },
    title: { type: "string" },
    company: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to"],
        properties: { from: { type: "integer" }, to: { type: "integer" } },
      },
    },
  },
};

export type CleanResult =
  | { ok: true; title: string; company: string; description: string; costUsd: number | null; latencyMs: number }
  | { ok: false; error: string };

export async function cleanPosting(
  db: Db,
  actor: Actor,
  input: {
    profileId: string;
    url: string;
    pageTitle: string;
    /** What the extension made of the page by itself — a hint, often wrong. */
    title: string;
    company: string;
    /** The page's text, as the extension read it. */
    text: string;
  },
): Promise<CleanResult> {
  if (!openRouterConfigured()) return { ok: false, error: "AI cleaning is off — the super admin hasn't set up generation." };

  const lines = linesOf(input.text.slice(0, MAX_PAGE_TEXT));
  if (lines.length < 3) return { ok: false, error: "There's no page text to clean." };

  // The profile through RLS, as every model call is: a candidate you may work.
  const { data: profile } = await db
    .from("candidate_profile")
    .select("id, team_id")
    .eq("id", input.profileId)
    .maybeSingle();
  if (!profile) return { ok: false, error: "Profile not found." };
  if (!(await worksProfile(db, actor, profile.id))) return { ok: false, error: NOT_ASSIGNED };

  const admin = createAdminClient();
  const { count } = await admin
    .from("resume_generation")
    .select("id", { count: "exact", head: true })
    .eq("created_by", actor.id)
    .eq("source", "clean")
    .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
  if ((count ?? 0) >= HOURLY_LIMIT) {
    return { ok: false, error: `That's ${HOURLY_LIMIT} cleanings in the last hour — the limit. Try again shortly.` };
  }

  const config = await loadGenerationConfig(admin);
  const catalog = await modelCatalog();
  const messages: ChatMessage[] = [
    { role: "system", content: PROMPT },
    {
      role: "user",
      content: [
        `Page address: ${input.url.slice(0, 2000) || "(unknown)"}`,
        `Page title: ${input.pageTitle.slice(0, 300) || "(none)"}`,
        `The page's own guess, which may be wrong: title "${input.title.slice(0, 200)}", company "${input.company.slice(0, 200)}"`,
        "",
        "Page text:",
        lines.map((line, i) => `${i + 1}| ${line.text}`).join("\n"),
      ].join("\n"),
    },
  ];

  const started = Date.now();
  const log = (row: { ok: boolean; error: string | null; completion?: Awaited<ReturnType<typeof completeJson>> }) =>
    admin.from("resume_generation").insert({
      profile_id: profile.id,
      team_id: profile.team_id,
      created_by: actor.id,
      model: row.completion?.model ?? config.model,
      source: "clean",
      reasoning: "lowest",
      attempts: 1,
      prompt_tokens: row.completion?.promptTokens ?? null,
      completion_tokens: row.completion?.completionTokens ?? null,
      cached_tokens: row.completion?.cachedTokens ?? null,
      reasoning_tokens: row.completion?.reasoningTokens ?? null,
      cost_usd: row.completion?.costUsd ?? null,
      latency_ms: Date.now() - started,
      ok: row.ok,
      error: row.error,
      run_id: null,
      prompt_label: null,
      output: null,
    });

  let completion: Awaited<ReturnType<typeof completeJson>>;
  try {
    completion = await completeJson({
      model: config.model,
      messages,
      schemaName: "job_posting",
      schema: SCHEMA,
      // Finding line ranges needs reading, not deliberation.
      reasoning: reasoningParam("lowest", catalog.get(config.model)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The page couldn't be cleaned.";
    await log({ ok: false, error: message });
    return { ok: false, error: message };
  }

  let answer: { found?: boolean; title?: string; company?: string; sections?: Array<{ from: number; to: number }> };
  try {
    answer = JSON.parse(completion.content);
  } catch {
    await log({ ok: false, error: "the reply was not valid JSON", completion });
    return { ok: false, error: "The model's answer didn't parse — try again." };
  }

  const sections = (answer.sections ?? []).filter(
    (s) => Number.isInteger(s?.from) && Number.isInteger(s?.to),
  );
  const description = assemble(lines, sections).slice(0, MAX_JOB_DESCRIPTION);
  if (answer.found === false || description.length < 40) {
    await log({ ok: false, error: "no posting found", completion });
    return { ok: false, error: "No job description was found on this page." };
  }

  await log({ ok: true, error: null, completion });
  return {
    ok: true,
    title: (answer.title ?? "").trim().slice(0, 200) || input.title,
    company: (answer.company ?? "").trim().slice(0, 200) || input.company,
    description,
    costUsd: completion.costUsd,
    latencyMs: Date.now() - started,
  };
}
