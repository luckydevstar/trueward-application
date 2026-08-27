import type { jsPDF as JsPdf } from "jspdf";

import {
  formatMonthYear,
  renderedExperiences,
  type ResumeDocument,
} from "@/lib/document/schema";
import { headerSegments, resolveHeaderFields } from "@/lib/resume-header";
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
  rose: [190, 24, 93],
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
  /** Base-14 family. Both stay selectable and embed nothing. */
  font: "helvetica" | "times";
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
    font: templateSpec(template).font ?? "helvetica",
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

  /** Roughly the top third of the page, before the curve dips below it. */
  const waveHeight = () => pageHeight * 0.3;
  const waveDip = () => pageHeight * 0.055;

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
   * Clips to the wave panel — a full-width block whose lower edge is a single
   * symmetric bezier bulging into the page — then paints the gradient through
   * it.
   *
   * Clipping rather than masking with a white shape: a mask would only be
   * invisible against a white page, and would show as a pale slab the moment
   * anything sat behind it.
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
    pdf.curveTo(
      pageWidth * 0.66,
      base + dip * 1.34,
      pageWidth * 0.34,
      base + dip * 1.34,
      0,
      base,
    );
    pdf.clip();
    // `null` discards the path itself: it exists to define the clip, and
    // stroking or filling it here would draw an outline over the gradient.
    pdf.discardPath();

    /**
     * A pale wash, not a saturated block.
     *
     * The panel is a backdrop that ordinary content sits on — summary, skills
     * and the first experiences all flow across it — so it has to stay light
     * enough for ink text to read against. A strong fill would force the text
     * over it to be reversed, and any paragraph straddling the curve would then
     * change colour mid-sentence.
     *
     * The hue still shifts across the gradient, toward a warmer end of the same
     * colour, so it reads as one surface lit unevenly rather than a flat tint.
     *
     * 0.65 is as saturated as the top can go and stay comfortably readable.
     * Measured contrast of INK against it, by accent: slate 6.9, rose 8.0,
     * blue 8.3, plum 8.1, rust 8.2, emerald 8.7. WCAG AA wants 4.5 for body
     * text and AAA wants 7, so every accent clears AA with room and all but
     * slate clear AAA. Pushing it darker starts trading legibility for colour.
     */
    gradientBand(
      0,
      0,
      pageWidth,
      base + dip + 1,
      tint(s.accent, 0.65),
      tint(mix(s.accent, [236, 72, 153], 0.3), 0.93),
    );
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

    const spaced = { charSpace: spec.headingSpace };

    // A rule *above* the heading opens the section before naming it, which
    // reads as more formal — the effect most academic and legal templates use.
    if (spec.heading === "ruleAbove") {
      pdf.setDrawColor(...tint(color, 0.45));
      pdf.setLineWidth(0.8);
      pdf.line(flow.x, flow.y - size * 0.9, flow.x + flow.width, flow.y - size * 0.9);
      flow.y += 4;
      write(title.toUpperCase(), flow.x, flow.y, size, {
        bold: true,
        color,
        ...spaced,
      });
      flow.y += size * 0.9 + 6;
      return;
    }

    /**
     * The heading hangs in the left column and the body is indented past it.
     * Nothing is drawn — the column itself is the structure.
     *
     * It still advances. Setting the section's first line on the heading's own
     * baseline collided with that entry's date, which occupies the same
     * column: "EXPERIENCE" and "March 2022 – Present" were drawn on top of one
     * another. The hanging position is what makes the layout read, not a
     * shared baseline.
     */
    if (spec.heading === "gutter") {
      write(title.toUpperCase(), flow.x, flow.y, size, {
        bold: true,
        color,
        ...spaced,
      });
      flow.y += size * 0.9 + 7;
      return;
    }

    write(title.toUpperCase(), flow.x, flow.y, size, {
      bold: true,
      color,
      ...spaced,
    });

    if (spec.heading === "plain") {
      // Whitespace alone. The letterspacing above is what marks it as a
      // heading, so a rule here would be saying the same thing twice.
      flow.y += size * 0.75 + 6;
      return;
    }

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

  const bullet = (flow: Flow, text: string, color = INK, offset = 0) => {
    const size = 9 * s.fontScale;
    const indent = offset + 13;
    const lines = wrap(text, size, flow.width - indent - 4);
    const height = lines.length * size * s.lineSpacing + 3;
    advance(flow, height);
    on(flow);

    pdf.setFillColor(...color);
    // -2.3 lifts the dot from the baseline to the middle of the x-height. The
    // offset keeps it with its text rather than out in the date column.
    pdf.circle(flow.x + offset + 3, flow.y - 2.3, 1.25, "F");
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

  /**
   * A left column holding dates, and the section heading that opens each block.
   *
   * Zero for every template but Ledger, where body text is indented past it and
   * dates are set in it rather than right-aligned. Nothing is filled and there
   * is no second flow — it is one column with a hanging indent, which is why it
   * paginates like any other single-column layout.
   */
  const gutter = spec.dateGutter ?? 0;
  const bodyX = main.x + gutter;
  const bodyWidth = main.width - gutter;

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
  } else if (spec.header === "wave") {
    /**
     * The header sits *on* the panel rather than being framed by it, and
     * everything after it keeps flowing over the same backdrop until the
     * content runs past the curve on its own.
     *
     * So this branch is the plain header with a louder name — no special
     * vertical centring, and no jump past the curve. Deciding where the panel
     * ends is the panel's business, not the content's.
     */
    const centered = s.headerPosition === "center";
    const anchor = centered ? pageWidth / 2 : spec.margin;
    const align = centered ? "center" : "left";

    write(profile.fullName, anchor, main.y + nameSize * 0.3, nameSize, {
      bold: true,
      color: shade(s.accent, 0.25),
      align,
    });
    main.y += nameSize * 1.05;
    write(content.targetTitle, anchor, main.y, titleSize, {
      color: shade(s.accent, 0.1),
      align,
    });
    main.y += titleSize * 1.3;
    main.y += contactLine(anchor, main.y, mainWidth, align, MUTED);
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

    write(
      spec.uppercaseName ? profile.fullName.toUpperCase() : profile.fullName,
      anchor,
      main.y + nameSize * 0.3,
      nameSize,
      {
        bold: true,
        color: nameColor,
        align,
        // Caps at display size need air between the letters or they read as a
        // solid block rather than a name.
        ...(spec.uppercaseName ? { charSpace: nameSize * 0.06 } : {}),
      },
    );
    main.y += nameSize * 1.05;
    write(content.targetTitle, anchor, main.y, titleSize, {
      color: spec.heading === "bar" ? MUTED : s.accent,
      align,
      charSpace: spec.headingSpace ? spec.headingSpace * 0.4 : undefined,
    });
    main.y += titleSize * 1.25;
    main.y += contactLine(anchor, main.y, mainWidth, align, MUTED);

    // A rule closing the header, so the block reads as a masthead rather than
    // as the first three lines of the document.
    if (spec.headerRule) {
      main.y += 8;
      pdf.setDrawColor(...(spec.headerRule >= 2 ? s.accent : tint(INK, 0.5)));
      pdf.setLineWidth(spec.headerRule);
      pdf.line(spec.margin, main.y, pageWidth - spec.margin, main.y);
      main.y += 2;
    }
  }

  // -------------------------------------------------------- main column

  if (content.summary) {
    heading(main, spec.header === "sidebar" ? "Profile" : "Summary");
    block(
      main,
      wrap(content.summary, 9.5 * s.fontScale, bodyWidth),
      9.5 * s.fontScale,
      INK,
      gutter,
    );
  }

  /** Skills as "Category: a, b, c", with the label set bold inline. */
  const skillGroups = (flow: Flow, color: RGB, labelColor: RGB, indent = 0) => {
    const x = flow.x + indent;
    const width = flow.width - indent;

    for (const group of content.skills) {
      const size = 9 * s.fontScale;
      const lineHeight = size * s.lineSpacing;
      const label = `${group.name}: `;

      pdf.setFont(s.font, "bold");
      pdf.setFontSize(size);
      const labelWidth = pdf.getTextWidth(label);

      // The first line is shortened by the label; the rest run full width. The
      // 0.35 floor stops a long category name squeezing it to a few characters.
      const firstWidth = Math.max(width - labelWidth, width * 0.35);
      const all = wrap(group.items.join(", "), size, firstWidth);
      const first = all.shift() ?? "";
      const rest = all.length ? wrap(all.join(" "), size, width) : [];

      advance(flow, (1 + rest.length) * lineHeight);
      on(flow);
      write(label, x, flow.y, size, { bold: true, color: labelColor });
      write(first, x + labelWidth, flow.y, size, { color });
      flow.y += lineHeight;

      if (rest.length) {
        write(rest, x, flow.y, size, { color });
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
    skillGroups(main, INK, INK, gutter);
  }

  if (experiences.length) {
    heading(main, "Experience");
    experiences.forEach(({ employment, title, bullets }, index) => {
      const headSize = 10 * s.fontScale;
      const metaSize = 8.5 * s.fontScale;

      // A hairline between roles, never above the first — that would read as a
      // second rule under the section heading.
      if (spec.entryDivider && index > 0) {
        advance(main, 12);
        on(main);
        main.y += 4;
        pdf.setDrawColor(...tint(MUTED, 0.6));
        pdf.setLineWidth(0.5);
        pdf.line(bodyX, main.y, main.x + main.width, main.y);
        main.y += 10;
      }

      advance(main, (headSize + metaSize) * s.lineSpacing);
      on(main);

      const period = `${formatMonthYear(employment.startDate)} – ${formatMonthYear(
        employment.endDate ?? null,
        "Present",
      )}`;

      if (gutter) {
        // Set in the gutter, on the title's baseline. Wrapped to the column so
        // a long "September 2019 – December 2024" doesn't run under the title.
        const dateLines = wrap(period, metaSize, gutter - 10);
        write(dateLines, main.x, main.y, metaSize, { color: MUTED });
      } else {
        // Right-aligned on the title's baseline, so a role and its period read
        // as one row rather than two stacked lines.
        write(period, main.x + main.width, main.y, metaSize, {
          color: MUTED,
          align: "right",
        });
      }

      write(title, bodyX, main.y, headSize, { bold: true });
      main.y += headSize * s.lineSpacing;

      write(
        [employment.company, employment.location].filter(Boolean).join(" · "),
        bodyX,
        main.y,
        metaSize,
        { color: s.accent },
      );
      main.y += metaSize * s.lineSpacing + 2;

      for (const b of bullets) bullet(main, b.text, INK, gutter);
      main.y += 5;
    });
  }

  if (profile.education.length && spec.header !== "sidebar") {
    heading(main, "Education");
    for (const edu of profile.education) {
      const size = 9.5 * s.fontScale;
      advance(main, size * s.lineSpacing * 2);
      on(main);
      write(edu.degree, bodyX, main.y, size, { bold: true });
      if (edu.year) {
        const year = formatMonthYear(edu.year);
        if (gutter) {
          write(year, main.x, main.y, 8.5 * s.fontScale, { color: MUTED });
        } else {
          write(year, main.x + main.width, main.y, 8.5 * s.fontScale, {
            color: MUTED,
            align: "right",
          });
        }
      }
      main.y += size * s.lineSpacing;
      write(
        [edu.school, edu.location].filter(Boolean).join(" · "),
        bodyX,
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
