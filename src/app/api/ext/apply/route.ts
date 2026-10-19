import { NextResponse } from "next/server";

import { body, fail, UNAUTHORIZED } from "@/lib/ext-http";
import { applyJob } from "@/lib/jobs/apply";
import { requestActor } from "@/lib/supabase/request";

/**
 * Download & track: records the application for a generated resume, with
 * the PDF attached, and says where to download it from. A refusal (recently
 * applied, or blocklisted) comes back as 409 with the reason, so the panel
 * can offer the download alone.
 */
export async function POST(request: Request) {
  const ctx = await requestActor(request);
  if (!ctx) return UNAUTHORIZED();
  const input = await body<{ resumeJobId?: string }>(request);
  if (!input?.resumeJobId) return fail("Choose a resume.");

  const result = await applyJob(ctx.db, ctx.actor, input.resumeJobId);
  if (result.ok) return NextResponse.json(result);
  return NextResponse.json(
    { error: result.error, reason: result.reason },
    { status: result.reason === "other" ? 400 : 409 },
  );
}
