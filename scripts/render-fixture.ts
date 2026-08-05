/**
 * Renders a sample resume to a PDF on disk.
 *
 * The renderer runs in the browser in production, which makes it awkward to
 * check by hand — you'd have to click through the UI to see whether a layout
 * change broke pagination. This runs the exact same function under Node and
 * leaves a file you can open.
 *
 *   npm run render:fixture
 */
import { writeFileSync } from "node:fs";

import { jsPDF } from "jspdf";

import { resumeDocumentSchema } from "../src/lib/document/schema";
import { renderResumePdf } from "../src/lib/pdf/resume-pdf";

const doc = resumeDocumentSchema.parse({
  profile: {
    fullName: "Jane Doe",
    contact: {
      email: "jane@example.com",
      phone: "+1 555 0100",
      location: "Boston, MA",
      links: [{ label: "LinkedIn", url: "linkedin.com/in/janedoe" }],
    },
    employments: [
      {
        id: "acme-2022",
        company: "Acme Corp",
        location: "Remote",
        startDate: "March 2022",
      },
      {
        id: "globex-2019",
        company: "Globex",
        location: "Boston, MA",
        startDate: "2019-06",
        endDate: "February 2022",
      },
    ],
    education: [
      {
        school: "Northeastern University",
        degree: "BSc Computer Science",
        year: "2019",
      },
    ],
  },
  content: {
    targetTitle: "Staff Frontend Engineer",
    summary:
      "Frontend engineer with seven years building design systems and data-heavy dashboards. Led the migration of a 200-screen product to React Server Components, cutting median load time by 40 percent.",
    skills: [
      { name: "Languages", items: ["TypeScript", "JavaScript", "Python", "SQL"] },
      {
        name: "Frontend",
        items: ["React", "Next.js", "Ant Design", "Tailwind", "Vite", "Playwright"],
      },
    ],
    experiences: [
      {
        employmentId: "acme-2022",
        title: "Senior Frontend Engineer",
        bullets: [
          {
            text: "Rebuilt the reporting dashboard on React Server Components, cutting median time-to-interactive from 4.1s to 2.4s across 12,000 weekly sessions.",
          },
          {
            text: "Owned the design system: 60 components, adopted by four product teams.",
          },
        ],
      },
      {
        employmentId: "globex-2019",
        title: "Frontend Engineer",
        bullets: [
          { text: "Shipped the customer portal used by 30,000 accounts." },
          { text: "Cut bundle size 38% by code-splitting the admin routes." },
        ],
      },
    ],
  },
});

const pdf = new jsPDF({
  orientation: "portrait",
  unit: "pt",
  format: "a4",
  compress: true,
});

renderResumePdf(
  pdf,
  doc,
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
