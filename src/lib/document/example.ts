import { resumeDocumentSchema, type ResumeDocument } from "./schema";

/**
 * A complete, valid resume document.
 *
 * Serves two jobs that must not drift apart:
 *
 *   1. The builder's demo profile, so the page is explorable before anyone has
 *      been assigned a real candidate — style controls, preview and download
 *      all work against it.
 *   2. The fixture for `npm run render:fixture`, which checks the PDF renderer
 *      under Node.
 *
 * Parsed at module load rather than typed by hand, so a schema change breaks
 * this immediately instead of silently producing a demo that can't be rendered.
 */
export const EXAMPLE_DOCUMENT: ResumeDocument = resumeDocumentSchema.parse({
  profile: {
    fullName: "Jane Doe",
    contact: {
      email: "jane@example.com",
      phone: "+1 555 0100",
      location: "Boston, MA",
      links: [
        { label: "GitHub", url: "github.com/janedoe" },
        { label: "LinkedIn", url: "linkedin.com/in/janedoe" },
      ],
    },
    employments: [
      {
        id: "acme-2022",
        company: "Acme Corp",
        location: "Remote",
        startDate: "March 2022",
        additionalInfo:
          "Design systems and the reporting surface. Team of six. Owned the RSC migration end to end.",
      },
      {
        id: "globex-2019",
        company: "Globex",
        location: "Boston, MA",
        startDate: "2019-06",
        endDate: "February 2022",
        additionalInfo:
          "Customer-facing portal, Next.js and GraphQL. Took over the admin bundle work after it stalled.",
      },
    ],
    education: [
      {
        school: "Northeastern University",
        degree: "BSc Computer Science",
        year: "2019",
        additionalInfo: "Thesis on incremental static regeneration.",
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

/** The id the builder uses for the demo option. Never a real profile id. */
export const EXAMPLE_PROFILE_ID = "__example__";
