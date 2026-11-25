import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePreference = 'light' | 'dark' | 'auto';

/** S1 (P-2=B/A-1=B): the two SHIPPED packs. Default 'ant' (zero-shock;
 * Broadsheet is the opt-in design-intent pack). */
export type PackPreference = 'ant' | 'broadsheet';

interface UiState {
  theme: ThemePreference;
  pack: PackPreference;
  setTheme: (t: ThemePreference) => void;
  setPack: (p: PackPreference) => void;
}

/** Persisted user preference only — the auto→matchMedia resolved value is transient. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'light',
      pack: 'ant',
      setTheme: (theme) => set({ theme }),
      setPack: (pack) => set({ pack }),
    }),
    // run-3 F7: partialize MUST include pack or its persistence silently dies
    { name: 'ui-storage', partialize: (s) => ({ theme: s.theme, pack: s.pack }) },
  ),
);
