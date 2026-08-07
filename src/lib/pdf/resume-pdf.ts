import type { jsPDF as JsPdf } from "jspdf";

import {
  formatMonthYear,
  renderedExperiences,
  type ResumeDocument,
} from "@/lib/document/schema";
import { headerSegments, resolveHeaderFields } from "@/lib/resume-header";
import {
  prefersLightText,
  shade,
  templateSpec,
  tint,
  type RGB,
  type TemplateSpec,
} from "@/lib/pdf/templates";
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
 * The tradeoff is real: layout is manual. There is no flexbox and no
 * page-break-inside. Text flows through `Flow` cursors below, which is the
 * entire pagination strategy.
 */

const INK: RGB = [30, 41, 59];
const MUTED: RGB = [100, 116, 139];

const ACCENTS: Record<string, RGB> = {
  slate: [30, 41, 59],
  blue: [29, 78, 216],
  emerald: [4, 120, 87],
  plum: [109, 40, 217],
  rust: [154, 52, 18],
};

export const ACCENT_NAMES = Object.keys(ACCENTS);

type Resolved = {
  fontScale: number;
  headerPosition: "left" | "center";
  accent: RGB;
  lineSpacing: number;
  justify: boolean;
  spec: TemplateSpec;
};

function resolve(style: ResumeStyle, template: string): Resolved {
  return {
    // Stored as a percentage so the UI slider reads naturally; used as a ratio.
    fontScale: (style.fontScale ?? 100) / 100,
    headerPosition: style.headerPosition ?? "center",
    accent: ACCENTS[style.accent ?? "slate"] ?? ACCENTS.slate,
    lineSpacing: style.lineSpacing ?? 1.4,
    justify: style.justify ?? false,
    spec: templateSpec(template),
  };
}

/**
 * A column of text with its own vertical cursor and page.
 *
 * Two columns are needed for the sidebar template, and they fill independently
 * — the sidebar can run onto page two while the main column is still on page
 * one, or the reverse. Carrying the page number per column is what lets them
 * advance without dragging each other along.
 */
type Flow = { x: number; width: number; y: number; page: number };

export function renderResumePdf(
  pdf: JsPdf,
  doc: ResumeDocument,
  style: ResumeStyle = {},
  template = "classic",
) {
  const s = resolve(style, template);
  const { spec } = s;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const bottom = pageHeight - spec.margin;

  const { profile, content } = doc;
  const fields = resolveHeaderFields(style.header);
  const contactParts = headerSegments(profile.contact, fields);
  const experiences = renderedExperiences(doc);

  const sidebarWidth = spec.header === "sidebar" ? (spec.sidebarWidth ?? 0) : 0;
  const sidebarFill = shade(s.accent, 0.12);
  const sidebarText: RGB = prefersLightText(sidebarFill)
    ? [255, 255, 255]
    : INK;

  /**
   * Page furniture — the filled shapes text sits on top of.
   *
   * Painted the moment a page exists, before anything is written to it,
   * because jsPDF has no z-order: a rectangle drawn later covers the text
   * already there.
   */
  const paintChrome = (page: number) => {
    if (sidebarWidth) {
      pdf.setFillColor(...sidebarFill);
      pdf.rect(0, 0, sidebarWidth, pageHeight, "F");
    }
    // The banner belongs to the first page only. Repeating it on page two
    // reads as a second resume rather than a continuation.
    if (spec.header === "banner" && page === 1) {
      pdf.setFillColor(...s.accent);
      pdf.rect(0, 0, pageWidth, bannerHeight(), "F");
    }
  };

  const bannerHeight = () =>
    (contactParts.length ? 118 : 96) * Math.max(0.9, s.fontScale);

  let lastPage = 1;
  paintChrome(1);

  /** Moves a flow down, opening or stepping onto a page when it runs out. */
  const advance = (flow: Flow, height: number) => {
    if (flow.y + height <= bottom) return;

    flow.page += 1;
    if (flow.page > lastPage) {
      pdf.addPage();
      lastPage = flow.page;
      paintChrome(flow.page);
    }
    flow.y = spec.margin;
  };

  const on = (flow: Flow) => pdf.setPage(flow.page);

  const wrap = (text: string, size: number, width: number) => {
    pdf.setFontSize(size);
    return pdf.splitTextToSize(text, width) as string[];
  };

  const write = (
    value: string | string[],
    x: number,
    y: number,
    size: number,
    opts: {
      bold?: boolean;
      color?: RGB;
      align?: "left" | "center" | "right";
      maxWidth?: number;
      justify?: boolean;
    } = {},
  ) => {
    pdf.setFont("helvetica", opts.bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...(opts.color ?? INK));
    pdf.text(value, x, y, {
      lineHeightFactor: s.lineSpacing,
      align: opts.align ?? "left",
      ...(opts.justify && opts.maxWidth
        ? { align: "justify" as const, maxWidth: opts.maxWidth }
        : {}),
    });
  };

  /**
   * A block of body copy, justified when the style asks for it.
   *
   * The whole array goes to jsPDF in one call. That is load-bearing: jsPDF
   * decides word spacing per line by comparing each against maxWidth and
   * deliberately leaves the last line alone. Drawing line by line makes every
   * call look like a single, final line, so the spacing computes to zero and
   * justification silently does nothing.
   */
  const block = (
    flow: Flow,
    lines: string[],
    size: number,
    color: RGB = INK,
    indent = 0,
  ) => {
    const height = lines.length * size * s.lineSpacing;
    advance(flow, height);
    on(flow);
    write(lines, flow.x + indent, flow.y, size, {
      color,
      justify: s.justify,
      maxWidth: flow.width - indent,
    });
    flow.y += height;
  };

  // ------------------------------------------------------------- headings

  const heading = (flow: Flow, title: string, color = s.accent) => {
    const size = 10 * s.fontScale;
    // A heading with no room for a line beneath it is a heading stranded at the
    // foot of a page, so both are reserved together.
    advance(flow, 34);
    flow.y += spec.sectionGap;
    on(flow);

    if (spec.heading === "chip") {
      const padX = 7;
      const padY = 4.5;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(size);
      const label = title.toUpperCase();
      const width = pdf.getTextWidth(label) + padX * 2;

      pdf.setFillColor(...color);
      pdf.roundedRect(flow.x, flow.y - size + 1, width, size + padY * 2, 2, 2, "F");
      write(label, flow.x + padX, flow.y + padY, size, {
        bold: true,
        color: prefersLightText(color) ? [255, 255, 255] : INK,
      });
      flow.y += size + padY * 2 + 6;
      return;
    }

    write(title.toUpperCase(), flow.x, flow.y, size, { bold: true, color });
    flow.y += 5;

    if (spec.heading === "bar") {
      // A short stub rather than a full rule: it anchors the heading without
      // drawing a line across the whole column.
      pdf.setFillColor(...color);
      pdf.rect(flow.x, flow.y, 34, 2.4, "F");
      flow.y += 12;
    } else {
      pdf.setDrawColor(...tint(color, 0.55));
      pdf.setLineWidth(0.7);
      pdf.line(flow.x, flow.y, flow.x + flow.width, flow.y);
      flow.y += 11;
    }
  };

  const bullet = (flow: Flow, text: string, color = INK) => {
    const size = 9 * s.fontScale;
    const indent = 13;
    const lines = wrap(text, size, flow.width - indent - 4);
    const height = lines.length * size * s.lineSpacing + 3;
    advance(flow, height);
    on(flow);

    pdf.setFillColor(...color);
    // -2.3 lifts the dot from the baseline to the middle of the x-height.
    pdf.circle(flow.x + 3, flow.y - 2.3, 1.25, "F");
    write(lines, flow.x + indent, flow.y, size, {
      color,
      justify: s.justify,
      maxWidth: flow.width - indent - 4,
    });
    flow.y += height;
  };

  // -------------------------------------------------------------- header

  const mainX = sidebarWidth ? sidebarWidth + spec.margin * 0.7 : spec.margin;
  const mainWidth = pageWidth - mainX - spec.margin;

  const main: Flow = { x: mainX, width: mainWidth, y: spec.margin, page: 1 };

  const nameSize = 21 * s.fontScale * (spec.nameScale ?? 1);
  const titleSize = 11 * s.fontScale;
  const contactSize = 8.5 * s.fontScale;
  const CONTACT_SEP = "  ·  ";

  /** Draws the contact line and, when it fits on one line, its link boxes. */
  const contactLine = (
    x: number,
    y: number,
    width: number,
    align: "left" | "center",
    color: RGB,
  ) => {
    if (!contactParts.length) return 0;

    const joined = contactParts.map((p) => p.text).join(CONTACT_SEP);
    const lines = wrap(joined, contactSize, width);
    write(lines, x, y, contactSize, { color, align });

    /**
     * Link annotations, only when the line didn't wrap. A segment's box is
     * derived by measuring the text before it, which holds only while
     * everything sits on one line — if it wrapped, the boxes would land on the
     * wrong words, and a link pointing somewhere unexpected is worse than none.
     */
    if (lines.length === 1 && contactParts.some((p) => p.href)) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(contactSize);
      const sep = pdf.getTextWidth(CONTACT_SEP);
      let cursor = align === "center" ? x - pdf.getTextWidth(joined) / 2 : x;

      for (const part of contactParts) {
        const w = pdf.getTextWidth(part.text);
        if (part.href) {
          pdf.link(cursor, y - contactSize, w, contactSize * 1.2, {
            url: part.href,
          });
        }
        cursor += w + sep;
      }
    }
    return lines.length * contactSize * s.lineSpacing;
  };

  if (spec.header === "banner") {
    const reversed: RGB = prefersLightText(s.accent) ? [255, 255, 255] : INK;
    const soft = prefersLightText(s.accent)
      ? tint(s.accent, 0.78)
      : shade(s.accent, 0.45);

    const centered = s.headerPosition === "center";
    const anchor = centered ? pageWidth / 2 : spec.margin;
    const align = centered ? "center" : "left";

    let y = spec.margin + nameSize * 0.4;
    write(profile.fullName, anchor, y, nameSize, {
      bold: true,
      color: reversed,
      align,
    });
    y += nameSize * 0.95;
    write(content.targetTitle, anchor, y, titleSize, { color: soft, align });
    y += titleSize * 1.5;
    contactLine(anchor, y, pageWidth - spec.margin * 2, align, soft);

    // The first section heading adds its own sectionGap on top of this, so the
    // offset here is deliberately less than a full margin.
    main.y = bannerHeight() + spec.margin * 0.45;
  } else if (spec.header === "sidebar") {
    // Name and role head the main column; the sidebar carries the details.
    write(profile.fullName, main.x, main.y + nameSize * 0.3, nameSize, {
      bold: true,
    });
    main.y += nameSize * 1.05;
    write(content.targetTitle, main.x, main.y, titleSize, { color: s.accent });
    main.y += titleSize * 1.3;
  } else {
    const centered = s.headerPosition === "center";
    const anchor = centered ? pageWidth / 2 : spec.margin;
    const align = centered ? "center" : "left";
    const nameColor = spec.heading === "bar" ? s.accent : INK;

    write(profile.fullName, anchor, main.y + nameSize * 0.3, nameSize, {
      bold: true,
      color: nameColor,
      align,
    });
    main.y += nameSize * 1.05;
    write(content.targetTitle, anchor, main.y, titleSize, {
      color: spec.heading === "bar" ? MUTED : s.accent,
      align,
    });
    main.y += titleSize * 1.25;
    main.y += contactLine(anchor, main.y, mainWidth, align, MUTED);
  }

  // -------------------------------------------------------- main column

  if (content.summary) {
    heading(main, spec.header === "sidebar" ? "Profile" : "Summary");
    block(main, wrap(content.summary, 9.5 * s.fontScale, main.width), 9.5 * s.fontScale);
  }

  /** Skills as "Category: a, b, c", with the label set bold inline. */
  const skillGroups = (flow: Flow, color: RGB, labelColor: RGB) => {
    for (const group of content.skills) {
      const size = 9 * s.fontScale;
      const lineHeight = size * s.lineSpacing;
      const label = `${group.name}: `;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(size);
      const labelWidth = pdf.getTextWidth(label);

      // The first line is shortened by the label; the rest run full width. The
      // 0.35 floor stops a long category name squeezing it to a few characters.
      const firstWidth = Math.max(flow.width - labelWidth, flow.width * 0.35);
      const all = wrap(group.items.join(", "), size, firstWidth);
      const first = all.shift() ?? "";
      const rest = all.length ? wrap(all.join(" "), size, flow.width) : [];

      advance(flow, (1 + rest.length) * lineHeight);
      on(flow);
      write(label, flow.x, flow.y, size, { bold: true, color: labelColor });
      write(first, flow.x + labelWidth, flow.y, size, { color });
      flow.y += lineHeight;

      if (rest.length) {
        write(rest, flow.x, flow.y, size, { color });
        flow.y += rest.length * lineHeight;
      }
    }
  };

  /** Skills stacked one per line — narrow columns have no room for inline. */
  const skillList = (flow: Flow, color: RGB, labelColor: RGB) => {
    for (const group of content.skills) {
      const size = 8.5 * s.fontScale;
      const lineHeight = size * s.lineSpacing;

      advance(flow, lineHeight);
      on(flow);
      write(group.name, flow.x, flow.y, size, { bold: true, color: labelColor });
      flow.y += lineHeight;

      const lines = wrap(group.items.join(", "), size, flow.width);
      advance(flow, lines.length * lineHeight);
      on(flow);
      write(lines, flow.x, flow.y, size, { color });
      flow.y += lines.length * lineHeight + 4;
    }
  };

  if (content.skills.length && spec.header !== "sidebar") {
    heading(main, "Skills");
    skillGroups(main, INK, INK);
  }

  if (experiences.length) {
    heading(main, "Experience");
    for (const { employment, title, bullets } of experiences) {
      const headSize = 10 * s.fontScale;
      const metaSize = 8.5 * s.fontScale;
      advance(main, (headSize + metaSize) * s.lineSpacing);
      on(main);

      // Dates sit right-aligned on the title's baseline, so a role and its
      // period read as one row rather than two stacked lines.
      const period = `${formatMonthYear(employment.startDate)} – ${formatMonthYear(
        employment.endDate ?? null,
        "Present",
      )}`;
      write(title, main.x, main.y, headSize, { bold: true });
      write(period, main.x + main.width, main.y, metaSize, {
        color: MUTED,
        align: "right",
      });
      main.y += headSize * s.lineSpacing;

      write(
        [employment.company, employment.location].filter(Boolean).join(" · "),
        main.x,
        main.y,
        metaSize,
        { color: s.accent },
      );
      main.y += metaSize * s.lineSpacing + 2;

      for (const b of bullets) bullet(main, b.text);
      main.y += 5;
    }
  }

  if (profile.education.length && spec.header !== "sidebar") {
    heading(main, "Education");
    for (const edu of profile.education) {
      const size = 9.5 * s.fontScale;
      advance(main, size * s.lineSpacing * 2);
      on(main);
      write(edu.degree, main.x, main.y, size, { bold: true });
      if (edu.year) {
        write(formatMonthYear(edu.year), main.x + main.width, main.y, 8.5 * s.fontScale, {
          color: MUTED,
          align: "right",
        });
      }
      main.y += size * s.lineSpacing;
      write(
        [edu.school, edu.location].filter(Boolean).join(" · "),
        main.x,
        main.y,
        8.5 * s.fontScale,
        { color: MUTED },
      );
      main.y += 8.5 * s.fontScale * s.lineSpacing + 2;
    }
  }

  // ----------------------------------------------------------- sidebar

  if (sidebarWidth) {
    const pad = spec.margin * 0.55;
    const side: Flow = {
      x: pad,
      width: sidebarWidth - pad * 2,
      y: spec.margin,
      page: 1,
    };
    const softText = prefersLightText(sidebarFill)
      ? tint(sidebarFill, 0.72)
      : MUTED;
    // Headings inside a filled column can't use the accent — it is the fill.
    const sideHeadingColor = sidebarText;

    const sideHeading = (title: string) => {
      const size = 9.5 * s.fontScale;
      advance(side, 30);
      side.y += spec.sectionGap;
      on(side);
      write(title.toUpperCase(), side.x, side.y, size, {
        bold: true,
        color: sideHeadingColor,
      });
      side.y += 5;
      pdf.setFillColor(...sideHeadingColor);
      pdf.rect(side.x, side.y, 24, 2, "F");
      side.y += 11;
    };

    if (contactParts.length) {
      sideHeading("Contact");
      const size = 8.5 * s.fontScale;
      for (const part of contactParts) {
        const lines = wrap(part.text, size, side.width);
        const height = lines.length * size * s.lineSpacing;
        advance(side, height);
        on(side);
        write(lines, side.x, side.y, size, { color: softText });
        if (part.href) {
          pdf.link(side.x, side.y - size, side.width, height, {
            url: part.href,
          });
        }
        side.y += height + 1.5;
      }
    }

    if (content.skills.length) {
      sideHeading("Skills");
      skillList(side, softText, sidebarText);
    }

    if (profile.education.length) {
      sideHeading("Education");
      const size = 8.5 * s.fontScale;
      for (const edu of profile.education) {
        const degree = wrap(edu.degree, size, side.width);
        advance(side, degree.length * size * s.lineSpacing);
        on(side);
        write(degree, side.x, side.y, size, { bold: true, color: sidebarText });
        side.y += degree.length * size * s.lineSpacing;

        const meta = [edu.school, edu.year ? formatMonthYear(edu.year) : null]
          .filter(Boolean)
          .join(" · ");
        const metaLines = wrap(meta, size, side.width);
        advance(side, metaLines.length * size * s.lineSpacing);
        on(side);
        write(metaLines, side.x, side.y, size, { color: softText });
        side.y += metaLines.length * size * s.lineSpacing + 6;
      }
    }
  }

  // Leave the document on its first page, or a viewer opens it part-way down.
  pdf.setPage(1);
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
