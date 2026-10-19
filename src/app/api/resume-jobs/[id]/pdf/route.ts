import { fail, UNAUTHORIZED } from "@/lib/ext-http";
import { renderJobPdf } from "@/lib/pdf/server";
import { requestActor } from "@/lib/supabase/request";

/**
 * A generated resume as a PDF, rendered on the server — the extension's
 * "Download only". Your own generations only (RLS on resume_job).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requestActor(request);
  if (!ctx) return UNAUTHORIZED();
  const { id } = await params;

  const { data: job } = await ctx.db.from("resume_job").select("*").eq("id", id).maybeSingle();
  if (!job) return fail("That resume isn't there any more.", 404);
  if (job.status !== "ready") return fail("That resume isn't ready yet.", 409);
  const { data: profile } = await ctx.db.from("candidate_profile").select("profile").eq("id", job.profile_id).maybeSingle();
  if (!profile) return fail("Profile not found.", 404);

  const rendered = await renderJobPdf(job, profile.profile);
  if (!rendered.ok) return fail(rendered.error, 422);
  return new Response(rendered.bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="resume.pdf"; filename*=UTF-8''${encodeURIComponent(rendered.fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
