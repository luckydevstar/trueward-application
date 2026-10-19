import { NextResponse } from "next/server";

import { body, fail, UNAUTHORIZED } from "@/lib/ext-http";
import { answerQuestion } from "@/lib/jobs/work";
import { requestActor } from "@/lib/supabase/request";

export const maxDuration = 60;

/**
 * Answers an application question from a generated resume and its job
 * description — the builder's follow-up questions, from the extension.
 */
export async function POST(request: Request) {
  const ctx = await requestActor(request);
  if (!ctx) return UNAUTHORIZED();
  const input = await body<{
    resumeJobId?: string;
    question?: string;
    history?: Array<{ question: string; answer: string }>;
  }>(request);
  if (!input?.resumeJobId || !input.question?.trim()) return fail("Type a question first.");

  const { data: job } = await ctx.db
    .from("resume_job")
    .select("profile_id, content, job_description, status")
    .eq("id", input.resumeJobId)
    .maybeSingle();
  if (!job) return fail("That resume isn't there any more.", 404);
  if (job.status !== "ready" || !job.content) return fail("Generate the resume first — answers are written from it.");

  const result = await answerQuestion(ctx.db, ctx.actor, {
    profileId: job.profile_id,
    jobDescription: job.job_description,
    resume: JSON.stringify(job.content, null, 2),
    question: input.question,
    history: (input.history ?? []).slice(-6),
  });
  return result.ok ? NextResponse.json(result) : fail(result.error);
}
