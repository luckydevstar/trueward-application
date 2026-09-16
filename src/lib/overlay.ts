/**
 * A local edit layer over a list that arrived as a prop.
 *
 * The problem it solves: a grid wants to show an edit the instant it is made,
 * without re-fetching the page, but must also drop those edits the moment the
 * server sends a fresh list — otherwise stale local rows shadow new server
 * ones forever. The usual answer is an effect that copies props into state
 * and resets on change, which renders one frame of the old data first and is
 * the thing React's "you might not need an effect" page exists to warn about.
 *
 * Instead the overlay remembers which props value it was built on. Reading it
 * compares that to the current props *during render*: same reference, use the
 * overlay; different, the server has spoken and the overlay is ignored. No
 * effect, no extra render, no window where the two disagree.
 *
 * Pure functions rather than a hook so they can be exercised without a DOM.
 */
export type Overlay<T> = { base: readonly T[]; rows: readonly T[] };

/** The list to show: the overlay if it was built on these props, else the props. */
export function resolveOverlay<T>(
  overlay: Overlay<T> | null,
  base: readonly T[],
): readonly T[] {
  return overlay && overlay.base === base ? overlay.rows : base;
}

/**
 * The next overlay after applying `change` to whatever is currently shown.
 *
 * Built on the *current* props even if the previous overlay was not, so an
 * edit made just after a server refresh applies to the fresh list rather than
 * resurrecting the stale one.
 */
export function applyOverlay<T>(
  previous: Overlay<T> | null,
  base: readonly T[],
  change: (current: readonly T[]) => readonly T[],
): Overlay<T> {
  return { base, rows: change(resolveOverlay(previous, base)) };
}
