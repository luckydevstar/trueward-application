/**
 * Reading a person's Google Sheet of jobs.
 *
 * The sheet is link-shared ("anyone with the link can view"), so its CSV
 * export needs no credentials. Columns are found by their header, in any
 * order and case: No, Title, Company, URL, and JD (or "Job description").
 */

export type SheetRef = { spreadsheetId: string; gid: string };

export type SheetRow = {
  jobNo: string;
  title: string;
  company: string | null;
  url: string | null;
  description: string;
};

/** The spreadsheet and tab a pasted link points at. */
export function parseSheetUrl(url: string): SheetRef | null {
  const id = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/)?.[1];
  if (!id) return null;
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1] ?? "0";
  return { spreadsheetId: id, gid };
}

/** RFC 4180 CSV — quoted fields, doubled quotes, and line breaks inside quotes (JDs have plenty). */
export function parseCsv(text: string): string[][] {
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
    } else if (c === '"') quoted = true;
    else if (c === ",") {
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

const HEADERS: Record<keyof SheetRow, RegExp> = {
  jobNo: /^(no\.?|#|number|job ?no\.?|id)$/i,
  title: /^(title|job ?title|role|position)$/i,
  company: /^(company|employer|organi[sz]ation)$/i,
  url: /^(url|link|job ?url|job ?link|posting)$/i,
  description: /^(jd|job ?description|description)$/i,
};

/**
 * Rows from the CSV, by header. A row needs a No, a title and a description
 * to count; blank lines and half-filled rows are skipped rather than failing
 * the whole sheet.
 */
export function sheetRows(csv: string): { rows: SheetRow[]; missing: string[] } {
  const [header = [], ...body] = parseCsv(csv);
  const column = Object.fromEntries(
    (Object.keys(HEADERS) as Array<keyof SheetRow>).map((key) => [
      key,
      header.findIndex((h) => HEADERS[key].test(h.trim())),
    ]),
  ) as Record<keyof SheetRow, number>;

  const missing = (["jobNo", "title", "description"] as const)
    .filter((key) => column[key] < 0)
    .map((key) => ({ jobNo: "No", title: "Title", description: "JD" })[key]);
  if (missing.length) return { rows: [], missing };

  const cell = (r: string[], key: keyof SheetRow) => (column[key] >= 0 ? (r[column[key]] ?? "").trim() : "");
  const seen = new Set<string>();
  const rows: SheetRow[] = [];
  for (const r of body) {
    const jobNo = cell(r, "jobNo");
    const title = cell(r, "title");
    const description = cell(r, "description");
    if (!jobNo || !title || !description || seen.has(jobNo)) continue;
    seen.add(jobNo);
    const url = cell(r, "url");
    rows.push({
      jobNo,
      title,
      company: cell(r, "company") || null,
      url: /^https?:\/\//i.test(url) ? url : null,
      description,
    });
  }
  return { rows, missing };
}

/** Fetches the sheet's CSV. A private sheet answers with a sign-in page, which is said plainly. */
export async function fetchSheet(ref: SheetRef): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  const url = `https://docs.google.com/spreadsheets/d/${ref.spreadsheetId}/export?format=csv&gid=${ref.gid}`;
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(20_000) });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.includes("text/csv")) {
      return {
        ok: false,
        error: 'Google wouldn\'t share that sheet. Set it to "Anyone with the link can view" and try again.',
      };
    }
    return { ok: true, csv: await response.text() };
  } catch {
    return { ok: false, error: "Couldn't reach Google Sheets. Try again." };
  }
}
