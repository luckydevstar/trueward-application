"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Persisted table column widths.
 *
 * localStorage is genuinely an external store, so it is read through
 * useSyncExternalStore rather than copied into state by an effect. That gets
 * three things at once: no setState-in-effect cascade, a server snapshot that
 * matches what the server actually rendered (so no hydration mismatch), and a
 * single source of truth if two grids ever share a key.
 *
 * Snapshots must be referentially stable — useSyncExternalStore compares by
 * identity and would loop forever on a fresh object each call — hence the
 * cache below, which is only replaced on an actual write.
 */

type Widths = Record<string, number>;

const listeners = new Set<() => void>();
const cache = new Map<string, Widths>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab resizing the same grid should be reflected here.
  const onStorage = () => {
    cache.clear();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function snapshot(key: string, defaults: Widths): Widths {
  const hit = cache.get(key);
  if (hit) return hit;

  let value = defaults;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored) value = { ...defaults, ...JSON.parse(stored) };
  } catch {
    // Corrupt JSON or storage disabled — defaults are a fine answer.
  }
  cache.set(key, value);
  return value;
}

export function useColumnWidths(key: string, defaults: Widths) {
  const widths = useSyncExternalStore(
    subscribe,
    () => snapshot(key, defaults),
    // Server snapshot: the defaults, which is exactly what the server markup
    // used. Returning stored widths here would be a hydration mismatch.
    () => defaults,
  );

  const setWidth = useCallback(
    (column: string, width: number) => {
      const next = { ...snapshot(key, defaults), [column]: Math.max(80, width) };
      cache.set(key, next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Private browsing: resizing still works for this session.
      }
      emit();
    },
    [key, defaults],
  );

  return [widths, setWidth] as const;
}
