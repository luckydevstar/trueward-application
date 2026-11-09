import { NextResponse } from "next/server";

import { body, fail, UNAUTHORIZED } from "@/lib/ext-http";
import { cleanPosting, MAX_PAGE_TEXT } from "@/lib/jobs/clean";
import { requestActor } from "@/lib/supabase/request";

export const maxDuration = 60;

/**
 * The page text the extension's Check read, cleaned: the posting's title,
 * hiring company, and description, found by the model as line ranges of the
 * page's own text (src/lib/jobs/clean.ts). Logged as source "clean".
 */
export async function POST(request: Request) {
  const ctx = await requestActor(request);
  if (!ctx) return UNAUTHORIZED();
  const input = await body<{
    profileId?: string;
    url?: string;
    pageTitle?: string;
    title?: string;
    company?: string;
    text?: string;
  }>(request);
  if (!input?.profileId) return fail("Choose a profile first.");
  if (typeof input.text !== "string" || !input.text.trim()) return fail("There's no page text to clean.");
  if (input.text.length > MAX_PAGE_TEXT * 2) return fail("That page is too long to clean.");

  const result = await cleanPosting(ctx.db, ctx.actor, {
    profileId: input.profileId,
    url: input.url ?? "",
    pageTitle: input.pageTitle ?? "",
    title: input.title ?? "",
    company: input.company ?? "",
    text: input.text,
  });
  return result.ok ? NextResponse.json(result) : fail(result.error);
}
