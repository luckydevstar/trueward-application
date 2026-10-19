/**
 * Job and application numbers as people say them: J007, A007, A007-2.
 *
 * One counter numbers both (record_no_seq, schema part 1), so a job's number
 * is its applications' too — the first applied takes it, each further profile
 * adds a part. Three digits to start; it simply grows past J999.
 */

const pad = (no: number) => String(no).padStart(3, "0");

export const jobNo = (no: number) => `J${pad(no)}`;

export const applicationNo = (no: number, part = 1) => `A${pad(no)}${part > 1 ? `-${part}` : ""}`;

/**
 * Reads a number someone typed — "A007", "a7", "7", "A007-2", "J12" — into
 * its parts, or null when it isn't one. The letter is optional; a bare number
 * means either.
 */
export function parseRecordNo(text: string): { kind: "A" | "J" | null; no: number; part: number | null } | null {
  const match = /^\s*([aj])?\s*0*(\d{1,12})(?:\s*-\s*(\d{1,4}))?\s*$/i.exec(text);
  if (!match) return null;
  const no = Number(match[2]);
  if (!Number.isSafeInteger(no) || no < 1) return null;
  return {
    kind: match[1] ? (match[1].toUpperCase() as "A" | "J") : null,
    no,
    part: match[3] ? Number(match[3]) : null,
  };
}
