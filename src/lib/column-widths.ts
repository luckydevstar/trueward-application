"use client";

import { useCallback } from "react";

import { usePersistentState } from "@/lib/persistent-state";

type Widths = Record<string, number>;

/**
 * Persisted table column widths.
 *
 * A thin wrapper over usePersistentState so a resize writes one column rather
 * than the whole map, and so the 80px floor lives in one place instead of at
 * every call site.
 */
export function useColumnWidths(key: string, defaults: Widths) {
  const [widths, setWidths] = usePersistentState<Widths>(key, defaults);

  const setWidth = useCallback(
    (column: string, width: number) => {
      setWidths((previous) => ({
        ...previous,
        // Below this a column is unreadable and its resize handle is
        // effectively unreachable, so it can't be dragged back.
        [column]: Math.max(80, width),
      }));
    },
    [setWidths],
  );

  return [widths, setWidth] as const;
}
