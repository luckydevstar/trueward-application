"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * State backed by localStorage, shared across mounts and tabs.
 *
 * Read through useSyncExternalStore rather than copied into state by an effect.
 * That buys three things at once: no setState-in-effect cascade, a server
 * snapshot that matches what the server actually rendered (so no hydration
 * mismatch), and one source of truth if two components use the same key.
 *
 * Snapshots must be referentially stable — useSyncExternalStore compares by
 * identity and would loop forever on a fresh object each call — hence the cache
 * below, replaced only on an actual write.
 *
 * `fallback` must be a stable reference (a module-level constant). A literal
 * built during render is a new object every time, which defeats the cache.
 */

const listeners = new Set<() => void>();
const cache = new Map<string, unknown>();

function subscribe(listener: () => void) {
  listeners.add(listener);

  // Another tab writing the same key should be reflected here.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || cache.has(event.key)) cache.delete(event.key ?? "");
    listener();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function snapshot<T>(key: string, fallback: T): T {
  if (cache.has(key)) return cache.get(key) as T;

  let value = fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merged rather than replaced, so a key added to the shape later gets its
      // default instead of coming back undefined for anyone with saved state.
      value =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? { ...(fallback as object), ...parsed }
          : parsed;
    }
  } catch {
    // Corrupt JSON or storage disabled — the fallback is a fine answer.
  }

  cache.set(key, value);
  return value;
}

export function usePersistentState<T>(key: string, fallback: T) {
  const value = useSyncExternalStore(
    subscribe,
    () => snapshot(key, fallback),
    // Server snapshot: the fallback, which is exactly what the server markup
    // used. Returning stored state here would be a hydration mismatch.
    () => fallback,
  );

  const setValue = useCallback(
    (next: T | ((previous: T) => T)) => {
      const resolved =
        typeof next === "function"
          ? (next as (previous: T) => T)(snapshot(key, fallback))
          : next;

      cache.set(key, resolved);
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        // Private browsing: the value still holds for this session.
      }
      for (const listener of listeners) listener();
    },
    [key, fallback],
  );

  return [value, setValue] as const;
}
