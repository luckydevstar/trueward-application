import { NextResponse } from "next/server";

import { body, fail, UNAUTHORIZED } from "@/lib/ext-http";
import { addJob } from "@/lib/jobs/jobs";
import { jobNo } from "@/lib/numbers";
import { requestActor } from "@/lib/supabase/request";

/**
 * Adds a job from the extension — usually the posting open in the browser,
 * with its link filled in. The same job as the Jobs page adds: a description
 * already on the list finds that job rather than making a second.
 */
export async function POST(request: Request) {
  const ctx = await requestActor(request);
  if (!ctx) return UNAUTHORIZED();
  const input = await body<{ title?: string; company?: string; url?: string; description?: string }>(request);
  if (!input) return fail("Fill in the job first.");

  const result = await addJob(ctx.db, ctx.actor.id, input);
  if (!result.ok) return fail(result.error);
  return NextResponse.json({ id: result.job.id, no: jobNo(result.job.no), existed: result.existed });
}
