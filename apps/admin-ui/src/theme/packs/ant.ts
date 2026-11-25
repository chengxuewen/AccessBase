import type { PackDefinition } from '../types.js';
import type { ThemeConfig } from 'antd';
import { paletteToCssVars, paletteToThemeConfig } from '../mapping.js';
import { ANT_DARK, ANT_LIGHT, BASE, ROOT_DARK, ROOT_LIGHT, SEMANTIC_ROOT } from './contract.js';

/** ant pack table density: `[data-style="ant"] tbody td{padding:12px 16px}` (:349). */
function withTableDensity(theme: ThemeConfig, block: number): ThemeConfig {
  return { ...theme, components: { ...theme.components, Table: { cellPaddingBlock: block, cellPaddingInline: 16 } } };
}

/**
 * Ant pack — the DEFAULT (ruling A-1=B: zero-shock for existing users;
 * Broadsheet is the opt-in design-intent pack). The prototype's ant pack
 * inherits :root geometry/fonts (no overrides) and replaces the semantic
 * palette in both themes (cascade-merged exactly as the golden test merges).
 */
export const ant: PackDefinition = {
  id: 'ant',
  label: 'Ant Design',
  themes: {
    light: withTableDensity(
      paletteToThemeConfig({ ...BASE, ...SEMANTIC_ROOT, ...ROOT_LIGHT, ...ANT_LIGHT }, 'light'),
      12,
    ),
    dark: withTableDensity(
      paletteToThemeConfig({ ...BASE, ...SEMANTIC_ROOT, ...ROOT_DARK, ...ANT_DARK }, 'dark'),
      12,
    ),
  },
  cssVars: {
    light: paletteToCssVars({ ...BASE, ...SEMANTIC_ROOT, ...ROOT_LIGHT, ...ANT_LIGHT }),
    dark: paletteToCssVars({ ...BASE, ...SEMANTIC_ROOT, ...ROOT_DARK, ...ANT_DARK }),
  },
};
