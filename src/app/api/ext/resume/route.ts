import { NextResponse } from "next/server";

import { body, fail, UNAUTHORIZED } from "@/lib/ext-http";
import { savePastedResume } from "@/lib/jobs/bid";
import type { JobFieldsInput } from "@/lib/jobs/fields";
import { requestActor } from "@/lib/supabase/request";

/**
 * Pasted resume JSON, for the job on the page: validated against the profile
 * and kept as a ready generation in the profile's saved style (or the
 * template picked in the panel), so the panel can download it
 * (/api/resume-jobs/:id/pdf) and Done can attach it. A refusal lists what's
 * wrong, field by field.
 */
export async function POST(request: Request) {
  const ctx = await requestActor(request);
  if (!ctx) return UNAUTHORIZED();
  const input = await body<{
    profileId?: string;
    content?: unknown;
    job?: JobFieldsInput;
    resumeJobId?: string;
    template?: string;
  }>(request);
  if (!input?.profileId) return fail("Choose a profile first.");
  if (input.content === undefined || input.content === "") return fail("Paste the resume JSON first.");
  if (typeof input.content === "string" && input.content.length > 100_000) return fail("That resume JSON is too long.");

  const result = await savePastedResume(ctx.db, ctx.actor, ctx.token, {
    profileId: input.profileId,
    content: input.content,
    job: input.job ?? {},
    resumeJobId: input.resumeJobId ?? null,
    template: typeof input.template === "string" ? input.template : null,
  });
  if (result.ok) return NextResponse.json(result);
  return NextResponse.json({ error: result.error, problems: result.problems ?? [] }, { status: 400 });
}
