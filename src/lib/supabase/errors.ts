import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Turns a Postgres error into something worth showing someone.
 *
 * "new row violates row-level security policy for table X" is accurate and
 * useless: it says a WITH CHECK clause evaluated false without saying which,
 * and the app genuinely cannot tell — the policy runs in the database and
 * reports only pass or fail.
 *
 * So this names the causes worth checking rather than pretending to diagnose.
 * In practice a refused insert is almost always one of two things: a migration
 * that hasn't been applied, or an account with no team behind it.
 */
export function describeWriteError(
  error: Pick<PostgrestError, "code" | "message"> | null,
  what: string,
): string {
  if (!error) return `Could not save the ${what}.`;

  // 42501 — insufficient_privilege. PostgREST reports an RLS refusal this way.
  if (error.code === "42501" || /row-level security/i.test(error.message)) {
    return (
      `The database refused to save this ${what}. That usually means one of two ` +
      `things: a migration hasn't been applied yet, or your account isn't linked ` +
      `to a team. An admin can check by running supabase/diagnose.sql.`
    );
  }

  // 23505 — unique_violation.
  if (error.code === "23505") {
    return `That ${what} already exists.`;
  }

  // 23503 — foreign_key_violation: something it points at is gone.
  if (error.code === "23503") {
    return `Something this ${what} refers to no longer exists. Try reloading.`;
  }

  return error.message;
}
