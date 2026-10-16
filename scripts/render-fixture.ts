/**
 * Renders the example resume once per template — and per font, with --fonts.
 *
 * The renderer runs in the browser in production, which makes it awkward to
 * check by hand — you'd click through the UI to see whether a layout change
 * broke pagination. This runs the exact same function under Node and leaves
 * files you can open (or run through `pdftotext` to see what an applicant
 * tracking system will read).
 *
 *   npm run render:fixture                 # each template in its own font, to ./fixtures
 *   npm run render:fixture -- /tmp         # or somewhere else
 *   npm run render:fixture -- /tmp --fonts # and the Engineer template in every font
 *
 * The document is the one the builder offers as its demo profile, so this
 * checks the same data a user sees rather than a fixture that can rot apart
 * from it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { EXAMPLE_DOCUMENT } from "../src/lib/document/example";
import { FONTS } from "../src/lib/pdf/fonts";
import { newResumePdf, renderResumePdf } from "../src/lib/pdf/resume-pdf";
import { TEMPLATES } from "../src/lib/pdf/templates";
import type { ResumeStyle } from "../src/lib/supabase/types";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--")) ?? "fixtures";
mkdirSync(dir, { recursive: true });

/** Fonts from public/fonts on disk, as the browser fetches them by URL. */
const fromDisk = async (file: string) =>
  readFileSync(join(__dirname, "..", "public", "fonts", file)).toString("base64");

const runs: Array<{ name: string; template: string; style: ResumeStyle }> = TEMPLATES.map((t) => ({
  name: t.id,
  template: t.id,
  style: { fontScale: 100, headerPosition: t.id === "engineer" || t.id === "signal" ? "left" : "center", accent: "blue" },
}));
if (args.includes("--fonts")) {
  for (const font of FONTS) {
    runs.push({ name: `engineer-${font.id}`, template: "engineer", style: { accent: "navy", headerPosition: "left", font: font.id } });
  }
}

void (async () => {
  for (const run of runs) {
    const pdf = await newResumePdf(run.style, run.template, fromDisk);
    renderResumePdf(pdf, EXAMPLE_DOCUMENT, run.style, run.template);
    const bytes = Buffer.from(pdf.output("arraybuffer"));
    const path = `${dir}/resume-${run.name}.pdf`;
    writeFileSync(path, bytes);
    console.log(
      `${run.name.padEnd(28)} ${String(pdf.getNumberOfPages()).padStart(2)}pp  ${String(bytes.length).padStart(7)}b  ${path}`,
    );
  }
})();
