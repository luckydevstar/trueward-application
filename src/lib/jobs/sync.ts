import "server-only";

import { fetchSheet, parseSheetUrl, sheetRows } from "@/lib/sheets";
import type { Db } from "@/lib/supabase/request";

export type SyncResult =
  | { ok: true; total: number; added: number; removed: number }
  | { ok: false; error: string };

/**
 * Reads the person's sheet and brings their job list in line with it, keyed
 * by each row's No. A new `url` connects (or replaces) the sheet first.
 *
 * Rows gone from the sheet are kept but marked out of it, so resumes and
 * applications made from them still say which job they were for.
 */
export async function syncSheet(db: Db, actorId: string, url?: string): Promise<SyncResult> {
  let sheet: { url: string; spreadsheet_id: string; gid: string } | null = null;

  if (url) {
    const ref = parseSheetUrl(url.trim());
    if (!ref) return { ok: false, error: "That doesn't look like a Google Sheets link." };
    const row = { created_by: actorId, url: url.trim(), spreadsheet_id: ref.spreadsheetId, gid: ref.gid };
    const { error } = await db.from("job_sheet").upsert(row, { onConflict: "created_by" });
    if (error) return { ok: false, error: error.message };
    sheet = row;
  } else {
    const { data } = await db.from("job_sheet").select("url, spreadsheet_id, gid").eq("created_by", actorId).maybeSingle();
    sheet = data;
  }
  if (!sheet) return { ok: false, error: "Connect your Google Sheet first." };

  const fail = async (error: string): Promise<SyncResult> => {
    await db.from("job_sheet").update({ last_error: error }).eq("created_by", actorId);
    return { ok: false, error };
  };

  const fetched = await fetchSheet({ spreadsheetId: sheet.spreadsheet_id, gid: sheet.gid });
  if (!fetched.ok) return fail(fetched.error);
  const { rows, missing } = sheetRows(fetched.csv);
  if (missing.length) {
    return fail(`The sheet's first row needs these column headers: ${missing.join(", ")} (and Company, URL).`);
  }

  const { data: before } = await db.from("sheet_job").select("job_no, in_sheet").eq("created_by", actorId);
  const known = new Set((before ?? []).map((r) => r.job_no));
  const now = new Date().toISOString();

  if (rows.length) {
    const { error } = await db.from("sheet_job").upsert(
      rows.map((r) => ({
        created_by: actorId,
        job_no: r.jobNo,
        title: r.title,
        company: r.company,
        url: r.url,
        description: r.description,
        in_sheet: true,
        synced_at: now,
      })),
      { onConflict: "created_by,job_no" },
    );
    if (error) return fail(error.message);
  }

  const present = new Set(rows.map((r) => r.jobNo));
  const gone = (before ?? []).filter((r) => r.in_sheet && !present.has(r.job_no)).map((r) => r.job_no);
  if (gone.length) {
    await db.from("sheet_job").update({ in_sheet: false }).eq("created_by", actorId).in("job_no", gone);
  }

  await db.from("job_sheet").update({ last_synced_at: now, last_error: null }).eq("created_by", actorId);
  return {
    ok: true,
    total: rows.length,
    added: rows.filter((r) => !known.has(r.jobNo)).length,
    removed: gone.length,
  };
}
