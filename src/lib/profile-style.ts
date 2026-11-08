"use client";

import { useCallback, useEffect } from "react";

import { DEFAULT_STYLE } from "@/components/resume-style-toolbar";
import { usePersistentState } from "@/lib/persistent-state";
import { cleanStyle, STYLES_KEY, type SavedStyle } from "@/lib/resume-style";
import { createClient } from "@/lib/supabase/client";
import type { ResumeStyle } from "@/lib/supabase/types";

/** Template and styling, remembered together so they can't fall out of step. */
export type Preset = { template: string; style: ResumeStyle };

export const DEFAULT_PRESET: Preset = { template: "banner", style: DEFAULT_STYLE };

/**
 * One person's styles in this browser: one per profile, and the last one
 * used anywhere — which is where a profile not styled yet starts from.
 */
type Store = { byProfile: Record<string, Preset>; last: Preset | null };

const NOTHING_SAVED: Store = { byProfile: {}, last: null };

/**
 * Where everyone's style lived before it was kept per profile. Read, never
 * written: a profile with nothing of its own starts from it, so nobody loses
 * the style they had settled on.
 */
const LEGACY_KEY = "tw.resume.style";
const NO_LEGACY: Preset | null = null;

/**
 * The resume style for this person and this profile, kept in localStorage.
 *
 * Per profile because each candidate tends to keep a look — one reads best in
 * a serif, another needs the compact template to fit — and switching between
 * them shouldn't mean restyling every time. Per person because two people can
 * share a browser. A profile not styled yet starts from the style last used on
 * any profile; changing it from there gives that profile its own.
 */
export function useProfileStyle(userId: string, profileId: string | null) {
  const [store, setStore] = usePersistentState<Store>(`tw.resume.styles.${userId}`, NOTHING_SAVED);
  const [legacy] = usePersistentState<Preset | null>(LEGACY_KEY, NO_LEGACY);

  const inherited = store.last ?? legacy ?? DEFAULT_PRESET;
  const preset = (profileId ? store.byProfile?.[profileId] : undefined) ?? inherited;

  const setPreset = useCallback(
    (next: Preset | ((previous: Preset) => Preset)) => {
      setStore((previous) => {
        const byProfile = previous.byProfile ?? {};
        const current = (profileId ? byProfile[profileId] : undefined) ?? previous.last ?? legacy ?? DEFAULT_PRESET;
        const resolved = typeof next === "function" ? next(current) : next;
        return {
          byProfile: profileId ? { ...byProfile, [profileId]: resolved } : byProfile,
          last: resolved,
        };
      });
    },
    [profileId, legacy, setStore],
  );

  return [preset, setPreset] as const;
}

/**
 * Keeps the account's copy of this profile's style in step with the builder
 * (see src/lib/resume-style.ts), so what the server renders — the Chrome
 * extension's pasted resumes and batches — looks like the preview here.
 *
 * Written a moment after the style settles, and only when it differs from
 * what the account already holds, so dragging a slider is one write and
 * opening the page is none.
 */
export function useSyncedProfileStyle(profileId: string | null, preset: Preset, enabled: boolean) {
  const signature = JSON.stringify(preset);
  useEffect(() => {
    if (!enabled || !profileId) return;
    const timer = setTimeout(async () => {
      const next: SavedStyle = { template: preset.template, style: cleanStyle(preset.style) ?? {} };
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const all = (data.user.user_metadata?.[STYLES_KEY] ?? {}) as Record<string, SavedStyle>;
      if (JSON.stringify(all[profileId]) === JSON.stringify(next)) return;
      // Best effort: the browser keeps its own copy either way.
      await supabase.auth.updateUser({ data: { [STYLES_KEY]: { ...all, [profileId]: next } } }).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
    // `signature` stands for `preset`, so an equal style re-created doesn't restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, profileId, signature]);
}
