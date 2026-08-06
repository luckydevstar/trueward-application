import type { jsPDF as JsPdf } from "jspdf";

import {
  formatMonthYear,
  renderedExperiences,
  type ResumeDocument,
} from "@/lib/document/schema";
import type { ResumeStyle } from "@/lib/supabase/types";

/**
 * Draws a resume into a jsPDF document.
 *
 * Why coordinates rather than HTML/CSS: rendering CSS to PDF means running a
 * headless browser, which on a serverless free tier means shipping a ~50 MB
 * Chromium into the function, forcing its binary through the file tracer, and
 * paying a cold boot per render. That approach is what made PDF export
 * unreliable in the previous project. Everything here runs in the user's
 * browser in a few milliseconds against jsPDF's built-in Helvetica — one of the
 * PDF base-14 fonts, so nothing is embedded and the text stays selectable.
 *
 * The tradeoff is real and worth naming: layout is manual. There is no flexbox,
 * no page-break-inside, no widow control. `ensure()` below is the entire
 * pagination strategy.
 */

const INK: [number, number, number] = [30, 41, 59];
const MUTED: [number, number, number] = [100, 116, 139];

const ACCENTS: Record<string, [number, number, number]> = {
  slate: [30, 41, 59],
  blue: [29, 78, 216],
  emerald: [4, 120, 87],
};

type Resolved = {
  fontScale: number;
  headerPosition: "left" | "center";
  accent: [number, number, number];
  lineSpacing: number;
  margin: number;
  sectionGap: number;
  justify: boolean;
};

function resolve(style: ResumeStyle, template: string): Resolved {
  return {
    // Stored as a percentage so the UI slider reads naturally; used as a ratio.
    fontScale: (style.fontScale ?? 100) / 100,
    headerPosition: style.headerPosition ?? "center",
    accent: ACCENTS[style.accent ?? "slate"] ?? ACCENTS.slate,
    lineSpacing: style.lineSpacing ?? 1.4,
    margin: template === "compact" ? 42 : template === "modern" ? 58 : 52,
    sectionGap: template === "compact" ? 10 : 15,
    justify: style.justify ?? false,
  };
}

export function renderResumePdf(
  pdf: JsPdf,
  doc: ResumeDocument,
  style: ResumeStyle = {},
  template = "classic",
) {
  const s = resolve(style, template);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - s.margin * 2;

  let y = s.margin;

  /** Break to a new page when `height` more points wouldn't fit. */
  const ensure = (height: number) => {
    if (y + height > pageHeight - s.margin) {
      pdf.addPage();
      y = s.margin;
    }
  };

  const wrap = (text: string, size: number, width = contentWidth) => {
    pdf.setFontSize(size);
    return pdf.splitTextToSize(text, width) as string[];
  };

  const text = (
    value: string | string[],
    x: number,
    size: number,
    opts: {
      bold?: boolean;
      color?: [number, number, number];
      align?: "left" | "center";
    } = {},
  ) => {
    pdf.setFont("helvetica", opts.bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...(opts.color ?? INK));
    pdf.text(value, x, y, {
      lineHeightFactor: s.lineSpacing,
      align: opts.align ?? "left",
    });
  };

  /**
   * A block of body copy, justified when the style asks for it.
   *
   * Every line but the last is stretched to `width`; the last is left as-is.
   * jsPDF will happily justify a final three-word line across the full measure
   * if handed the whole array at once, which is the classic broken-looking
   * paragraph — so the last line is drawn separately.
   *
   * Lines are positioned one at a time rather than in a single call, because
   * jsPDF's justify needs a per-line maxWidth to stretch against.
   */
  const block = (
    lines: string[],
    x: number,
    size: number,
    width: number,
    opts: { color?: [number, number, number] } = {},
  ) => {
    if (!s.justify || lines.length < 2) {
      text(lines, x, size, opts);
      return;
    }

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...(opts.color ?? INK));

    const lineHeight = size * s.lineSpacing;
    lines.forEach((line, i) => {
      const last = i === lines.length - 1;
      pdf.text(line, x, y + i * lineHeight, {
        lineHeightFactor: s.lineSpacing,
        ...(last ? {} : { align: "justify", maxWidth: width }),
      });
    });
  };

  // ---------------------------------------------------------------- header

  const { profile, content } = doc;
  const centered = s.headerPosition === "center";
  const anchor = centered ? pageWidth / 2 : s.margin;
  const align = centered ? "center" : "left";

  const nameSize = 20 * s.fontScale;
  ensure(nameSize * s.lineSpacing);
  text(profile.fullName, anchor, nameSize, { bold: true, align });
  y += nameSize * s.lineSpacing;

  const titleSize = 11 * s.fontScale;
  text(content.targetTitle, anchor, titleSize, { color: s.accent, align });
  y += titleSize * s.lineSpacing;

  // Contact line. Filtered before joining so a missing phone doesn't leave a
  // dangling separator.
  const contactBits = [
    profile.contact.email,
    profile.contact.phone,
    profile.contact.location,
    ...profile.contact.links.map((l) => l.url),
  ].filter((v): v is string => Boolean(v && v.trim()));

  if (contactBits.length) {
    const size = 8.5 * s.fontScale;
    const lines = wrap(contactBits.join("  ·  "), size);
    text(lines, anchor, size, { color: MUTED, align });
    y += lines.length * size * s.lineSpacing;
  }

  // ---------------------------------------------------------------- sections

  const section = (title: string) => {
    // A heading with no room for even one line under it is a heading stranded
    // at the bottom of a page, so reserve both.
    ensure(34);
    y += s.sectionGap;
    text(title.toUpperCase(), s.margin, 10.5 * s.fontScale, {
      bold: true,
      color: s.accent,
    });
    y += 5;
    pdf.setDrawColor(...s.accent);
    pdf.setLineWidth(0.7);
    pdf.line(s.margin, y, pageWidth - s.margin, y);
    y += 13;
  };

  const paragraph = (value: string, size = 9.5 * s.fontScale, indent = 0) => {
    const width = contentWidth - indent;
    const lines = wrap(value, size, width);
    ensure(lines.length * size * s.lineSpacing);
    block(lines, s.margin + indent, size, width);
    y += lines.length * size * s.lineSpacing;
  };

  const bullet = (value: string) => {
    const size = 9 * s.fontScale;
    const width = contentWidth - 18;
    const lines = wrap(value, size, width);
    const height = lines.length * size * s.lineSpacing + 3;
    ensure(height);
    pdf.setFillColor(...INK);
    // -2.3 lifts the dot from the text baseline to the middle of the x-height.
    pdf.circle(s.margin + 3, y - 2.3, 1.25, "F");
    block(lines, s.margin + 13, size, width);
    y += height;
  };

  if (content.summary) {
    section("Summary");
    paragraph(content.summary);
  }

  if (content.skills.length) {
    section("Skills");
    for (const group of content.skills) {
      const size = 9 * s.fontScale;
      const lineHeight = size * s.lineSpacing;
      const label = `${group.name}: `;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(size);
      const labelWidth = pdf.getTextWidth(label);

      // The first line is shortened by the label; the rest run full width. The
      // 0.35 floor stops a very long category name from squeezing the first
      // line down to a couple of characters.
      const firstWidth = Math.max(contentWidth - labelWidth, contentWidth * 0.35);
      const all = wrap(group.items.join(", "), size, firstWidth);
      const first = all.shift() ?? "";
      const rest = all.length ? wrap(all.join(" "), size, contentWidth) : [];

      ensure((1 + rest.length) * lineHeight);
      text(label, s.margin, size, { bold: true });
      text(first, s.margin + labelWidth, size);
      y += lineHeight;

      if (rest.length) {
        text(rest, s.margin, size);
        y += rest.length * lineHeight;
      }
    }
  }

  const experiences = renderedExperiences(doc);
  if (experiences.length) {
    section("Experience");
    for (const { employment, title, bullets } of experiences) {
      const headSize = 10 * s.fontScale;
      const metaSize = 8.5 * s.fontScale;
      ensure(headSize * s.lineSpacing + metaSize * s.lineSpacing);

      // Dates are right-aligned on the same baseline as the title, so the role
      // and its period read as one row rather than two stacked lines.
      const period = `${formatMonthYear(employment.startDate)} – ${formatMonthYear(
        employment.endDate ?? null,
        "Present",
      )}`;
      text(title, s.margin, headSize, { bold: true });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(metaSize);
      pdf.setTextColor(...MUTED);
      pdf.text(period, pageWidth - s.margin, y, { align: "right" });
      y += headSize * s.lineSpacing;

      const where = [employment.company, employment.location]
        .filter(Boolean)
        .join(" · ");
      text(where, s.margin, metaSize, { color: MUTED });
      y += metaSize * s.lineSpacing + 2;

      for (const b of bullets) bullet(b.text);
      y += 4;
    }
  }

  if (profile.education.length) {
    section("Education");
    for (const edu of profile.education) {
      const size = 9.5 * s.fontScale;
      ensure(size * s.lineSpacing * 2);
      text(edu.degree, s.margin, size, { bold: true });
      if (edu.year) {
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.5 * s.fontScale);
        pdf.setTextColor(...MUTED);
        pdf.text(formatMonthYear(edu.year), pageWidth - s.margin, y, {
          align: "right",
        });
      }
      y += size * s.lineSpacing;
      text(
        [edu.school, edu.location].filter(Boolean).join(" · "),
        s.margin,
        8.5 * s.fontScale,
        { color: MUTED },
      );
      y += 8.5 * s.fontScale * s.lineSpacing + 2;
    }
  }
}

/**
 * Renders to a blob URL for on-screen preview.
 *
 * The preview shows the real PDF rather than an HTML approximation of it. Two
 * renderers drift — the styling controls silently did nothing to the old HTML
 * preview, which is exactly the failure this avoids — and a render costs a few
 * milliseconds, so there is no reason to maintain a second one.
 *
 * The caller owns the returned URL and must revokeObjectURL it, or every
 * keystroke leaks a document.
 */
export async function renderResumePdfUrl(
  doc: ResumeDocument,
  style: ResumeStyle = {},
  template = "classic",
): Promise<string> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
    compress: true,
  });

  renderResumePdf(pdf, doc, style, template);
  return URL.createObjectURL(pdf.output("blob"));
}

/**
 * Builds the PDF and hands it to the user.
 *
 * jsPDF is imported here rather than at module scope so it lands in its own
 * chunk — it is ~350 KB, and a page that merely *offers* a download shouldn't
 * pay for it on first load.
 *
 * Prefers showSaveFilePicker where available (Chromium) so the user picks the
 * destination, falling back to pdf.save() elsewhere. Returns false when the
 * user cancels the picker, which is not an error and must not surface as one.
 */
export async function downloadResumePdf(
  doc: ResumeDocument,
  style: ResumeStyle = {},
  template = "classic",
): Promise<boolean> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
    compress: true,
  });

  renderResumePdf(pdf, doc, style, template);

  const safeName =
    doc.profile.fullName.replace(/[\\/:*?"<>|]+/g, "").trim() || "Resume";
  const fileName = `${safeName} — ${doc.content.targetTitle}.pdf`;

  const savePicker = (
    window as unknown as {
      showSaveFilePicker?: (options: {
        suggestedName: string;
        types: Array<{
          description: string;
          accept: Record<string, string[]>;
        }>;
      }) => Promise<{
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    }
  ).showSaveFilePicker;

  if (!savePicker) {
    pdf.save(fileName);
    return true;
  }

  try {
    const handle = await savePicker({
      suggestedName: fileName,
      types: [
        { description: "PDF document", accept: { "application/pdf": [".pdf"] } },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(pdf.output("blob"));
    await writable.close();
    return true;
  } catch (error) {
    // AbortError means the user dismissed the picker on purpose.
    if (error instanceof DOMException && error.name === "AbortError") {
      return false;
    }
    throw error;
  }
}
