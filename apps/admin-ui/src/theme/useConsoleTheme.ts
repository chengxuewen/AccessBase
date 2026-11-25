import { useMemo } from 'react';
import type { ThemeConfig } from 'antd';
import { useUiStore } from '../stores/ui.js';
import { PACKS } from './packs/index.js';

/**
 * S1 (plan rev.5): resolved-theme source of truth (moved here from
 * LocaleGate so auth pages and the gate share ONE resolver), plus the
 * useConsoleTheme merge — pack config + branding primary override.
 *
 * Scope boundary (run-3 F6, preserved): branding primaryColor overrides
 * colorPrimary ONLY and reaches ONLY the subtree the caller wraps — it must
 * NEVER leak into AdminLayout/ProLayout (public-facing brand color ≠ console
 * theme; AdminLayout takes siteName/logo only).
 */
export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useUiStore((s) => s.theme);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return theme === 'auto' ? (prefersDark ? 'dark' : 'light') : theme;
}

export function useConsoleTheme(brandingPrimary?: string): ThemeConfig {
  const pack = useUiStore((s) => s.pack);
  const resolved = useResolvedTheme();
  return useMemo(() => {
    const def = PACKS[pack];
    const base = def.themes[resolved];
    if (!brandingPrimary) return base;
    // branding overrides colorPrimary ONLY (run-3 F6 scope boundary)
    return { ...base, token: { ...base.token, colorPrimary: brandingPrimary } };
  }, [pack, resolved, brandingPrimary]);
}
