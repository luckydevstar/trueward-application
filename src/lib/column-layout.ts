"use client";

import { useCallback, useMemo } from "react";

import { usePersistentState } from "@/lib/persistent-state";

/** A table's column order and which columns are hidden, as this browser keeps them. */
type Layout = { order: string[]; hidden: string[] };

const NOTHING_SAVED: Layout = { order: [], hidden: [] };

/**
 * The saved order, reconciled with the columns the table has today: a key
 * that no longer exists is dropped, and a column added since slots in after
 * its default neighbour rather than at the end — so a new column appears
 * where it was designed to, even for someone who has rearranged the rest.
 */
function reconcile(saved: string[], defaults: readonly string[]): string[] {
  const order = saved.filter((key, i) => defaults.includes(key) && saved.indexOf(key) === i);
  defaults.forEach((key, i) => {
    if (order.includes(key)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j -= 1) {
      const before = order.indexOf(defaults[j]);
      if (before >= 0) {
        at = before + 1;
        break;
      }
    }
    order.splice(at, 0, key);
  });
  return order;
}

/**
 * Persisted column order and visibility for a table, beside its widths
 * (useColumnWidths). Stored per browser in localStorage, so each window and
 * each person keeps the layout they work in.
 *
 * `defaults` is the designed order and must be a stable reference (a module
 * constant). Keys in `pinned` neither move nor hide — the actions column, say.
 */
export function useColumnLayout(storageKey: string, defaults: readonly string[], pinned: readonly string[] = []) {
  const [layout, setLayout] = usePersistentState<Layout>(storageKey, NOTHING_SAVED);

  const order = useMemo(() => reconcile(layout.order ?? [], defaults), [layout.order, defaults]);
  const hidden = useMemo(
    () => new Set((layout.hidden ?? []).filter((key) => defaults.includes(key) && !pinned.includes(key))),
    [layout.hidden, defaults, pinned],
  );

  /** Puts `key` just before or after `target`. */
  const move = useCallback(
    (key: string, target: string, place: "before" | "after") => {
      if (key === target || pinned.includes(key) || pinned.includes(target)) return;
      setLayout((previous) => {
        const next = reconcile(previous.order ?? [], defaults).filter((k) => k !== key);
        const at = next.indexOf(target);
        if (at < 0) return previous;
        next.splice(place === "before" ? at : at + 1, 0, key);
        return { ...previous, order: next };
      });
    },
    [defaults, pinned, setLayout],
  );

  /** One place left (-1) or right (+1), skipping hidden and pinned columns. */
  const shift = useCallback(
    (key: string, by: -1 | 1) => {
      const movable = order.filter((k) => !pinned.includes(k) && !hidden.has(k));
      const at = movable.indexOf(key);
      const neighbour = movable[at + by];
      if (at < 0 || !neighbour) return;
      move(key, neighbour, by < 0 ? "before" : "after");
    },
    [order, pinned, hidden, move],
  );

  const toggle = useCallback(
    (key: string) => {
      if (pinned.includes(key)) return;
      setLayout((previous) => {
        const current = new Set(previous.hidden ?? []);
        if (current.has(key)) current.delete(key);
        else current.add(key);
        return { ...previous, hidden: [...current] };
      });
    },
    [pinned, setLayout],
  );

  const reset = useCallback(() => setLayout(NOTHING_SAVED), [setLayout]);

  const customised = (layout.order?.length ?? 0) > 0 || (layout.hidden?.length ?? 0) > 0;

  return { order, hidden, move, shift, toggle, reset, customised };
}
