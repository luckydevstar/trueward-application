import type { ApplicationStatus, BillingStatus } from "@/lib/status";

/**
 * One application as the grid sees it.
 *
 * Shared between the page loader and the grid because the grid now reads rows
 * *back* from its own writes — `insert().select(ROW_COLUMNS)` — instead of
 * asking the server to re-render the page. The two have to agree on the
 * column list or a freshly added row would be missing fields the page-loaded
 * ones have.
 *
 * Deliberately not a "use client" module: a server page importing from one
 * would receive a client reference in place of the string.
 */
export type ApplicationRow = {
  id: string;
  title: string;
  company: string;
  job_url: string;
  status: ApplicationStatus;
  billing: BillingStatus;
  notes: string | null;
  applied_at: string;
  resume_key: string | null;
  resume_url: string | null;
  resume_name: string | null;
  profile_id: string | null;
  created_by: string | null;
  /** Null while the row is on the working list; a timestamp once archived. */
  archived_at: string | null;
};

/** The select list behind ApplicationRow. Keep the two in step. */
export const ROW_COLUMNS =
  "id, title, company, job_url, status, billing, notes, applied_at, resume_key, resume_url, resume_name, profile_id, created_by, archived_at";
