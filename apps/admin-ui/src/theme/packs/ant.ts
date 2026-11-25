import type { PackDefinition } from '../types.js';
import { paletteToCssVars, paletteToThemeConfig } from '../mapping.js';
import { ANT_DARK, ANT_LIGHT, BASE, ROOT_DARK, ROOT_LIGHT, SEMANTIC_ROOT } from './contract.js';

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
    light: paletteToThemeConfig({ ...BASE, ...SEMANTIC_ROOT, ...ROOT_LIGHT, ...ANT_LIGHT }, 'light'),
    dark: paletteToThemeConfig({ ...BASE, ...SEMANTIC_ROOT, ...ROOT_DARK, ...ANT_DARK }, 'dark'),
  },
  cssVars: {
    light: paletteToCssVars({ ...BASE, ...SEMANTIC_ROOT, ...ROOT_LIGHT, ...ANT_LIGHT }),
    dark: paletteToCssVars({ ...BASE, ...SEMANTIC_ROOT, ...ROOT_DARK, ...ANT_DARK }),
  },
};
