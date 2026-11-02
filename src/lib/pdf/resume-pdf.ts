import type { jsPDF as JsPdf } from "jspdf";

import {
  educationYears,
  formatMonthYear,
  renderedExperiences,
  type ResumeDocument,
} from "@/lib/document/schema";
import { headerSegments, resolveHeaderFields, type HeaderSegment } from "@/lib/resume-header";
import { pdfFamily, prepareFont, type FontLoader } from "@/lib/pdf/fonts";
import {
  mix,
  prefersLightText,
  shade,
  templateSpec,
  tint,
  type RGB,
  type SectionId,
  type TemplateSpec,
  type Tone,
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
const WHITE: RGB = [255, 255, 255];

/** Where the sections go when a template doesn't say otherwise. */
const DEFAULT_ORDER: SectionId[] = ["summary", "skills", "experience", "education"];

/** The drawn icons: one per kind of contact detail, and a calendar for dates. */
type IconKind = HeaderSegment["kind"] | "calendar";

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
      pdf.setFillColor(...bannerFill);
      pdf.rect(0, 0, pageWidth, bannerHeight(), "F");
    }
    if (spec.header === "wave" && page === 1) {
      paintWave();
    }
  };

  const bannerHeight = () =>
    (contactParts.length ? 118 : 96) * Math.max(0.9, s.fontScale);

  /** The banner's colour: the accent, or a deeper shade of it where the template asks. */
  const bannerFill = spec.fillShade ? shade(s.accent, spec.fillShade) : s.accent;

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
  /** Per page, the lowest point content reached — see the timeline, at the end. */
  const reach = new Map<number, number>();
  /** Where the timeline puts a dot: each section heading. */
  const dots: Array<{ page: number; y: number }> = [];
  paintChrome(1);

  /** Moves a flow down, opening or stepping onto a page when it runs out. */
  const advance = (flow: Flow, height: number) => {
    if (flow.y + height <= bottom) return;

    // How far down this page the content reached, for the timeline's line.
    reach.set(flow.page, Math.max(reach.get(flow.page) ?? 0, flow.y));
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

  /** A colour a template names by role — see `Tone` in templates.ts. */
  const tone = (t: Tone | undefined, fallback: RGB): RGB =>
    t === "accent"
      ? s.accent
      : t === "ink"
        ? INK
        : t === "muted"
          ? MUTED
          : t === "highlight"
            ? (spec.highlight ?? s.accent)
            : fallback;

  /** How wide text will be drawn, letterspacing included. */
  const measure = (text: string, size: number, bold = false, space = 0) => {
    pdf.setFont(s.font, bold ? "bold" : "normal");
    pdf.setFontSize(size);
    return pdf.getTextWidth(text) + space * Math.max(0, text.length - 1);
  };

  /**
   * Text that may be letterspaced, aligned by hand when it is: jsPDF centres
   * and right-aligns on the width without its charSpace, so spaced capitals
   * left to it drift off centre by half their spacing.
   */
  const writeSpaced = (
    text: string,
    x: number,
    y: number,
    size: number,
    opts: { bold?: boolean; color?: RGB; space?: number; align?: "left" | "center" | "right" } = {},
  ) => {
    if (!opts.space) {
      write(text, x, y, size, { bold: opts.bold, color: opts.color, align: opts.align });
      return;
    }
    const width = measure(text, size, opts.bold, opts.space);
    const left = opts.align === "center" ? x - width / 2 : opts.align === "right" ? x - width : x;
    write(text, left, y, size, { bold: opts.bold, color: opts.color, charSpace: opts.space });
  };

  /**
   * A small icon, drawn rather than set as a glyph — so the text an
   * applicant-tracking system extracts is the detail alone, with no stray
   * symbol characters. Sits on the x-height of text of `size` on baseline `y`;
   * returns its width. `ground` is the colour behind it, for the pin's hole.
   */
  const icon = (kind: IconKind, x: number, y: number, size: number, color: RGB, ground: RGB = WHITE) => {
    const u = size * 0.92;
    const cx = x + u / 2;
    const cy = y - size * 0.33;
    pdf.setDrawColor(...color);
    pdf.setFillColor(...color);
    pdf.setLineWidth(Math.max(0.45, u * 0.075));
    if (kind === "email") {
      const w = u * 0.94;
      const h = u * 0.66;
      pdf.rect(cx - w / 2, cy - h / 2, w, h, "S");
      pdf.line(cx - w / 2, cy - h / 2, cx, cy + h * 0.08);
      pdf.line(cx, cy + h * 0.08, cx + w / 2, cy - h / 2);
    } else if (kind === "phone") {
      pdf.roundedRect(cx - u * 0.25, cy - u * 0.47, u * 0.5, u * 0.94, u * 0.09, u * 0.09, "S");
      pdf.line(cx - u * 0.08, cy + u * 0.33, cx + u * 0.08, cy + u * 0.33);
    } else if (kind === "location") {
      pdf.circle(cx, cy - u * 0.13, u * 0.31, "F");
      pdf.triangle(cx - u * 0.27, cy - u * 0.02, cx + u * 0.27, cy - u * 0.02, cx, cy + u * 0.48, "F");
      pdf.setFillColor(...ground);
      pdf.circle(cx, cy - u * 0.13, u * 0.11, "F");
    } else if (kind === "link") {
      pdf.circle(cx, cy, u * 0.44, "S");
      pdf.ellipse(cx, cy, u * 0.18, u * 0.44, "S");
      pdf.line(cx - u * 0.44, cy, cx + u * 0.44, cy);
    } else {
      pdf.rect(cx - u * 0.42, cy - u * 0.34, u * 0.84, u * 0.76, "S");
      pdf.rect(cx - u * 0.42, cy - u * 0.34, u * 0.84, u * 0.2, "F");
      pdf.line(cx - u * 0.2, cy - u * 0.48, cx - u * 0.2, cy - u * 0.3);
      pdf.line(cx + u * 0.2, cy - u * 0.48, cx + u * 0.2, cy - u * 0.3);
    }
    return u;
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
    // A heading with no room beneath it is a heading stranded at the foot of a
    // page, so it's reserved together with the first two lines of what follows
    // — the heading alone takes about 34pt, and an entry's first rows another 28.
    advance(flow, 62);
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

    if (spec.heading === "band" || spec.heading === "inline" || spec.heading === "bar") {
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
      return;
    }

    // ---- the headings added with the second set of templates
    const t = spec.headingText ?? {};
    const hs = size * (t.scale ?? 1);
    const label = t.titleCase ? title : title.toUpperCase();
    const bold = t.weight !== "normal";
    const ink = tone(t.tone, color);
    const space = spec.headingSpace;
    const rule = spec.ruleTone === "pale" ? tint(s.accent, 0.6) : tone(spec.ruleTone, tint(s.accent, 0.6));
    const capMiddle = flow.y - hs * 0.34;

    // In the left column, level with the first line of what follows.
    if (spec.layout === "labels") {
      writeSpaced(label, spec.margin, flow.y, hs, { bold, color: ink, space });
      return;
    }
    if (spec.layout === "timeline") dots.push({ page: flow.page, y: capMiddle });

    // A drawn ">" before the heading, as a shell prompt — not typed, so the
    // heading an applicant-tracking system reads is the word alone.
    let x = flow.x;
    if (t.chevron) {
      pdf.setDrawColor(...s.accent);
      pdf.setLineWidth(1.1);
      pdf.line(x, flow.y - hs * 0.72, x + hs * 0.4, capMiddle);
      pdf.line(x + hs * 0.4, capMiddle, x, flow.y + hs * 0.02);
      x += hs * 0.85;
    }

    if (spec.heading === "rule") {
      writeSpaced(label, x, flow.y, hs, { bold, color: ink, space });
      const y = flow.y + hs * 0.45;
      pdf.setDrawColor(...rule);
      pdf.setLineWidth(0.6);
      pdf.line(flow.x, y, flow.x + flow.width, y);
      flow.y = y + 12;
      return;
    }

    if (spec.heading === "center") {
      const width = measure(label, hs, bold, space);
      const middle = flow.x + flow.width / 2;
      writeSpaced(label, middle, flow.y, hs, { bold, color: ink, space, align: "center" });
      pdf.setDrawColor(...rule);
      pdf.setLineWidth(0.6);
      pdf.line(flow.x, capMiddle, middle - width / 2 - 10, capMiddle);
      pdf.line(middle + width / 2 + 10, capMiddle, flow.x + flow.width, capMiddle);
      flow.y += hs * 0.8 + 8;
      return;
    }

    // Reversed out of a solid band: white on a deep accent, ink on a pale one.
    if (spec.heading === "fill") {
      const top = flow.y - hs * 0.95 - 4;
      const height = hs + 9;
      pdf.setFillColor(...s.accent);
      pdf.rect(flow.x, top, flow.width, height, "F");
      writeSpaced(label, x + 8, flow.y, hs, {
        bold,
        color: prefersLightText(s.accent) ? WHITE : INK,
        space,
      });
      flow.y = top + height + 13;
      return;
    }

    if (spec.heading === "tab") {
      const padX = 8;
      const padY = 4;
      const width = measure(label, hs, bold, space) + padX * 2;
      const top = flow.y - hs * 0.95 - padY + 1;
      const height = hs + padY * 2;
      pdf.setFillColor(...tint(s.accent, 0.84));
      pdf.rect(x, top, width, height, "F");
      writeSpaced(label, x + padX, flow.y, hs, { bold, color: tone(t.tone, shade(s.accent, 0.2)), space });
      pdf.setDrawColor(...rule);
      pdf.setLineWidth(0.6);
      pdf.line(x + width, top + height, flow.x + flow.width, top + height);
      flow.y = top + height + 12;
      return;
    }

    if (spec.heading === "dash") {
      pdf.setDrawColor(...s.accent);
      pdf.setLineWidth(1.6);
      pdf.line(x, capMiddle, x + 10, capMiddle);
      writeSpaced(label, x + 16, flow.y, hs, { bold, color: ink, space });
      flow.y += hs * 0.8 + 9;
      return;
    }

    if (spec.heading === "underline") {
      writeSpaced(label, x, flow.y, hs, { bold, color: ink, space });
      const y = flow.y + 5;
      pdf.setDrawColor(...tone("highlight", s.accent));
      pdf.setLineWidth(1);
      pdf.line(x, y, x + 26, y);
      flow.y = y + 13;
      return;
    }

    // "text": the heading alone.
    writeSpaced(label, x, flow.y, hs, { bold, color: ink, space });
    flow.y += hs * 0.8 + 9;
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

  /**
   * The contact details laid out a detail at a time, in rows that break
   * between details rather than inside one — for templates with icons, and
   * for the split header's right-aligned block. Each detail is placed by
   * hand, so its link box is exact even when the details wrap.
   */
  const ICON_GAP = 3.5;
  const contactRows = (width: number, icons: boolean) => {
    const gap = icons ? 13 : measure(CONTACT_SEP, contactSize);
    const rows: Array<Array<{ part: HeaderSegment; width: number }>> = [];
    let row: Array<{ part: HeaderSegment; width: number }> = [];
    let used = 0;
    for (const part of contactParts) {
      const w = (icons ? contactSize * 0.92 + ICON_GAP : 0) + measure(part.text, contactSize);
      if (row.length && used + gap + w > width) {
        rows.push(row);
        row = [];
        used = 0;
      }
      used += (row.length ? gap : 0) + w;
      row.push({ part, width: w });
    }
    if (row.length) rows.push(row);
    return { rows, gap };
  };

  const contactBlock = (
    x: number,
    y: number,
    width: number,
    align: "left" | "center" | "right",
    color: RGB,
    icons: boolean,
    ground: RGB = WHITE,
  ) => {
    const { rows, gap } = contactRows(width, icons);
    const visibleSep = CONTACT_SEP.trim() ? CONTACT_SEP : "";
    let line = y;
    for (const row of rows) {
      const total = row.reduce((sum, item) => sum + item.width, 0) + gap * (row.length - 1);
      let cursor = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
      row.forEach(({ part, width: w }, i) => {
        if (i && visibleSep) write(visibleSep, cursor - gap, line, contactSize, { color });
        let textX = cursor;
        if (icons) textX += icon(part.kind, cursor, line, contactSize, color, ground) + ICON_GAP;
        write(part.text, textX, line, contactSize, { color });
        if (part.href) {
          pdf.link(textX, line - contactSize, w - (textX - cursor), contactSize * 1.2, { url: part.href });
        }
        cursor += w + gap;
      });
      line += contactSize * s.lineSpacing;
    }
    return rows.length * contactSize * s.lineSpacing;
  };

  /** The contact details in the template's way: with icons, or as one line. */
  const contact = (x: number, y: number, width: number, align: "left" | "center", color: RGB, ground?: RGB) =>
    spec.icons ? contactBlock(x, y, width, align, color, true, ground) : contactLine(x, y, width, align, color);

  // The split header is left-aligned by design: its right side is the contact.
  const centered = spec.header !== "split" && s.headerPosition === "center";
  const align = centered ? "center" : "left";

  const nameText = spec.name?.upper ? profile.fullName.toUpperCase() : profile.fullName;
  const titleText = spec.title?.upper ? content.targetTitle.toUpperCase() : content.targetTitle;

  const drawName = (x: number, y: number, color: RGB) =>
    writeSpaced(nameText, x, y, nameSize, {
      bold: spec.name?.weight !== "normal",
      color: tone(spec.name?.tone, color),
      space: spec.name?.space,
      align,
    });

  /**
   * The target title. `fallback` and `fallbackBold` are the header's own
   * defaults — bold accent on a plain header, a pale tint on a filled one —
   * which a template's `title` overrides.
   */
  const drawTitle = (x: number, y: number, fallback: RGB, fallbackBold: boolean) => {
    const t = spec.title;
    const color = tone(t?.tone, fallback);
    const bold = t?.weight ? t.weight === "bold" : fallbackBold;
    if (!t?.slashes) {
      writeSpaced(titleText, x, y, titleSize, { bold, color, space: t?.space, align });
      return;
    }
    // Two drawn strokes, "//", then the title — placed together as one run.
    const mark = titleSize * 1.05;
    const width = mark + measure(titleText, titleSize, bold, t.space);
    const start = align === "center" ? x - width / 2 : x;
    pdf.setDrawColor(...color);
    pdf.setLineWidth(0.8);
    for (const offset of [0, titleSize * 0.32]) {
      pdf.line(start + offset, y + 0.5, start + offset + titleSize * 0.3, y - titleSize * 0.72);
    }
    writeSpaced(titleText, start + mark, y, titleSize, { bold, color, space: t.space });
  };

  /** A short line–diamond–line under the title, in the template's highlight. */
  const ornament = (middle: number, y: number) => {
    const c = tone("highlight", s.accent);
    pdf.setDrawColor(...c);
    pdf.setFillColor(...c);
    pdf.setLineWidth(0.6);
    pdf.line(middle - 36, y, middle - 7, y);
    pdf.line(middle + 7, y, middle + 36, y);
    const d = 3;
    pdf.triangle(middle - d, y, middle, y - d, middle + d, y, "F");
    pdf.triangle(middle - d, y, middle, y + d, middle + d, y, "F");
  };

  /** The header rule — doubled, in ink or the accent, as the template says. Returns its height. */
  const headerRules = (y: number) => {
    const weight = spec.headerRule ?? 0;
    pdf.setDrawColor(...tone(spec.headerRuleTone, s.accent));
    pdf.setLineWidth(weight);
    pdf.line(spec.margin, y, pageWidth - spec.margin, y);
    if (!spec.headerRuleDouble) return 0;
    const second = y + weight + 1.8;
    pdf.setLineWidth(Math.max(0.5, weight * 0.4));
    pdf.line(spec.margin, second, pageWidth - spec.margin, second);
    return second - y;
  };

  if (spec.header === "banner" || spec.header === "wave") {
    /**
     * Name, title and contact reversed out of a filled panel. The banner is the
     * accent itself; the wave is a deeper gradient of it, so both take white
     * text — and a pale accent on the banner takes ink instead.
     */
    const fill = spec.header === "wave" ? shade(s.accent, 0.3) : bannerFill;
    const light = prefersLightText(fill);
    const reversed: RGB = light ? [255, 255, 255] : INK;
    const soft = light ? tint(s.accent, spec.header === "wave" ? 0.82 : 0.78) : shade(s.accent, 0.45);
    const anchor = centered ? pageWidth / 2 : spec.margin;

    let y = spec.margin + nameSize * 0.4;
    drawName(anchor, y, reversed);
    y += nameSize * 0.95;
    drawTitle(anchor, y, soft, false);
    y += titleSize * 1.5;
    contact(anchor, y, pageWidth - spec.margin * 2, align, soft, fill);

    // The first section heading adds its own sectionGap on top of this, so the
    // offset here is deliberately less than a full margin.
    main.y =
      spec.header === "wave"
        ? waveHeight() + waveDip() + spec.margin * 0.25
        : bannerHeight() + spec.margin * 0.45;
  } else if (spec.header === "card") {
    /**
     * A rounded panel of the accent inside the margins, the header reversed
     * out of it. Laid out first and painted before any text, since jsPDF has
     * no z-order: the panel has to exist under the words, not over them.
     */
    const pad = 18;
    const inner = main.width - pad * 2;
    const fill = shade(s.accent, spec.fillShade ?? 0.45);
    const light = prefersLightText(fill);
    const reversed: RGB = light ? WHITE : INK;
    const soft = light ? tint(s.accent, 0.72) : shade(s.accent, 0.45);
    const anchor = centered ? pageWidth / 2 : spec.margin + pad;

    const top = main.y;
    const nameY = top + pad + nameSize * 0.72;
    const titleY = nameY + titleSize * 1.55;
    const contactY = titleY + titleSize * 1.5;
    const rows = contactParts.length
      ? spec.icons
        ? contactRows(inner, true).rows.length
        : wrap(contactParts.map((p) => p.text).join(CONTACT_SEP), contactSize, inner).length
      : 0;
    const end = (rows ? contactY + (rows - 1) * contactSize * s.lineSpacing + contactSize * 0.3 : titleY) + pad;

    pdf.setFillColor(...fill);
    pdf.roundedRect(spec.margin, top, main.width, end - top, 6, 6, "F");
    drawName(anchor, nameY, reversed);
    drawTitle(anchor, titleY, soft, false);
    contact(anchor, contactY, inner, align, soft, fill);
    main.y = end + 2;
  } else if (spec.header === "split") {
    /**
     * Name and title on the left, the contact details stacked against the
     * right margin, a rule under both. The two columns are as tall as the
     * taller of them.
     */
    const right = pageWidth - spec.margin;
    const top = main.y;
    drawName(spec.margin, top + nameSize * 0.3, INK);
    let left = top + nameSize * 1.05;
    drawTitle(spec.margin, left, MUTED, false);
    left += titleSize * 0.6;
    const contactWidth = main.width * 0.46;
    const height = contactBlock(right, top - contactSize * 0.2, contactWidth, "right", MUTED, Boolean(spec.icons));
    main.y = Math.max(left, top - contactSize * 0.2 + height - contactSize * s.lineSpacing + contactSize * 0.6) + 8;
    if (spec.headerRule) {
      main.y += headerRules(main.y) + 2;
    }
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

    // A bar of the accent along the top of the page, above the name.
    if (spec.topBar) {
      pdf.setFillColor(...s.accent);
      pdf.rect(spec.margin, spec.margin - 22, main.width, spec.topBar, "F");
      main.y += spec.topBar;
    }
    const top = main.y;

    drawName(anchor, main.y + nameSize * 0.3, INK);
    main.y += nameSize * 1.05;
    drawTitle(anchor, main.y, s.accent, true);
    main.y += titleSize * 1.3;

    if (spec.ornament) {
      ornament(centered ? pageWidth / 2 : anchor + 36, main.y - titleSize * 0.1);
      main.y += 13;
    }
    // A rule between the title and the contact line (Classic).
    if (spec.headerRule && spec.headerRuleUnderTitle) {
      const y = main.y - titleSize * 0.55;
      main.y = y + headerRules(y) + contactSize * 1.9;
    }

    main.y += contact(anchor, main.y, width, align, MUTED);

    if (bar) {
      pdf.setFillColor(...s.accent);
      pdf.rect(spec.margin, top - 2, 4, main.y - top - contactSize * 0.4, "F");
    }

    // A rule closing the header, so the block reads as a masthead rather than
    // as the first three lines of the document.
    if (spec.headerRule && !spec.headerRuleUnderTitle) {
      main.y += 4;
      main.y += headerRules(main.y);
      main.y += 2;
    }
  }

  // -------------------------------------------------------- main column

  /**
   * Two layouts narrow the column the sections flow in: one for the section
   * names in a margin of their own (labels), one for the line and dots down
   * the left (timeline).
   */
  if (spec.layout === "labels") {
    main.x += 96;
    main.width -= 96;
  }
  if (spec.layout === "timeline") {
    main.x += 22;
    main.width -= 22;
  }

  const summary = () => {
    if (!content.summary) return;
    heading(main, "Summary");
    block(main, wrap(content.summary, 9.5 * s.fontScale, main.width), 9.5 * s.fontScale);
  };

  /**
   * Skills, one category at a time, each opening with an accent dot and its
   * name in bold — so the categories read as a list of their own rather than
   * running into one another.
   *
   * inline  "• Languages: Go, TypeScript, …", wrapping under the name
   * grid    the name in a column of its own, its skills beside it
   * tags    the name in a column of its own, its skills as boxed or
   *         underlined tags beside it
   * flow    "Languages: Go • TypeScript • …", a category to a line
   * columns the name on a line of its own, its skills in columns beneath
   *
   * Every one keeps the categories: a resume's skills are always grouped,
   * whatever the style — never one undivided list.
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

    if (spec.skills === "tags") {
      // The category in a column, as in the grid, and its tags flowing in
      // rows beside it. Laid out before drawing, so a category's rows are
      // reserved together and never split across a page.
      const boxed = spec.tags !== "underline";
      const padX = boxed ? 6 : 0;
      const gapX = boxed ? 6 : 13;
      const rowHeight = size + (boxed ? 11 : 10);
      const longest = Math.max(...content.skills.map((g) => measure(g.name, size, true)));
      const labelWidth = Math.min(Math.max(longest + 14, 72), flow.width * 0.3);
      const left = flow.x + labelWidth;
      const right = flow.x + flow.width;
      for (const group of content.skills) {
        const rows: Array<Array<{ item: string; x: number; w: number }>> = [[]];
        let x = left;
        for (const item of group.items) {
          const w = Math.min(measure(item, size) + padX * 2, right - left);
          if (x > left && x + w > right) {
            rows.push([]);
            x = left;
          }
          rows[rows.length - 1].push({ item, x, w });
          x += w + gapX;
        }
        const label = wrap(group.name, size, labelWidth - 10, true);
        const height = Math.max(rows.length * rowHeight, label.length * lineHeight);
        advance(flow, height);
        on(flow);
        write(label, flow.x, flow.y, size, { bold: true });
        rows.forEach((row, r) => {
          const y = flow.y + r * rowHeight;
          for (const { item, x: tx, w } of row) {
            if (boxed) {
              pdf.setDrawColor(...tint(s.accent, 0.55));
              pdf.setLineWidth(0.6);
              pdf.roundedRect(tx, y - size * 0.85 - 2.5, w, size + 5, 2, 2, "S");
            } else {
              pdf.setDrawColor(...tint(s.accent, 0.35));
              pdf.setLineWidth(0.8);
              pdf.line(tx, y + 3, tx + w, y + 3);
            }
            write(item, tx + padX, y, size);
          }
        });
        flow.y += height + 2;
      }
      return;
    }

    if (spec.skills === "columns") {
      // The category on a line of its own, then its skills in columns.
      const cols = flow.width > 420 ? 4 : 3;
      const colWidth = flow.width / cols;
      for (const group of content.skills) {
        const firstRow = group.items.slice(0, cols).map((item) => wrap(item, size, colWidth - dotGap - 6));
        // The name is reserved with the first row, so it never ends a page alone.
        advance(flow, lineHeight + Math.max(1, ...firstRow.map((lines) => lines.length)) * lineHeight);
        on(flow);
        write(group.name, flow.x, flow.y, size, { bold: true });
        flow.y += lineHeight;
        for (let i = 0; i < group.items.length; i += cols) {
          const row = group.items.slice(i, i + cols).map((item) => wrap(item, size, colWidth - dotGap - 6));
          const height = Math.max(...row.map((lines) => lines.length)) * lineHeight;
          advance(flow, height);
          on(flow);
          row.forEach((lines, j) => {
            const x = flow.x + j * colWidth;
            dot(x + 2.2, flow.y, size, s.accent, 1.3);
            write(lines, x + dotGap, flow.y, size);
          });
          flow.y += height + 1.5;
        }
        flow.y += 3;
      }
      return;
    }

    // inline — with or without the accent dot before each category — and
    // flow, which is inline with " • " between skills and no dot.
    const flowing = spec.skills === "flow";
    const separator = flowing ? "  •  " : ", ";
    const dotted = !flowing && spec.skillDots !== false;
    const x = flow.x + (dotted ? dotGap : 0);
    const width = flow.width - (dotted ? dotGap : 0);
    for (const group of content.skills) {
      const label = `${group.name}: `;
      pdf.setFont(s.font, "bold");
      pdf.setFontSize(size);
      const labelWidth = pdf.getTextWidth(label);

      // The first line is shortened by the label; the rest run the full width
      // under it. The 0.35 floor stops a long category name squeezing the
      // first line to a few characters.
      const firstWidth = Math.max(width - labelWidth, width * 0.35);
      const items = wrap(group.items.join(separator), size, firstWidth);
      const first = items.shift() ?? "";
      const rest = items.length ? wrap(items.join(" "), size, width) : [];

      advance(flow, (1 + rest.length) * lineHeight);
      on(flow);
      if (dotted) dot(flow.x + 2.2, flow.y, size, s.accent, 1.5);
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

  const skillSection = () => {
    if (!content.skills.length) return;
    heading(main, "Skills");
    skills(main);
  };

  // ------------------------------------------------------------- entries

  const companyColor = tone(spec.companyTone, s.accent);
  const entry = spec.entry ?? "role";
  /** The left column a `dates` entry keeps its dates and place in. */
  const DATE_COLUMN = 96;
  /** Where a `dates` entry's left column ends, so the next entry clears it. */
  let floor: { page: number; y: number } | null = null;
  const clearFloor = () => {
    if (floor && floor.page === main.page) main.y = Math.max(main.y, floor.y);
    floor = null;
  };

  /**
   * Dates and place on one line: each after its icon where the template
   * draws them, otherwise joined with a middle dot.
   */
  const metaLine = (x: number, y: number, size: number, parts: Array<{ kind: IconKind; text?: string | null }>) => {
    const present = parts.filter((p): p is { kind: IconKind; text: string } => Boolean(p.text));
    if (!spec.icons) {
      write(present.map((p) => p.text).join(" · "), x, y, size, { color: MUTED });
      return;
    }
    let cursor = x;
    for (const p of present) {
      cursor += icon(p.kind, cursor, y, size, MUTED) + ICON_GAP;
      write(p.text, cursor, y, size, { color: MUTED });
      cursor += measure(p.text, size) + 14;
    }
  };

  /**
   * One job or school's heading lines, in the template's arrangement. `head`
   * is the bold line (the role, or the degree), `org` the company or school.
   * Returns the indent its bullets take — a `dates` entry keeps them clear of
   * its date column.
   */
  const entryHead = (head: string, org: string, place: string | null | undefined, period: string) => {
    const headSize = 10 * s.fontScale;
    const metaSize = 8.5 * s.fontScale;
    const right = main.x + main.width;

    if (entry === "company") {
      advance(main, (headSize + metaSize) * s.lineSpacing + 2);
      on(main);
      write(org, main.x, main.y, headSize, { bold: true });
      if (place) write(place, right, main.y, metaSize, { color: MUTED, align: "right" });
      main.y += headSize * s.lineSpacing;
      write(head, main.x, main.y, metaSize + 0.5);
      write(period, right, main.y, metaSize, { color: MUTED, align: "right" });
      main.y += metaSize * s.lineSpacing + 2;
      return 0;
    }

    if (entry === "stacked") {
      advance(main, (headSize + metaSize * 2) * s.lineSpacing + 2);
      on(main);
      write(head, main.x, main.y, headSize, { bold: true });
      main.y += headSize * s.lineSpacing;
      write(org, main.x, main.y, metaSize + 0.5, { bold: true, color: companyColor });
      main.y += (metaSize + 0.5) * s.lineSpacing;
      metaLine(main.x, main.y, metaSize, [
        { kind: "calendar", text: period },
        { kind: "location", text: place },
      ]);
      main.y += metaSize * s.lineSpacing + 2;
      return 0;
    }

    if (entry === "dates") {
      // Wrapped inside the column: "June 2019 – February 2022" is wider than
      // it, and would otherwise run into the role beside it.
      const column = [
        ...wrap(period, metaSize, DATE_COLUMN - 10),
        ...(place ? wrap(place, metaSize, DATE_COLUMN - 10) : []),
      ];
      const columnHeight = column.length * metaSize * s.lineSpacing;
      advance(main, Math.max((headSize + metaSize) * s.lineSpacing + 2, columnHeight));
      on(main);
      write(column, main.x, main.y, metaSize, { color: MUTED });
      // The next entry starts below the column even if this one is shorter.
      floor = { page: main.page, y: main.y + columnHeight };
      write(head, main.x + DATE_COLUMN, main.y, headSize, { bold: true });
      main.y += headSize * s.lineSpacing;
      write(org, main.x + DATE_COLUMN, main.y, metaSize + 0.5, { bold: true, color: companyColor });
      main.y += (metaSize + 0.5) * s.lineSpacing + 2;
      return DATE_COLUMN;
    }

    // "role": the original arrangement, unchanged.
    advance(main, (headSize + metaSize) * s.lineSpacing);
    on(main);
    // Right-aligned on the title's baseline, so a role and its period read
    // as one row rather than two stacked lines.
    write(period, right, main.y, metaSize, { color: MUTED, align: "right" });
    write(head, main.x, main.y, headSize, { bold: true });
    main.y += headSize * s.lineSpacing;
    write([org, place].filter(Boolean).join(" · "), main.x, main.y, metaSize, { color: companyColor });
    main.y += metaSize * s.lineSpacing + 2;
    return 0;
  };

  const experience = () => {
    if (!experiences.length) return;
    heading(main, "Experience");
    for (const { employment, title, bullets } of experiences) {
      const period = `${formatMonthYear(employment.startDate)} – ${formatMonthYear(
        employment.endDate ?? null,
        "Present",
      )}`;
      const indent = entryHead(title, employment.company, employment.location, period);
      for (const b of bullets) bullet(main, b.text, INK, indent);
      clearFloor();
      main.y += 5;
    }
  };

  const education = () => {
    if (!profile.education.length) return;
    heading(main, "Education");
    for (const edu of profile.education) {
      const years = edu.year || edu.startYear ? educationYears(edu) : "";
      if (entry !== "role") {
        entryHead(edu.degree, edu.school, edu.location, years);
        clearFloor();
        main.y += 3;
        continue;
      }
      const size = 9.5 * s.fontScale;
      advance(main, size * s.lineSpacing * 2);
      on(main);
      write(edu.degree, main.x, main.y, size, { bold: true });
      if (years) {
        write(years, main.x + main.width, main.y, 8.5 * s.fontScale, {
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
  };

  const sections: Record<SectionId, () => void> = {
    summary,
    skills: skillSection,
    experience,
    education,
  };
  for (const id of spec.order ?? DEFAULT_ORDER) sections[id]();

  /**
   * The timeline: a line down the left of every page the sections reach, and
   * a dot at each heading. Drawn last because the line's length isn't known
   * until the content has flowed; it sits in its own margin, so nothing it
   * crosses. The dots go on after the line so they sit on top of it.
   */
  if (spec.layout === "timeline" && dots.length) {
    reach.set(main.page, Math.max(reach.get(main.page) ?? 0, main.y));
    const x = spec.margin + 5;
    for (let page = dots[0].page; page <= lastPage; page += 1) {
      const top = page === dots[0].page ? dots[0].y : spec.margin - 12;
      const end = (reach.get(page) ?? bottom) - 8;
      if (end <= top) continue;
      pdf.setPage(page);
      pdf.setDrawColor(...s.accent);
      pdf.setLineWidth(1);
      pdf.line(x, top, x, end);
    }
    for (const d of dots) {
      pdf.setPage(d.page);
      pdf.setFillColor(...WHITE);
      pdf.circle(x, d.y, 5, "F");
      pdf.setFillColor(...s.accent);
      pdf.circle(x, d.y, 3.4, "F");
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
