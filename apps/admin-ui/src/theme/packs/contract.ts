import type { Palette } from '../types.js';

/**
 * S1 contract data — transcribed VERBATIM from
 * docs/ui/prototypes/admin-console.html (golden-locked live by
 * theme/__tests__/packs.test.ts, which parses the HTML and diffs THIS module;
 * that test doubles as the A-3 token-diff gate). Keys = prototype custom
 * properties minus the `--` prefix; values = prototype values verbatim
 * (including `var(--r6)` references — the exemption file consumes them as-is).
 *
 * Layering (per the prototype's cascade):
 *   BASE          :root pack-agnostic globals (:12-26)
 *   SEMANTIC_ROOT :root semantic defaults (:13-16 — broadsheet hues shared by
 *                  both packs as the pre-override layer)
 *   ROOT_LIGHT/ROOT_DARK: :root[data-theme] (:27-41)
 *   per-pack overrides: [data-style="…"][data-theme] blocks + adjudication-21
 *   *-text pairs (:383-399).
 */

export const BASE: Palette = {
  r2: '2px',
  r4: '4px',
  r6: '6px',
  sp4: '4px',
  sp8: '8px',
  sp12: '12px',
  sp16: '16px',
  sp20: '20px',
  sp24: '24px',
  sans: '"IBM Plex Sans",-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
  mono: '"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace',
  'ic-s': '12px',
  'ic-m': '14px',
  'ic-l': '16px',
  'ic-display': '28px',
  'r-pop': 'var(--r6)',
  'r-tag': 'var(--r2)',
  'ctl-h': '32px',
  'ctl-h-sm': '24px',
  fs11: '11px',
  fs12: '12px',
  fs13: '13px',
  fs14: '14px',
  fs16: '16px',
  fs20: '20px',
  fs22: '22px',
  fs26: '26px',
  fs40: '40px',
  'shadow-tip': '0 2px 10px rgba(0,0,0,.12)',
  'shadow-pop': '0 8px 32px rgba(0,0,0,.18)',
  'shadow-toast': '0 4px 16px rgba(0,0,0,.2)',
  'shadow-card': '0 2px 12px rgba(0,0,0,.06)',
  'shadow-sm': '0 1px 3px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.24)',
  'shadow-hair': '0 1px 2px rgba(0,0,0,.06),0 0 1px rgba(0,0,0,.10)',
  'nav-w': '224px',
  'nav-w-min': '56px',
  'top-h': '52px',
  // adjudication 43 (prototype session, live A-3 gate catch): derived border
  // role — one :root definition, var-referencing (both themes share it)
  'bd-hair': 'color-mix(in srgb, var(--bd) 40%, var(--surface))',
  // :root-level default (line 15) — both packs inherit unless overridden
  'warn-text': '#8A6116',
};

export const SEMANTIC_ROOT: Palette = {
  accent: '#0F5C5A',
  'accent-hi': '#0A4A48',
  'accent-tint': 'rgba(15,92,90,.08)',
  ok: '#1D7A46',
  'ok-tint': 'rgba(29,122,70,.10)',
  warn: '#9A6A1B',
  'warn-tint': 'rgba(154,106,27,.10)',
  danger: '#B3372F',
  'danger-solid': '#B3372F',
  'danger-tint': 'rgba(179,55,47,.09)',
};

export const ROOT_LIGHT: Palette = {
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  sunken: '#F7F6F3',
  hover: '#F2F1ED',
  'danger-inv': '#FFFFFF',
  tx1: '#29363D',
  tx2: '#5C6B73',
  tx3: '#5F6A6E',
  txinv: '#FFFFFF',
  bd: '#E6E4DF',
  bd2: '#D4D2CC',
  focus: '#0F5C5A',
};

export const ROOT_DARK: Palette = {
  bg: '#15191B',
  surface: '#1B2124',
  sunken: '#121618',
  hover: '#22292C',
  tx1: '#E8E6E2',
  tx2: '#A8B0B4',
  tx3: '#9AA4A8',
  txinv: '#15191B',
  bd: '#2A3236',
  bd2: '#3A4348',
  focus: '#4FB3AE',
  accent: '#4FB3AE',
  'accent-hi': '#63C4BF',
  'accent-tint': 'rgba(79,179,174,.12)',
  ok: '#5CBF8A',
  'ok-tint': 'rgba(92,191,138,.12)',
  warn: '#D9A441',
  'warn-tint': 'rgba(217,164,65,.12)',
  danger: '#E07B72',
  'danger-solid': '#B3372F',
  'danger-tint': 'rgba(224,123,114,.12)',
};

/** Adjudication 21 *-text pairs — broadsheet block (:386-387). */
export const BROADSHEET_TEXT: { light: Palette; dark: Palette } = {
  light: { 'ok-text': '#1D7A46', 'warn-text': '#8A6116', 'danger-text': '#B3372F', 'accent-text': '#0F5C5A' },
  dark: { 'ok-text': '#5CBF8A', 'warn-text': '#D9A441', 'danger-text': '#E07B72', 'accent-text': '#4FB3AE' },
};

/** Ant pack palettes (:340-347 light/dark + :394-395 text pairs). */
export const ANT_LIGHT: Palette = {
  bg: '#F5F5F5',
  surface: '#FFFFFF',
  sunken: '#FAFAFA',
  hover: 'rgba(0,0,0,.04)',
  tx1: 'rgba(0,0,0,.88)',
  tx2: 'rgba(0,0,0,.65)',
  tx3: 'rgba(0,0,0,.65)',
  txinv: '#FFFFFF',
  bd: '#D9D9D9',
  bd2: '#BFBFBF',
  focus: '#1677FF',
  accent: '#1677FF',
  'accent-hi': '#4096FF',
  'accent-tint': 'rgba(22,119,255,.10)',
  ok: '#52C41A',
  'ok-tint': 'rgba(82,196,26,.10)',
  warn: '#FAAD14',
  'warn-tint': 'rgba(250,173,20,.10)',
  danger: '#FF4D4F',
  'danger-solid': '#CF1322',
  'danger-tint': 'rgba(255,77,79,.10)',
  'ok-text': '#116932',
  'warn-text': '#8A6116',
  'danger-text': '#B3372F',
  'accent-text': '#0E5FA8',
};

export const ANT_DARK: Palette = {
  bg: '#000000',
  surface: '#141414',
  sunken: '#0A0A0A',
  hover: 'rgba(255,255,255,.08)',
  tx1: 'rgba(255,255,255,.85)',
  tx2: 'rgba(255,255,255,.65)',
  tx3: 'rgba(255,255,255,.65)',
  txinv: '#FFFFFF',
  bd: '#424242',
  bd2: '#5A5A5A',
  focus: '#1668DC',
  accent: '#1668DC',
  'accent-hi': '#3C89E8',
  'accent-tint': 'rgba(22,104,220,.16)',
  'accent-text': '#69B1FF',
  ok: '#49AA19',
  'ok-tint': 'rgba(73,170,25,.16)',
  warn: '#D89614',
  'warn-tint': 'rgba(216,150,20,.16)',
  danger: '#DC4446',
  'danger-solid': '#CF1322',
  'danger-tint': 'rgba(220,68,70,.16)',
  'danger-text': '#FF7875',
  'ok-text': '#73D13D',
  'warn-text': '#D89614',
};
