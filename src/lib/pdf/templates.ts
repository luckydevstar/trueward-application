export type RGB = [number, number, number];

/**
 * How a template differs from the others.
 *
 * Before this, "template" only changed the page margin — three options that
 * produced near-identical documents. Everything that actually reads as a
 * different design lives here: whether the header is a plain block or a filled
 * band, how a section heading is drawn, and whether there is a coloured column
 * down the side.
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
   * sidebar — a filled accent column holding contact, skills and education
   */
  header: "plain" | "banner" | "sidebar";
  /**
   * rule — small caps over a hairline
   * bar  — small caps with a short thick accent stroke beneath
   * chip — small caps reversed out of a filled accent tab
   */
  heading: "rule" | "bar" | "chip";
  /** Sidebar templates only: width of the coloured column, in points. */
  sidebarWidth?: number;
  /** Multiplier on the name, for templates that want a louder or quieter one. */
  nameScale?: number;
};

export const TEMPLATES: TemplateSpec[] = [
  {
    id: "classic",
    label: "Classic",
    hint: "Plain header, hairline rules. The safest thing to send.",
    margin: 52,
    sectionGap: 15,
    header: "plain",
    heading: "rule",
  },
  {
    id: "modern",
    label: "Modern",
    hint: "Accent name and heavier section bars, still a single column.",
    margin: 56,
    sectionGap: 16,
    header: "plain",
    heading: "bar",
    nameScale: 1.1,
  },
  {
    id: "compact",
    label: "Compact",
    hint: "Tighter margins and spacing, for a history that runs long.",
    margin: 40,
    sectionGap: 10,
    header: "plain",
    heading: "rule",
    nameScale: 0.92,
  },
  {
    id: "banner",
    label: "Banner",
    hint: "Full-width colour block behind the name. Bold but restrained.",
    margin: 52,
    sectionGap: 16,
    header: "banner",
    heading: "chip",
    nameScale: 1.15,
  },
  {
    id: "sidebar",
    label: "Sidebar",
    hint: "Coloured column carrying contact, skills and education.",
    margin: 44,
    sectionGap: 14,
    header: "sidebar",
    heading: "bar",
    sidebarWidth: 178,
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
