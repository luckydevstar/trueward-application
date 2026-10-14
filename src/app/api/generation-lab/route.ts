import { NextResponse } from "next/server";
import { z } from "zod";

import { generateContent, logRow } from "@/lib/ai/generate";
import { openRouterConfigured } from "@/lib/ai/openrouter";
import { profileSchema } from "@/lib/document/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * One model, one test, for the model lab.
 *
 * A route handler rather than a server action because the lab runs several
 * models at once, and Next.js runs a page's server actions one at a time — six
 * models would take six times as long, one after another. The browser fires
 * one request per model and they run side by side.
 *
 * Super admin only, checked here against the session: a route handler is a
 * public URL, and the proxy only checks that someone is signed in.
 */
export const maxDuration = 60;

const body = z.object({
  runId: z.string().uuid(),
  model: z.string().regex(/^[a-z0-9][\w.-]*\/[\w.:-]+$/i),
  profileId: z.string().uuid(),
  /** The resume base prompt, as entered for this test. */
  basePrompt: z.string().trim().min(1, "Enter the resume base prompt.").max(50_000),
  /** The job description and anything else, as entered. */
  additionalPrompt: z.string().trim().min(1, "Enter the additional prompt.").max(30_000),
  reasoning: z.enum(["lowest", "low", "medium", "high", "default"]),
});

export async function POST(request: Request) {
  if (!openRouterConfigured()) {
    return NextResponse.json({ error: "OPENROUTER_API_KEY is not set." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: me } = await supabase.from("app_user").select("role").eq("id", userId).maybeSingle();
  if (me?.role !== "super_admin") {
    return NextResponse.json({ error: "The model lab is the super admin's." }, { status: 403 });
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Bad request." }, { status: 400 });
  }
  const input = parsed.data;

  const { data: row } = await supabase
    .from("candidate_profile")
    .select("id, team_id, profile")
    .eq("id", input.profileId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Profile not found." }, { status: 404 });

  const profile = profileSchema.safeParse(row.profile);
  if (!profile.success) {
    return NextResponse.json({ error: "This profile doesn't satisfy the schema." }, { status: 422 });
  }

  const admin = createAdminClient();
  // Only to label the run: whether it used the saved prompt or an edit of it.
  const { data: settings } = await admin
    .from("generation_setting")
    .select("system_prompt")
    .maybeSingle();

  const outcome = await generateContent({
    profile: profile.data,
    model: input.model,
    systemPrompt: input.basePrompt,
    additionalPrompt: input.additionalPrompt,
    reasoning: input.reasoning,
  });

  await admin.from("resume_generation").insert({
    ...logRow(outcome),
    profile_id: row.id,
    team_id: row.team_id,
    created_by: userId,
    model: input.model,
    source: "lab",
    run_id: input.runId,
    reasoning: input.reasoning,
    prompt_label: input.basePrompt === (settings?.system_prompt ?? "").trim() ? "saved" : "custom",
    output: outcome.content ?? null,
  });

  return NextResponse.json({ outcome });
}
