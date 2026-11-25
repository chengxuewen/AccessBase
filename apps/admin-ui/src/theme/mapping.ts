import type { ThemeConfig } from 'antd';
import type { Palette } from './types.js';
import { compositeTintOver } from './tint.js';

/**
 * S1 mapper: contract palette → (antd ThemeConfig, cssVars). ONE mapping for
 * every pack — the packs differ only in palette data (golden-locked in
 * theme/__tests__/packs.test.ts against the prototype HTML).
 *
 * Secondary/hover states are PINNED from contract values where the contract
 * has them (panel run 2: prototype dark palettes are hand-authored, NOT
 * algorithm inversions — algorithm-derived hover/fill values would break the
 * contrast locks). Tints composite to OPAQUE hex over the surface so antd's
 * `*-bg` tokens and the WCAG test agree on one composition (shared util).
 */

const px = (v: string | undefined): number => Number.parseInt(v ?? '0', 10);

/** Throw-guard contract token read (no non-null assertions — repo doctrine). */
const tok = (p: Palette, k: string): string => {
  const v = p[k];
  if (v === undefined) throw new Error(`contract token missing: --${k}`);
  return v;
};

export function paletteToThemeConfig(p: Palette, mode: 'light' | 'dark'): ThemeConfig {
  const surface = tok(p, 'surface');
  return {
    algorithm: mode === 'dark' ? undefined : undefined, // algorithm lives in LocaleGate; token overrides assume the matching algorithm
    token: {
      // surfaces / text / borders (contract-verbatim)
      colorBgLayout: p['bg'],
      colorBgContainer: surface,
      colorBgElevated: surface,
      // the fill family IS the hover family — pinned (never algorithm-derived)
      colorFill: tok(p, 'hover'),
      colorFillSecondary: tok(p, 'hover'),
      colorFillContent: tok(p, 'hover'),
      colorFillContentHover: tok(p, 'hover'),
      colorText: tok(p, 'tx1'),
      colorTextSecondary: tok(p, 'tx2'),
      colorTextTertiary: tok(p, 'tx3'),
      colorTextQuaternary: tok(p, 'tx3'),
      colorTextLightSolid: tok(p, 'txinv'),
      colorBorder: tok(p, 'bd'),
      colorBorderSecondary: tok(p, 'bd2'),
      // brand / semantic
      colorPrimary: tok(p, 'accent'),
      colorPrimaryHover: tok(p, 'accent-hi'),
      colorPrimaryActive: tok(p, 'accent-hi'),
      colorPrimaryBg: compositeTintOver(tok(p, 'accent-tint'), surface),
      colorPrimaryText: tok(p, 'accent-text'),
      colorLink: tok(p, 'accent'),
      colorLinkHover: tok(p, 'accent-hi'),
      colorLinkActive: tok(p, 'accent-hi'),
      colorInfo: tok(p, 'accent'),
      colorSuccess: tok(p, 'ok'),
      colorSuccessBg: compositeTintOver(tok(p, 'ok-tint'), surface),
      colorSuccessText: tok(p, 'ok-text'),
      colorWarning: tok(p, 'warn'),
      colorWarningBg: compositeTintOver(tok(p, 'warn-tint'), surface),
      colorWarningText: tok(p, 'warn-text'),
      colorError: tok(p, 'danger'),
      colorErrorBg: compositeTintOver(tok(p, 'danger-tint'), surface),
      colorErrorText: tok(p, 'danger-text'),
      // focus ring base (exemption file refines per-control in S2)
      colorPrimaryBorder: tok(p, 'focus'),
      // geometry (contract ctl-h 32/24 = antd default tiers, pinned explicit)
      controlHeight: px(tok(p, 'ctl-h')),
      borderRadius: px(tok(p, 'r4')),
      borderRadiusSM: px(tok(p, 'r2')),
      borderRadiusLG: px(tok(p, 'r6')),
      // typography
      fontFamily: tok(p, 'sans'),
      fontSize: px(tok(p, 'fs14')),
      // density (broadsheet/geist table contract rides component tokens in S2;
      // the global default stays contract-verbatim)
    },
  };
}

/** cssVars keyed EXACTLY like the prototype custom properties (golden diff). */
export function paletteToCssVars(p: Palette): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) out[`--${k}`] = v;
  return out;
}
