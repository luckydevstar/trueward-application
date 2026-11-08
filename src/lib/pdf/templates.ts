export type RGB = [number, number, number];

/**
 * A colour a template names by role, resolved against the resume's accent:
 * the accent itself, body ink, the muted grey of secondary text, or the
 * template's own fixed highlight (a gold, say) where it has one.
 */
export type Tone = "accent" | "ink" | "muted" | "highlight";

/**
 * The sections a resume can print, in an order a template may change.
 * Projects go straight after Experience unless a template places them.
 */
export type SectionId = "summary" | "skills" | "experience" | "projects" | "education";

/**
 * How a template differs from the others.
 *
 * Everything that reads as a different design lives here: what the header is,
 * how a section heading is drawn, how skills are laid out, and which typeface
 * a resume starts in. The renderer (resume-pdf.ts) knows how to draw each
 * option; a template is a choice of options.
 *
 * Every option past the first block is optional, and leaving it out keeps the
 * behaviour the original four templates were drawn with — they set none of
 * them, and render exactly as they did.
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
   * card    — a rounded accent panel inside the margins, text reversed out
   * split   — name and title on the left, contact stacked on the right
   */
  header: "plain" | "banner" | "wave" | "card" | "split";
  /**
   * chip      — small caps reversed out of a filled accent tab
   * bar       — small caps with a short thick accent stroke beneath
   * inline    — small caps followed by a hairline running to the margin
   * band      — small caps on a pale full-width strip of the accent
   * rule      — the heading, then a hairline the full width beneath it
   * center    — centred, with a hairline out to each margin
   * fill      — reversed out of a solid full-width band of the accent
   * tab       — on a pale accent tab, a hairline from it to the margin
   * dash      — a short accent dash, then the heading
   * underline — the heading, then a short thin stroke beneath
   * text      — the heading alone
   */
  heading: "chip" | "bar" | "inline" | "band" | "rule" | "center" | "fill" | "tab" | "dash" | "underline" | "text";
  /**
   * Always by category — a resume's skills are never one undivided list.
   *
   * inline  — "• Category: a, b, c", wrapping under the label
   * grid    — the category in a column of its own, its skills beside it
   * tags    — the category in a column, its skills as small boxed (or
   *           underlined) tags beside it
   * flow    — "Category: a • b • c", a category to a line
   * columns — the category on its own line, its skills in columns beneath
   */
  skills: "inline" | "grid" | "tags" | "flow" | "columns";
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

  // ------------------------------------------------ added with the second set

  /**
   * The header alignment the design is drawn for. Choosing the template in
   * the builder sets the header toggle to it; the toggle still wins after.
   */
  align?: "left" | "center";
  /** The name: in capitals, letterspaced, at regular weight, in the accent. */
  name?: { upper?: boolean; space?: number; weight?: "normal"; tone?: Tone };
  /**
   * The target title under the name. Unset, a plain header sets it bold in
   * the accent and a filled one in a pale tint of it. `slashes` draws two
   * short strokes before it, as a code comment would — drawn, not typed, so
   * the text an applicant-tracking system reads is just the title.
   */
  title?: { upper?: boolean; space?: number; weight?: "bold" | "normal"; tone?: Tone; slashes?: boolean };
  /**
   * Section heading text for the headings added with the second set (rule
   * onwards): title case rather than capitals, regular weight, its colour, a
   * size multiplier, and a drawn chevron before it.
   */
  headingText?: { titleCase?: boolean; weight?: "normal"; tone?: Tone; scale?: number; chevron?: boolean };
  /** The colour of the hairlines `rule`, `center` and `tab` headings draw. "pale" is a light tint of the accent. */
  ruleTone?: Tone | "pale";
  /** The header rule in ink rather than the accent. */
  headerRuleTone?: Tone;
  /** A second, thinner header rule just under the first. */
  headerRuleDouble?: boolean;
  /** The header rule under the title, between it and the contact line, instead of beneath everything. */
  headerRuleUnderTitle?: boolean;
  /** An accent bar across the top of the first page, this many points tall. */
  topBar?: number;
  /** A small centred line–diamond–line ornament under the title, in the highlight. */
  ornament?: boolean;
  /** Small drawn icons beside contact details, and beside entry dates and places. */
  icons?: boolean;
  /** How far a `card` or `banner` fill is darkened from the accent, 0–1. */
  fillShade?: number;
  /**
   * labels   — each section's heading in a left column, its content beside it
   * timeline — a vertical accent line down the left, a dot at each heading
   */
  layout?: "labels" | "timeline";
  /**
   * How a job (and an education entry) is set out:
   * role     — the role in bold, dates on its right; company · place below
   * company  — company and place on the first row, role and dates the second
   * stacked  — role, then company, then dates and place, each on its own line
   * dates    — dates and place in a narrow left column, the rest beside them
   */
  entry?: "role" | "company" | "stacked" | "dates";
  /** The company's colour in role and stacked entries. Unset, the accent. */
  companyTone?: Tone;
  /** Inline skills without the leading accent dot before each category. */
  skillDots?: false;
  /** How `tags` skills are drawn: in a box, or underlined. */
  tags?: "box" | "underline";
  /** Section order, when it isn't summary, skills, experience, education. */
  order?: SectionId[];
  /** A fixed second colour for titles and ornaments the `highlight` tone names. */
  highlight?: RGB;
};

/** A muted gold, legible on white and on a deep navy banner alike. */
const GOLD: RGB = [176, 133, 52];

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
  {
    id: "classic",
    label: "Classic",
    hint: "Centred capitals over a double rule; headings centred between hairlines.",
    margin: 50,
    sectionGap: 15,
    header: "plain",
    heading: "center",
    skills: "flow",
    nameScale: 0.82,
    font: "open-sans",
    contactSeparator: "  •  ",
    align: "center",
    name: { upper: true },
    title: { weight: "normal", tone: "ink" },
    headingText: { titleCase: true, weight: "normal", tone: "ink", scale: 1.15 },
    ruleTone: "ink",
    headerRule: 1.6,
    headerRuleTone: "ink",
    headerRuleDouble: true,
    headerRuleUnderTitle: true,
    entry: "company",
    order: ["summary", "experience", "skills", "education"],
  },
  {
    id: "minimal",
    label: "Minimal",
    hint: "Quiet and centred: title-case headings over hairlines, company first.",
    margin: 54,
    sectionGap: 15,
    header: "plain",
    heading: "rule",
    skills: "flow",
    nameScale: 0.78,
    font: "open-sans",
    contactSeparator: "  •  ",
    align: "center",
    name: { upper: true },
    title: { weight: "normal", tone: "muted" },
    headingText: { titleCase: true, weight: "normal", tone: "ink", scale: 1.1 },
    ruleTone: "ink",
    entry: "company",
  },
  {
    id: "scholar",
    label: "Scholar",
    hint: "Centred, with icons beside the contact details; skills after experience.",
    margin: 50,
    sectionGap: 15,
    header: "plain",
    heading: "rule",
    skills: "flow",
    nameScale: 0.82,
    font: "lato",
    contactSeparator: "  ",
    align: "center",
    name: { upper: true },
    title: { weight: "normal", tone: "ink" },
    headingText: { titleCase: true, weight: "normal", tone: "ink", scale: 1.15 },
    ruleTone: "muted",
    icons: true,
    entry: "company",
    order: ["summary", "experience", "skills", "education"],
  },
  {
    id: "counsel",
    label: "Counsel",
    hint: "Letterspaced capitals for name and title; formal, title-case headings.",
    margin: 54,
    sectionGap: 15,
    header: "plain",
    heading: "rule",
    skills: "inline",
    nameScale: 0.74,
    font: "source-sans-3",
    contactSeparator: "    ",
    align: "center",
    name: { upper: true, space: 1.6 },
    title: { upper: true, space: 2.4, weight: "normal", tone: "muted" },
    headingText: { titleCase: true, weight: "normal", tone: "ink", scale: 1.1 },
    ruleTone: "ink",
    skillDots: false,
    entry: "company",
  },
  {
    id: "elegant",
    label: "Elegant",
    hint: "A serif throughout: a light, large name and small letterspaced headings.",
    margin: 56,
    sectionGap: 16,
    header: "plain",
    heading: "rule",
    skills: "inline",
    nameScale: 1.3,
    font: "eb-garamond",
    headingSpace: 1.8,
    contactSeparator: "      ",
    align: "center",
    name: { weight: "normal" },
    title: { upper: true, space: 2.2, weight: "normal", tone: "muted" },
    headingText: { weight: "normal", tone: "muted", scale: 0.85 },
    ruleTone: "pale",
    skillDots: false,
    entry: "company",
  },
  {
    id: "executive",
    label: "Executive",
    hint: "Serif name, gold letterspaced title and ornament, gold-underlined headings.",
    margin: 54,
    sectionGap: 16,
    header: "plain",
    heading: "underline",
    skills: "flow",
    nameScale: 0.95,
    font: "source-serif-4",
    contactSeparator: "    ·    ",
    align: "center",
    name: { upper: true, space: 0.6 },
    title: { upper: true, space: 2.6, weight: "normal", tone: "highlight" },
    ornament: true,
    headingText: { titleCase: true, weight: "normal", tone: "ink", scale: 1.15 },
    highlight: GOLD,
    entry: "company",
  },
  {
    id: "banded",
    label: "Banded",
    hint: "Serif capitals up top; each section opens on a solid band of the accent.",
    margin: 50,
    sectionGap: 15,
    header: "plain",
    heading: "fill",
    skills: "flow",
    nameScale: 0.9,
    font: "merriweather",
    contactSeparator: "   •   ",
    align: "center",
    name: { upper: true },
    title: { upper: true, space: 2.4, weight: "normal", tone: "muted" },
    headingText: { titleCase: true, scale: 1.05 },
    entry: "company",
  },
  {
    id: "clarity",
    label: "Clarity",
    hint: "Left-aligned with icons; company in the accent, dates and place below.",
    margin: 46,
    sectionGap: 14,
    header: "plain",
    heading: "rule",
    skills: "inline",
    nameScale: 1.05,
    font: "roboto",
    contactSeparator: "  ",
    align: "left",
    name: { upper: true },
    title: { weight: "normal", tone: "accent" },
    headingText: { tone: "ink" },
    ruleTone: "ink",
    icons: true,
    entry: "stacked",
  },
  {
    id: "centered",
    label: "Centered",
    hint: "Centred header, skills in tidy columns, entries stacked with icons.",
    margin: 50,
    sectionGap: 14,
    header: "plain",
    heading: "rule",
    skills: "columns",
    nameScale: 1.15,
    font: "inter",
    contactSeparator: "  •  ",
    align: "center",
    title: { weight: "normal", tone: "muted" },
    headingText: { tone: "ink" },
    ruleTone: "ink",
    icons: true,
    entry: "stacked",
    companyTone: "ink",
  },
  {
    id: "topline",
    label: "Topline",
    hint: "An accent bar along the top edge; centred capitals and stacked entries.",
    margin: 50,
    sectionGap: 14,
    header: "plain",
    heading: "rule",
    skills: "inline",
    nameScale: 1.1,
    font: "source-sans-3",
    contactSeparator: "  ",
    align: "center",
    topBar: 7,
    name: { upper: true },
    title: { weight: "normal", tone: "ink" },
    headingText: { tone: "ink" },
    ruleTone: "ink",
    icons: true,
    entry: "stacked",
    companyTone: "ink",
  },
  {
    id: "modern",
    label: "Modern",
    hint: "Name and headings in the accent, skills as tags, an accent rule under the header.",
    margin: 46,
    sectionGap: 14,
    header: "plain",
    heading: "rule",
    skills: "tags",
    nameScale: 1.1,
    font: "open-sans",
    contactSeparator: "  ",
    align: "left",
    name: { tone: "accent" },
    title: { weight: "normal", tone: "accent" },
    ruleTone: "pale",
    headerRule: 1.6,
    icons: true,
    tags: "underline",
    entry: "stacked",
    companyTone: "ink",
  },
  {
    id: "accent",
    label: "Accent",
    hint: "Name and letterspaced title in the accent; small headings after a dash.",
    margin: 48,
    sectionGap: 15,
    header: "plain",
    heading: "dash",
    skills: "inline",
    nameScale: 1,
    font: "lato",
    headingSpace: 1.4,
    contactSeparator: "  ",
    align: "left",
    name: { upper: true, weight: "normal", tone: "accent" },
    title: { upper: true, space: 1.2, weight: "normal", tone: "accent" },
    headingText: { tone: "muted", scale: 0.85 },
    headerRule: 1,
    icons: true,
    skillDots: false,
  },
  {
    id: "clinical",
    label: "Clinical",
    hint: "Centred name in the accent; accent headings over accent rules.",
    margin: 50,
    sectionGap: 15,
    header: "plain",
    heading: "rule",
    skills: "flow",
    nameScale: 1.05,
    font: "source-sans-3",
    contactSeparator: "    ",
    align: "center",
    name: { tone: "accent" },
    title: { weight: "normal", tone: "muted" },
    ruleTone: "accent",
  },
  {
    id: "split",
    label: "Split",
    hint: "Name on the left, contact stacked on the right, a heavy rule between.",
    margin: 48,
    sectionGap: 14,
    header: "split",
    heading: "rule",
    skills: "flow",
    nameScale: 1.15,
    font: "inter",
    contactSeparator: "  ",
    align: "left",
    title: { weight: "normal", tone: "muted" },
    headingText: { tone: "ink" },
    ruleTone: "ink",
    headerRule: 2.2,
    headerRuleTone: "ink",
  },
  {
    id: "consultant",
    label: "Consultant",
    hint: "Headings on pale tabs; dates and place in a column of their own.",
    margin: 48,
    sectionGap: 14,
    header: "plain",
    heading: "tab",
    skills: "tags",
    nameScale: 1.05,
    font: "roboto",
    contactSeparator: "  ",
    align: "center",
    name: { upper: true },
    title: { weight: "normal", tone: "muted" },
    ruleTone: "pale",
    icons: true,
    tags: "box",
    entry: "dates",
    order: ["summary", "experience", "skills", "education"],
  },
  {
    id: "margin",
    label: "Margin",
    hint: "Section names in a left margin, the content beside them.",
    margin: 46,
    sectionGap: 14,
    header: "plain",
    heading: "text",
    skills: "inline",
    nameScale: 1,
    font: "source-sans-3",
    headingSpace: 1,
    contactSeparator: "  ",
    align: "left",
    name: { upper: true, weight: "normal", tone: "accent" },
    title: { weight: "normal", tone: "accent" },
    headingText: { scale: 0.75 },
    headerRule: 1.2,
    icons: true,
    layout: "labels",
    skillDots: false,
  },
  {
    id: "timeline",
    label: "Timeline",
    hint: "A line down the left with a dot at every section; centred header.",
    margin: 50,
    sectionGap: 16,
    header: "plain",
    heading: "text",
    skills: "inline",
    nameScale: 1.05,
    font: "inter",
    headingSpace: 1.2,
    contactSeparator: "  ",
    align: "center",
    name: { upper: true },
    title: { upper: true, space: 2.4, weight: "normal", tone: "muted" },
    headingText: { weight: "normal", tone: "ink", scale: 1.15 },
    icons: true,
    layout: "timeline",
    companyTone: "ink",
    skillDots: false,
  },
  {
    id: "terminal",
    label: "Terminal",
    hint: "A dark rounded header card; code-style headings and skill tags.",
    margin: 46,
    sectionGap: 14,
    header: "card",
    heading: "rule",
    skills: "tags",
    nameScale: 1.05,
    font: "ibm-plex-sans",
    headingSpace: 0.6,
    contactSeparator: "  ",
    align: "left",
    name: { upper: true, space: 1 },
    title: { weight: "normal", slashes: true },
    headingText: { chevron: true },
    ruleTone: "pale",
    icons: true,
    fillShade: 0.45,
    tags: "underline",
    entry: "stacked",
    companyTone: "ink",
  },
  {
    id: "prestige",
    label: "Prestige",
    hint: "A deep banner with a gold letterspaced title; serif and formal.",
    margin: 46,
    sectionGap: 14,
    header: "banner",
    heading: "rule",
    skills: "tags",
    nameScale: 1.1,
    font: "source-serif-4",
    contactSeparator: "  ",
    align: "left",
    name: { upper: true, space: 0.8 },
    title: { upper: true, space: 2.4, weight: "normal", tone: "highlight" },
    headingText: { tone: "ink" },
    ruleTone: "ink",
    icons: true,
    fillShade: 0.55,
    tags: "underline",
    entry: "stacked",
    companyTone: "ink",
    highlight: [214, 176, 98],
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
