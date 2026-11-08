import { NextResponse } from "next/server";

import { body, fail, UNAUTHORIZED } from "@/lib/ext-http";
import { checkBids } from "@/lib/jobs/check";
import { requestActor } from "@/lib/supabase/request";

/**
 * The extension's Check: earlier applications to the company on the page (or
 * to that very posting), the blocklist, and whether the posting is on your
 * job list already — see checkBids().
 */
export async function POST(request: Request) {
  const ctx = await requestActor(request);
  if (!ctx) return UNAUTHORIZED();
  const input = await body<{ profileId?: string; company?: string; url?: string }>(request);
  if (!input?.company?.trim() && !input?.url?.trim()) return fail("There's no company or link to check.");

  const result = await checkBids(ctx.db, ctx.actor, {
    profileId: input.profileId ?? null,
    company: (input.company ?? "").slice(0, 200),
    url: input.url?.trim() ? input.url.trim().slice(0, 2000) : null,
  });
  return NextResponse.json(result);
}
