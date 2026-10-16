export type RGB = [number, number, number];

/**
 * How a template differs from the others.
 *
 * Everything that reads as a different design lives here: what the header is,
 * how a section heading is drawn, how skills are laid out, and which typeface
 * a resume starts in. The renderer (resume-pdf.ts) knows how to draw each
 * option; a template is a choice of options.
 */
export type TemplateSpec = {
  id: string;
  label: string;
  /** One-line description, shown under the template picker. */
  hint: string;
  margin: number;
  sectionGap: number;
  /**
   * plain   — name and contact as text, nothing behind them
   * banner  — a filled accent block across the top, text reversed out of it
   * wave    — a deep accent panel behind the header, its lower edge curved
   */
  header: "plain" | "banner" | "wave";
  /**
   * chip    — small caps reversed out of a filled accent tab
   * bar     — small caps with a short thick accent stroke beneath
   * inline  — small caps followed by a hairline running to the margin
   * band    — small caps on a pale full-width strip of the accent
   */
  heading: "chip" | "bar" | "inline" | "band";
  /**
   * inline — "• Category: a, b, c", wrapping under the label
   * grid   — the category in a column of its own, its skills beside it
   */
  skills: "inline" | "grid";
  /** Multiplier on the name, for templates that want a louder or quieter one. */
  nameScale?: number;
  /** The typeface a resume starts in until one is chosen — see fonts.ts. */
  font: string;
  /** Letterspacing on section headings, in points. Small caps want a little. */
  headingSpace?: number;
  /** An accent rule beneath the whole header block, this many points thick. */
  headerRule?: number;
  /** A thick accent bar down the left of a left-aligned header. */
  headerBar?: boolean;
  /** Bullets drawn in the accent rather than in ink. */
  accentBullets?: boolean;
  /** Between contact details. */
  contactSeparator: string;
};

export const TEMPLATES: TemplateSpec[] = [
  {
    id: "banner",
    label: "Banner",
    hint: "Full-width colour block behind the name. Bold but restrained.",
    margin: 52,
    sectionGap: 16,
    header: "banner",
    heading: "chip",
    skills: "inline",
    nameScale: 1.15,
    font: "helvetica",
    contactSeparator: "  ·  ",
  },
  {
    id: "engineer",
    label: "Engineer",
    hint: "One clean column, built to parse: rules beside headings, skills in a grid.",
    margin: 46,
    sectionGap: 14,
    header: "plain",
    heading: "inline",
    skills: "grid",
    nameScale: 1.15,
    font: "inter",
    headingSpace: 1.1,
    headerRule: 1.4,
    accentBullets: true,
    contactSeparator: "  |  ",
  },
  {
    id: "signal",
    label: "Signal",
    hint: "Accent bar beside the name, tinted section strips, skills in a grid.",
    margin: 48,
    sectionGap: 15,
    header: "plain",
    heading: "band",
    skills: "grid",
    nameScale: 1.12,
    font: "ibm-plex-sans",
    headingSpace: 1,
    headerBar: true,
    accentBullets: true,
    contactSeparator: "  ·  ",
  },
  {
    id: "wave",
    label: "Wave",
    hint: "Deep gradient panel behind the header, curving into the page.",
    margin: 52,
    sectionGap: 16,
    header: "wave",
    heading: "bar",
    skills: "inline",
    nameScale: 1.2,
    font: "lato",
    contactSeparator: "  ·  ",
  },
];

export const DEFAULT_TEMPLATE = TEMPLATES[0];

export function templateSpec(id: string): TemplateSpec {
  return TEMPLATES.find((t) => t.id === id) ?? DEFAULT_TEMPLATE;
}

/**
 * Mixes a colour toward white. 0 returns it unchanged, 1 returns white.
 *
 * Used for the tints a filled panel needs — secondary text on an accent band
 * has to sit between the fill and pure white or it either disappears or shouts
 * as loudly as the name.
 */
export function tint(color: RGB, amount: number): RGB {
  return color.map((channel) =>
    Math.round(channel + (255 - channel) * amount),
  ) as RGB;
}

/** Mixes a colour toward black, for a darker band than the accent itself. */
export function shade(color: RGB, amount: number): RGB {
  return color.map((channel) => Math.round(channel * (1 - amount))) as RGB;
}

/** Linear interpolation between two colours. `t` runs 0 → 1. */
export function mix(from: RGB, to: RGB, t: number): RGB {
  return from.map((channel, i) =>
    Math.round(channel + (to[i] - channel) * t),
  ) as RGB;
}

/**
 * Whether white text is legible on this fill.
 *
 * Relative luminance per WCAG, so a pale accent gets dark text instead of
 * white-on-yellow. The 0.55 cut is a shade stricter than the 0.5 midpoint
 * because the reversed text here is small.
 */
export function prefersLightText(color: RGB): boolean {
  const [r, g, b] = color.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.55;
}
