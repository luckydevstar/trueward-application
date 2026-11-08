import { NextResponse } from "next/server";

import { body, fail, UNAUTHORIZED } from "@/lib/ext-http";
import { recordBid } from "@/lib/jobs/bid";
import { requestActor } from "@/lib/supabase/request";

/** Renders the attached PDF on the server, like Download & track. */
export const maxDuration = 60;

/**
 * The extension's Done: records the bid for the posting on the page, with
 * the pasted resume attached when there is one — see recordBid(). Refused for
 * the cooldown or the blocklist with 409 and the reason.
 */
export async function POST(request: Request) {
  const ctx = await requestActor(request);
  if (!ctx) return UNAUTHORIZED();
  const input = await body<{
    profileId?: string;
    resumeJobId?: string;
    title?: string;
    company?: string;
    url?: string;
    description?: string;
  }>(request);
  if (!input?.profileId) return fail("Choose a profile first.");

  const result = await recordBid(ctx.db, ctx.actor, { ...input, profileId: input.profileId });
  if (result.ok) return NextResponse.json(result);
  return NextResponse.json(
    { error: result.error, reason: result.reason },
    { status: result.reason === "other" ? 400 : 409 },
  );
}
