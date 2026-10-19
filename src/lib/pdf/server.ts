import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { resumeDocumentSchema } from "@/lib/document/schema";
import { newResumePdf, renderResumePdf, resumeFileName } from "@/lib/pdf/resume-pdf";
import type { ResumeJobRow } from "@/lib/supabase/types";

/**
 * Fonts from public/fonts on the server's own disk. next.config.ts traces them
 * into the functions that render (outputFileTracingIncludes).
 */
const fromDisk = async (file: string) =>
  (await readFile(join(process.cwd(), "public", "fonts", file))).toString("base64");

/**
 * A generated resume as a PDF, rendered on the server — for the Chrome
 * extension, which downloads a resume without opening the builder.
 *
 * The same renderer as the builder's preview and download (resume-pdf.ts),
 * in the style the job was generated with, so what downloads here is what the
 * builder would have produced.
 */
export async function renderJobPdf(
  job: Pick<ResumeJobRow, "content" | "template" | "style">,
  profile: unknown,
): Promise<{ ok: true; bytes: Uint8Array; fileName: string } | { ok: false; error: string }> {
  const doc = resumeDocumentSchema.safeParse({ schemaVersion: 2, profile, content: job.content });
  if (!doc.success) {
    return { ok: false, error: "This resume needs a fix before it can be downloaded — open it in the builder." };
  }
  const style = job.style ?? {};
  const template = job.template ?? "banner";
  const pdf = await newResumePdf(style, template, fromDisk);
  renderResumePdf(pdf, doc.data, style, template);
  return { ok: true, bytes: new Uint8Array(pdf.output("arraybuffer")), fileName: resumeFileName(doc.data) };
}
