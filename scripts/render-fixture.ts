/**
 * Renders the example resume once per template.
 *
 * The renderer runs in the browser in production, which makes it awkward to
 * check by hand — you'd click through the UI to see whether a layout change
 * broke pagination. This runs the exact same function under Node and leaves
 * files you can open.
 *
 *   npm run render:fixture            # writes to ./fixtures
 *   npm run render:fixture -- /tmp    # or somewhere else
 *
 * The document is the one the builder offers as its demo profile, so this
 * checks the same data a user sees rather than a fixture that can rot apart
 * from it.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { jsPDF } from "jspdf";

import { EXAMPLE_DOCUMENT } from "../src/lib/document/example";
import { renderResumePdf } from "../src/lib/pdf/resume-pdf";
import { TEMPLATES } from "../src/lib/pdf/templates";

const dir = process.argv[2] ?? "fixtures";
mkdirSync(dir, { recursive: true });

for (const template of TEMPLATES) {
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
    compress: true,
  });

  renderResumePdf(
    pdf,
    EXAMPLE_DOCUMENT,
    { fontScale: 100, headerPosition: "center", accent: "blue" },
    template.id,
  );

  const bytes = Buffer.from(pdf.output("arraybuffer"));
  const path = `${dir}/resume-${template.id}.pdf`;
  writeFileSync(path, bytes);

  console.log(
    `${template.id.padEnd(9)} ${String(pdf.getNumberOfPages()).padStart(2)}pp  ${String(
      bytes.length,
    ).padStart(6)}b  ${path}`,
  );
}
