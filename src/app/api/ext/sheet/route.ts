import { NextResponse } from "next/server";

import { body, fail, UNAUTHORIZED } from "@/lib/ext-http";
import { syncSheet } from "@/lib/jobs/sync";
import { requestActor } from "@/lib/supabase/request";

/** Connects a sheet (with `url`) and syncs it, or re-syncs the connected one. */
export async function POST(request: Request) {
  const ctx = await requestActor(request);
  if (!ctx) return UNAUTHORIZED();
  const input = (await body<{ url?: string }>(request)) ?? {};
  const result = await syncSheet(ctx.db, ctx.actor.id, input.url);
  return result.ok ? NextResponse.json(result) : fail(result.error);
}
