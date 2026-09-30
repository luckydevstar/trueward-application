/**
 * Reads every row of a query, a page at a time.
 *
 * PostgREST caps a single response at 1,000 rows — Supabase's `db-max-rows` —
 * and it does it **silently**. You get 1,000 rows and a 200, with nothing to
 * say the rest exist. That is exactly how a tracker holding 1,682
 * applications came to show 1,000 of them: the query had no `.range()`, so
 * PostgREST applied its own and the page believed the answer.
 *
 * `page` is given a half-open-ish range in PostgREST's terms — `from` and `to`
 * are both inclusive — and returns whatever the query does. Called until a
 * page comes back short, which is the only reliable end signal: a final page
 * that happens to be exactly `size` rows is followed by one empty page, which
 * costs a round trip and removes the guesswork.
 *
 * This loads the whole table into the page payload, which is the right shape
 * while the grid filters, searches, sorts and paginates client-side — all of
 * which need every row to be correct. It stops being the right shape somewhere
 * in the low tens of thousands, where the answer is server-side paging and a
 * redesign of those four things rather than a bigger fetch.
 */
export async function fetchAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 1000,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];

  // A ceiling, so a query that somehow never shortens cannot spin forever.
  for (let offset = 0; offset < size * 200; offset += size) {
    const { data, error } = await page(offset, offset + size - 1);

    // Partial data plus an error is still worth showing — a page of 1,000
    // applications with a warning beats an empty grid.
    if (error) return { rows, error: error.message };

    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < size) break;
  }

  return { rows, error: null };
}
