/**
 * A web page's text as numbered lines, and back: the AI cleaning of a job
 * page (src/lib/jobs/clean.ts) shows the model the lines numbered and gets
 * back line ranges, which are turned into the description here — so it is
 * the page's own words, paragraphs kept.
 */

export type Line = { text: string; gapBefore: boolean };

/** The page's non-blank lines, each remembering whether a blank line came before it. */
export function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let gap = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) {
      gap = lines.length > 0;
      continue;
    }
    lines.push({ text: line, gapBefore: gap });
    gap = false;
  }
  return lines;
}

/** The chosen ranges' lines, in page order, paragraphs kept; a step between ranges starts a paragraph. */
export function assemble(lines: Line[], sections: Array<{ from: number; to: number }>): string {
  const keep = new Set<number>();
  for (const { from, to } of sections) {
    const start = Math.max(1, Math.min(from, to));
    const end = Math.min(lines.length, Math.max(from, to));
    for (let n = start; n <= end; n += 1) keep.add(n - 1);
  }
  const out: string[] = [];
  let previous = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (out.length && (lines[i].gapBefore || i !== previous + 1)) out.push("");
    out.push(lines[i].text);
    previous = i;
  }
  return out.join("\n");
}
