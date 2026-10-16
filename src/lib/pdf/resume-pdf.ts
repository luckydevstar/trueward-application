import type { jsPDF as JsPdf } from "jspdf";

import {
  formatMonthYear,
  renderedExperiences,
  type ResumeDocument,
} from "@/lib/document/schema";
import { headerSegments, resolveHeaderFields } from "@/lib/resume-header";
import { pdfFamily, prepareFont, type FontLoader } from "@/lib/pdf/fonts";
import {
  mix,
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
 * browser in a few milliseconds. Text is drawn in the resume's font — a base-14
 * font, or an embedded open-licence one (fonts.ts) — and stays selectable and
 * extractable either way.
 *
 * The tradeoff is real: layout is manual. There is no flexbox and no
 * page-break-inside. Text flows through `Flow` cursors below, which is the
 * entire pagination strategy.
 */

const INK: RGB = [30, 41, 59];
const MUTED: RGB = [100, 116, 139];

const ACCENTS: Record<string, RGB> = {
  slate: [30, 41, 59],
  navy: [30, 58, 138],
  blue: [29, 78, 216],
  indigo: [67, 56, 202],
  teal: [15, 118, 110],
  emerald: [4, 120, 87],
  plum: [109, 40, 217],
  rose: [190, 24, 93],
  rust: [154, 52, 18],
};

export const ACCENT_NAMES = Object.keys(ACCENTS);

/** Each accent as CSS, for the swatches in the style toolbar. */
export const ACCENT_CSS: Record<string, string> = Object.fromEntries(
  Object.entries(ACCENTS).map(([name, [r, g, b]]) => [name, `rgb(${r}, ${g}, ${b})`]),
);

type Resolved = {
  fontScale: number;
  headerPosition: "left" | "center";
  accent: RGB;
  lineSpacing: number;
  justify: boolean;
  spec: TemplateSpec;
  /** The jsPDF family to draw with — see fonts.ts. */
  font: string;
};

function resolve(pdf: JsPdf, style: ResumeStyle, template: string): Resolved {
  const spec = templateSpec(template);
  const family = pdfFamily(style.font ?? spec.font);
  // A font that wasn't registered with this document — it failed to load, or
  // the caller didn't prepare it — falls back to Helvetica rather than
  // failing the whole render.
  const font = family in pdf.getFontList() ? family : "helvetica";
  return {
    // Stored as a percentage so the UI slider reads naturally; used as a ratio.
    fontScale: (style.fontScale ?? 100) / 100,
    headerPosition: style.headerPosition ?? "center",
    accent: ACCENTS[style.accent ?? "slate"] ?? ACCENTS.slate,
    lineSpacing: style.lineSpacing ?? 1.4,
    justify: style.justify ?? false,
    spec,
    font,
  };
}

/** A column of text with its own vertical cursor and page. */
type Flow = { x: number; width: number; y: number; page: number };

export function renderResumePdf(
  pdf: JsPdf,
  doc: ResumeDocument,
  style: ResumeStyle = {},
  template = "banner",
) {
  const s = resolve(pdf, style, template);
  const { spec } = s;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const bottom = pageHeight - spec.margin;

  const { profile, content } = doc;
  const fields = resolveHeaderFields(style.header);
  const contactParts = headerSegments(profile.contact, fields);
  const experiences = renderedExperiences(doc);

  /**
   * Page furniture — the filled shapes text sits on top of.
   *
   * Painted the moment a page exists, before anything is written to it,
   * because jsPDF has no z-order: a rectangle drawn later covers the text
   * already there.
   */
  const paintChrome = (page: number) => {
    // The banner and the wave belong to the first page only. Repeating either
    // on page two reads as a second resume rather than a continuation.
    if (spec.header === "banner" && page === 1) {
      pdf.setFillColor(...s.accent);
      pdf.rect(0, 0, pageWidth, bannerHeight(), "F");
    }
    if (spec.header === "wave" && page === 1) {
      paintWave();
    }
  };

  const bannerHeight = () =>
    (contactParts.length ? 118 : 96) * Math.max(0.9, s.fontScale);

  /** The wave panel: the header's height, and the curve's dip below it. */
  const waveHeight = () => (contactParts.length ? 132 : 108) * Math.max(0.9, s.fontScale);
  const waveDip = () => 26;

  /**
   * A vertical linear gradient, drawn as a stack of thin bands.
   *
   * PDF has real gradients — axial shading dictionaries — but jsPDF's public
   * API exposes no way to build one, so this approximates it. One band per
   * point of height keeps each under a printer's dot, and the half-point
   * overlap stops hairline seams appearing between them where the rasteriser
   * rounds edges the same way twice.
   */
  const gradientBand = (
    x: number,
    y: number,
    width: number,
    height: number,
    from: RGB,
    to: RGB,
  ) => {
    const steps = Math.min(320, Math.max(24, Math.ceil(height)));
    const band = height / steps;
    for (let i = 0; i < steps; i += 1) {
      pdf.setFillColor(...mix(from, to, i / (steps - 1)));
      pdf.rect(x, y + i * band, width, band + 0.5, "F");
    }
  };

  /**
   * The header on a deep panel of the accent whose lower edge curves into the
   * page.
   *
   * It holds the header and nothing else. It used to be a pale wash that the
   * summary and skills flowed across, which put body text on a coloured
   * ground — legible, but greyed and low in contrast. Now the panel is dark
   * enough for white text (the name, title and contact are reversed out of
   * it) and the body starts on white paper below the curve.
   *
   * Clipped rather than masked with a white shape: a mask would show as a
   * pale slab the moment anything sat behind it.
   */
  const paintWave = () => {
    const base = waveHeight();
    const dip = waveDip();

    pdf.saveGraphicsState();
    pdf.moveTo(0, 0);
    pdf.lineTo(pageWidth, 0);
    pdf.lineTo(pageWidth, base);
    // Control points at 4/3 the dip put the curve's midpoint at exactly `dip`
    // below the edges, which is what makes the bulge look measured.
    pdf.curveTo(pageWidth * 0.66, base + dip * 1.34, pageWidth * 0.34, base + dip * 1.34, 0, base);
    pdf.clip();
    pdf.discardPath();
    // Darkest at the top, where the name is; the accent itself by the curve.
    gradientBand(0, 0, pageWidth, base + dip + 1, shade(s.accent, 0.45), shade(s.accent, 0.08));
    pdf.restoreGraphicsState();
  };

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

  /** Lines of `text` that fit `width`, measured in the weight they'll be drawn in. */
  const wrap = (text: string, size: number, width: number, bold = false) => {
    pdf.setFont(s.font, bold ? "bold" : "normal");
    pdf.setFontSize(size);
    return pdf.splitTextToSize(text, width) as string[];
  };

  /** A filled dot, centred on the x-height of text set at `size` on baseline `y`. */
  const dot = (x: number, y: number, size: number, color: RGB, radius = 1.3) => {
    pdf.setFillColor(...color);
    pdf.circle(x, y - size * 0.3, radius, "F");
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
      /** Letterspacing. Small caps need it; body copy never does. */
      charSpace?: number;
    } = {},
  ) => {
    pdf.setFont(s.font, opts.bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...(opts.color ?? INK));
    pdf.text(value, x, y, {
      lineHeightFactor: s.lineSpacing,
      align: opts.align ?? "left",
      ...(opts.charSpace ? { charSpace: opts.charSpace } : {}),
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
      pdf.setFont(s.font, "bold");
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

    const label = title.toUpperCase();
    const spaced = { charSpace: spec.headingSpace };

    /**
     * The heading on a pale strip of the accent, full width. Darker text than
     * the accent itself: the accent on its own tint is too close in value to
     * read comfortably at heading size.
     */
    if (spec.heading === "band") {
      const top = flow.y - size * 0.95 - 4;
      const height = size + 9;
      pdf.setFillColor(...tint(color, 0.9));
      pdf.rect(flow.x, top, flow.width, height, "F");
      write(label, flow.x + 8, flow.y, size, { bold: true, color: shade(color, 0.2), ...spaced });
      flow.y = top + height + 13;
      return;
    }

    write(label, flow.x, flow.y, size, { bold: true, color, ...spaced });

    /**
     * A hairline from the end of the heading to the margin, on the middle of
     * its capitals: the heading and the rule read as one line, which takes
     * less height than a rule underneath and still divides the page.
     */
    if (spec.heading === "inline") {
      pdf.setFont(s.font, "bold");
      pdf.setFontSize(size);
      const width =
        pdf.getTextWidth(label) + (spec.headingSpace ?? 0) * Math.max(0, label.length - 1);
      const lineY = flow.y - size * 0.34;
      pdf.setDrawColor(...tint(color, 0.6));
      pdf.setLineWidth(0.7);
      pdf.line(flow.x + width + 8, lineY, flow.x + flow.width, lineY);
      flow.y += size * 0.8 + 7;
      return;
    }

    // "bar": a short thick stub beneath. It anchors the heading without
    // drawing a line across the whole column.
    flow.y += 5;
    pdf.setFillColor(...color);
    pdf.rect(flow.x, flow.y, 34, 2.4, "F");
    flow.y += 12;
  };

  const bullet = (flow: Flow, text: string, color = INK, offset = 0) => {
    const size = 9 * s.fontScale;
    const indent = offset + 13;
    const lines = wrap(text, size, flow.width - indent - 4);
    const height = lines.length * size * s.lineSpacing + 3;
    advance(flow, height);
    on(flow);

    // On the middle of the x-height, in the accent when the template asks.
    dot(flow.x + offset + 3, flow.y, size, spec.accentBullets ? s.accent : color, 1.25);
    write(lines, flow.x + indent, flow.y, size, {
      color,
      justify: s.justify,
      maxWidth: flow.width - indent - 4,
    });
    flow.y += height;
  };

  // -------------------------------------------------------------- header

  const main: Flow = { x: spec.margin, width: pageWidth - spec.margin * 2, y: spec.margin, page: 1 };

  const nameSize = 21 * s.fontScale * (spec.nameScale ?? 1);
  const titleSize = 11 * s.fontScale;
  const contactSize = 8.5 * s.fontScale;
  const CONTACT_SEP = spec.contactSeparator;

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
      pdf.setFont(s.font, "normal");
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

  const centered = s.headerPosition === "center";
  const align = centered ? "center" : "left";

  if (spec.header === "banner" || spec.header === "wave") {
    /**
     * Name, title and contact reversed out of a filled panel. The banner is the
     * accent itself; the wave is a deeper gradient of it, so both take white
     * text — and a pale accent on the banner takes ink instead.
     */
    const fill = spec.header === "wave" ? shade(s.accent, 0.3) : s.accent;
    const light = prefersLightText(fill);
    const reversed: RGB = light ? [255, 255, 255] : INK;
    const soft = light ? tint(s.accent, spec.header === "wave" ? 0.82 : 0.78) : shade(s.accent, 0.45);
    const anchor = centered ? pageWidth / 2 : spec.margin;

    let y = spec.margin + nameSize * 0.4;
    write(profile.fullName, anchor, y, nameSize, { bold: true, color: reversed, align });
    y += nameSize * 0.95;
    write(content.targetTitle, anchor, y, titleSize, { color: soft, align });
    y += titleSize * 1.5;
    contactLine(anchor, y, pageWidth - spec.margin * 2, align, soft);

    // The first section heading adds its own sectionGap on top of this, so the
    // offset here is deliberately less than a full margin.
    main.y =
      spec.header === "wave"
        ? waveHeight() + waveDip() + spec.margin * 0.25
        : bannerHeight() + spec.margin * 0.45;
  } else {
    /**
     * Name in ink, the role in the accent, contact muted. A left-aligned header
     * can carry an accent bar down its edge (Signal), with the text set in
     * from it; a centred one never does — a bar beside centred text points at
     * nothing.
     */
    const bar = Boolean(spec.headerBar) && !centered;
    const anchor = centered ? pageWidth / 2 : spec.margin + (bar ? 14 : 0);
    const width = main.width - (bar ? 14 : 0);
    const top = main.y;

    write(profile.fullName, anchor, main.y + nameSize * 0.3, nameSize, { bold: true, align });
    main.y += nameSize * 1.05;
    write(content.targetTitle, anchor, main.y, titleSize, { bold: true, color: s.accent, align });
    main.y += titleSize * 1.3;
    main.y += contactLine(anchor, main.y, width, align, MUTED);

    if (bar) {
      pdf.setFillColor(...s.accent);
      pdf.rect(spec.margin, top - 2, 4, main.y - top - contactSize * 0.4, "F");
    }

    // A rule closing the header, so the block reads as a masthead rather than
    // as the first three lines of the document.
    if (spec.headerRule) {
      main.y += 4;
      pdf.setDrawColor(...s.accent);
      pdf.setLineWidth(spec.headerRule);
      pdf.line(spec.margin, main.y, pageWidth - spec.margin, main.y);
      main.y += 2;
    }
  }

  // -------------------------------------------------------- main column

  if (content.summary) {
    heading(main, "Summary");
    block(main, wrap(content.summary, 9.5 * s.fontScale, main.width), 9.5 * s.fontScale);
  }

  /**
   * Skills, one category at a time, each opening with an accent dot and its
   * name in bold — so the categories read as a list of their own rather than
   * running into one another.
   *
   * inline  "• Languages: Go, TypeScript, …", wrapping under the name
   * grid    the name in a column of its own, its skills beside it
   */
  const skills = (flow: Flow) => {
    const size = 9 * s.fontScale;
    const lineHeight = size * s.lineSpacing;
    const dotGap = 9;

    if (spec.skills === "grid") {
      // As wide as the longest category name needs, within reason: short
      // names shouldn't leave a gulf before their skills, and a very long one
      // wraps rather than squeezing the skills into a sliver.
      pdf.setFont(s.font, "bold");
      pdf.setFontSize(size);
      const longest = Math.max(...content.skills.map((g) => pdf.getTextWidth(g.name)));
      const labelWidth = Math.min(Math.max(longest + dotGap + 14, 80), flow.width * 0.3);
      for (const group of content.skills) {
        const label = wrap(group.name, size, labelWidth - dotGap - 8, true);
        const items = wrap(group.items.join(", "), size, flow.width - labelWidth);
        const height = Math.max(label.length, items.length) * lineHeight;
        advance(flow, height);
        on(flow);
        dot(flow.x + 2.2, flow.y, size, s.accent, 1.5);
        write(label, flow.x + dotGap, flow.y, size, { bold: true });
        write(items, flow.x + labelWidth, flow.y, size);
        flow.y += height + 2.5;
      }
      return;
    }

    const x = flow.x + dotGap;
    const width = flow.width - dotGap;
    for (const group of content.skills) {
      const label = `${group.name}: `;
      pdf.setFont(s.font, "bold");
      pdf.setFontSize(size);
      const labelWidth = pdf.getTextWidth(label);

      // The first line is shortened by the label; the rest run the full width
      // under it. The 0.35 floor stops a long category name squeezing the
      // first line to a few characters.
      const firstWidth = Math.max(width - labelWidth, width * 0.35);
      const all = wrap(group.items.join(", "), size, firstWidth);
      const first = all.shift() ?? "";
      const rest = all.length ? wrap(all.join(" "), size, width) : [];

      advance(flow, (1 + rest.length) * lineHeight);
      on(flow);
      dot(flow.x + 2.2, flow.y, size, s.accent, 1.5);
      write(label, x, flow.y, size, { bold: true });
      write(first, x + labelWidth, flow.y, size);
      flow.y += lineHeight;
      if (rest.length) {
        write(rest, x, flow.y, size);
        flow.y += rest.length * lineHeight;
      }
      flow.y += 1.5;
    }
  };

  if (content.skills.length) {
    heading(main, "Skills");
    skills(main);
  }

  if (experiences.length) {
    heading(main, "Experience");
    for (const { employment, title, bullets } of experiences) {
      const headSize = 10 * s.fontScale;
      const metaSize = 8.5 * s.fontScale;

      advance(main, (headSize + metaSize) * s.lineSpacing);
      on(main);

      const period = `${formatMonthYear(employment.startDate)} – ${formatMonthYear(
        employment.endDate ?? null,
        "Present",
      )}`;
      // Right-aligned on the title's baseline, so a role and its period read
      // as one row rather than two stacked lines.
      write(period, main.x + main.width, main.y, metaSize, { color: MUTED, align: "right" });

      write(title, main.x, main.y, headSize, { bold: true });
      main.y += headSize * s.lineSpacing;

      write(
        [employment.company, employment.location].filter(Boolean).join(" · "),
        main.x,
        main.y,
        metaSize,
        { color: s.accent },
      );
      main.y += metaSize * s.lineSpacing + 2;

      for (const b of bullets) bullet(main, b.text, INK);
      main.y += 5;
    }
  }

  if (profile.education.length) {
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
  template = "banner",
): Promise<string> {
  const pdf = await newResumePdf(style, template);
  renderResumePdf(pdf, doc, style, template);
  return URL.createObjectURL(pdf.output("blob"));
}

/**
 * A blank A4 document with the resume's font registered.
 *
 * jsPDF is imported here rather than at module scope so it lands in its own
 * chunk — it is ~350 KB, and a page that merely *offers* a download shouldn't
 * pay for it on first load. A font that can't be fetched leaves the document
 * without it, and the renderer then sets the resume in Helvetica rather than
 * failing.
 */
export async function newResumePdf(
  style: ResumeStyle,
  template: string,
  load?: FontLoader,
): Promise<JsPdf> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true });
  try {
    await prepareFont(pdf, style.font ?? templateSpec(template).font, load);
  } catch {
    // See above: Helvetica it is.
  }
  return pdf;
}

/**
 * The PDF as a file, for attaching to an application as well as saving it.
 * Same renderer as everything else here, so what is filed is what was shown.
 */
export async function renderResumePdfBlob(
  doc: ResumeDocument,
  style: ResumeStyle = {},
  template = "banner",
): Promise<Blob> {
  const pdf = await newResumePdf(style, template);
  renderResumePdf(pdf, doc, style, template);
  return pdf.output("blob");
}

/** "Jane Doe — Senior Engineer.pdf", without characters a filesystem refuses. */
export function resumeFileName(doc: ResumeDocument): string {
  const safe = (value: string) => value.replace(/[\\/:*?"<>|]+/g, "").trim();
  return `${safe(doc.profile.fullName) || "Resume"} — ${safe(doc.content.targetTitle)}.pdf`;
}

/** Hands a file to the browser's download. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  // Revoked after the click has had a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Builds the PDF and hands it to the user.
 *
 * Prefers showSaveFilePicker where available (Chromium) so the user picks the
 * destination, falling back to pdf.save() elsewhere. Returns false when the
 * user cancels the picker, which is not an error and must not surface as one.
 */
export async function downloadResumePdf(
  doc: ResumeDocument,
  style: ResumeStyle = {},
  template = "banner",
): Promise<boolean> {
  const pdf = await newResumePdf(style, template);
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
