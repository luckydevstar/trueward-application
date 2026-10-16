import type { jsPDF as JsPdf } from "jspdf";

/**
 * The typefaces a resume can be set in.
 *
 * Helvetica and Times are PDF base-14 fonts: built into every reader, nothing
 * embedded. The rest are open-licence families (public/fonts/README.md) whose
 * regular and bold weights are fetched when chosen and embedded in the PDF.
 * jsPDF embeds only the glyphs used, so a resume grows by tens of kilobytes,
 * and the text stays extractable — checked with pdftotext, accents, dashes and
 * bullets included — which is what applicant-tracking systems read.
 */
export type FontOption = {
  id: string;
  label: string;
  kind: "Sans" | "Serif";
  /** Set for the base-14 fonts, which need no files. */
  builtin?: "helvetica" | "times";
};

export const FONTS: FontOption[] = [
  { id: "helvetica", label: "Helvetica", kind: "Sans", builtin: "helvetica" },
  { id: "inter", label: "Inter", kind: "Sans" },
  { id: "roboto", label: "Roboto", kind: "Sans" },
  { id: "lato", label: "Lato", kind: "Sans" },
  { id: "open-sans", label: "Open Sans", kind: "Sans" },
  { id: "source-sans-3", label: "Source Sans 3", kind: "Sans" },
  { id: "ibm-plex-sans", label: "IBM Plex Sans", kind: "Sans" },
  { id: "times", label: "Times", kind: "Serif", builtin: "times" },
  { id: "source-serif-4", label: "Source Serif 4", kind: "Serif" },
  { id: "merriweather", label: "Merriweather", kind: "Serif" },
  { id: "eb-garamond", label: "EB Garamond", kind: "Serif" },
];

export function fontOption(id: string | undefined): FontOption {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

/** The family name jsPDF draws a font under. */
export function pdfFamily(id: string | undefined): string {
  const font = fontOption(id);
  return font.builtin ?? font.id;
}

/** Reads a font file and returns it base64-encoded. */
export type FontLoader = (file: string) => Promise<string>;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // In chunks: String.fromCharCode with a whole font's bytes as arguments
  // overflows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** In the browser: from public/fonts, by URL. */
const fromPublic: FontLoader = async (file) => {
  const response = await fetch(`/fonts/${file}`);
  if (!response.ok) throw new Error(`Couldn't load the font ${file}.`);
  return toBase64(await response.arrayBuffer());
};

/** One download per file per session, shared by every render. */
const cache = new Map<string, Promise<string>>();

/**
 * Registers a font's regular and bold weights with this document, loading
 * them first if need be. A no-op for the built-in fonts.
 *
 * jsPDF keeps fonts per document, so this runs for every render; only the
 * download is cached.
 */
export async function prepareFont(pdf: JsPdf, id: string, load: FontLoader = fromPublic): Promise<void> {
  const font = fontOption(id);
  if (font.builtin) return;

  for (const [weight, style] of [
    [400, "normal"],
    [700, "bold"],
  ] as const) {
    const file = `${font.id}-${weight}.ttf`;
    let data = cache.get(file);
    if (!data) {
      data = load(file);
      cache.set(file, data);
      // A failed download shouldn't be remembered as the answer.
      data.catch(() => cache.delete(file));
    }
    pdf.addFileToVFS(file, await data);
    pdf.addFont(file, font.id, style);
  }
}
