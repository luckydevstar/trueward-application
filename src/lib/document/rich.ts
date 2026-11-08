/**
 * Bold in resume text.
 *
 * Content JSON may wrap words in `<b>…</b>` (or `<strong>…</strong>`) to set
 * them in the bold weight — "Built it with <b>React, Node</b>" prints
 * "React, Node" in bold. That is the only markup the renderer draws: other
 * inline tags a model or an editor might leave behind (`<i>`, `<em>`, `<u>`,
 * `<span>`, `<br>`) are dropped rather than printed, and the handful of
 * entities such text carries (`&amp;`, `&lt;`…) are decoded.
 *
 * Only those tag names are touched, so text that merely contains angle
 * brackets — "List<T>", "<3 years" — stays as written.
 *
 * Pure: shared by the PDF renderer (browser and server) and the builder.
 */

export type RichRun = { text: string; bold: boolean };

const TAG = /<\s*(\/?)\s*(b|strong|i|em|u|span|br)\b[^>]*>/gi;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  nbsp: " ",
};

const decode = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_, name: string) => ENTITIES[name]);

/**
 * The text as runs of one weight each, in order. An unclosed `<b>` runs to
 * the end; a stray `</b>` is ignored.
 */
export function richRuns(text: string): RichRun[] {
  const runs: RichRun[] = [];
  let depth = 0;
  let last = 0;

  const push = (raw: string, bold: boolean) => {
    if (!raw) return;
    const value = decode(raw);
    const previous = runs[runs.length - 1];
    if (previous && previous.bold === bold) previous.text += value;
    else runs.push({ text: value, bold });
  };

  for (const match of text.matchAll(TAG)) {
    push(text.slice(last, match.index), depth > 0);
    last = match.index + match[0].length;
    const name = match[2].toLowerCase();
    const closing = match[1] === "/";
    if (name === "b" || name === "strong") depth = closing ? Math.max(0, depth - 1) : depth + 1;
    else if (name === "br") push(" ", depth > 0);
  }
  push(text.slice(last), depth > 0);
  return runs;
}

/** Whether any of the text is marked bold. */
export const hasBold = (text: string) => richRuns(text).some((run) => run.bold);

/** The text as it reads, markup removed — for titles, file names and anything drawn in one weight. */
export const plainText = (text: string) =>
  richRuns(text)
    .map((run) => run.text)
    .join("");
