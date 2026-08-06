/**
 * Renders the example resume to a PDF on disk.
 *
 * The renderer runs in the browser in production, which makes it awkward to
 * check by hand — you'd have to click through the UI to see whether a layout
 * change broke pagination. This runs the exact same function under Node and
 * leaves a file you can open.
 *
 *   npm run render:fixture
 *
 * The document is the one the builder offers as its demo profile, so this
 * checks the same data a user sees rather than a fixture that can rot apart
 * from it.
 */
import { writeFileSync } from "node:fs";

import { jsPDF } from "jspdf";

import { EXAMPLE_DOCUMENT } from "../src/lib/document/example";
import { renderResumePdf } from "../src/lib/pdf/resume-pdf";

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
  "classic",
);

const bytes = Buffer.from(pdf.output("arraybuffer"));
const out = process.argv[2] ?? "fixture.pdf";
writeFileSync(out, bytes);

console.log(`pages:  ${pdf.getNumberOfPages()}`);
console.log(`bytes:  ${bytes.length}`);
console.log(`header: ${bytes.subarray(0, 8).toString("latin1")}`);
console.log(`wrote:  ${out}`);
