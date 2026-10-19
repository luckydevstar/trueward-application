/**
 * Rows pasted from a spreadsheet, as jobs.
 *
 * Copying cells out of Google Sheets or Excel gives tab-separated text, with
 * any cell that holds a line break — every job description — in quotes.
 * Columns are found by a header row when there is one (Title, Company, URL,
 * JD, in any order; a No column is ignored, the database numbers jobs), and
 * are otherwise taken as Title, Company, URL, JD.
 */

import type { JobFieldsInput } from "@/lib/jobs/fields";

type Column = "title" | "company" | "url" | "description";

const HEADERS: Record<Column, RegExp> = {
  title: /^(title|job ?title|role|position)$/i,
  company: /^(company|employer|organi[sz]ation)$/i,
  url: /^(url|link|job ?url|job ?link|posting)$/i,
  description: /^(jd|job ?description|description)$/i,
};

/** Delimited text with RFC 4180 quoting — doubled quotes, line breaks inside quotes. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The pasted rows as jobs, skipping blank lines. Validation is the caller's (cleanJob). */
export function pastedJobs(text: string): JobFieldsInput[] {
  const delimiter = text.includes("\t") ? "\t" : ",";
  const rows = parseDelimited(text.trim(), delimiter).filter((r) => r.some((cell) => cell.trim()));
  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim());
  const found = (Object.keys(HEADERS) as Column[]).map((key) => [key, header.findIndex((h) => HEADERS[key].test(h))] as const);
  const hasHeader = found.filter(([, i]) => i >= 0).length >= 2;
  const column: Record<Column, number> = hasHeader
    ? (Object.fromEntries(found) as Record<Column, number>)
    : { title: 0, company: 1, url: 2, description: 3 };

  const cell = (r: string[], key: Column) => (column[key] >= 0 ? (r[column[key]] ?? "").trim() : "");
  return (hasHeader ? rows.slice(1) : rows).map((r) => ({
    title: cell(r, "title"),
    company: cell(r, "company"),
    url: cell(r, "url"),
    description: cell(r, "description"),
  }));
}
