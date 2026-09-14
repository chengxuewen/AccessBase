import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePreference = 'light' | 'dark' | 'auto';

interface UiState {
  theme: ThemePreference;
  setTheme: (t: ThemePreference) => void;
}

/** Persisted user preference only — the auto→matchMedia resolved value is transient. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'light',
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'ui-storage', partialize: (s) => ({ theme: s.theme }) },
  ),
);
