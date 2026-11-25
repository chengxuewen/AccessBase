import type { PackDefinition } from '../types.js';
import { paletteToCssVars, paletteToThemeConfig } from '../mapping.js';
import { BASE, BROADSHEET_TEXT, ROOT_DARK, ROOT_LIGHT, SEMANTIC_ROOT } from './contract.js';

/**
 * Broadsheet (WorkOS-style enterprise language) — the PROTOTYPE'S baseline
 * pack (:root). Design intent pack (panel run 1: post-seal polish targeted
 * this pack); ships alongside Ant per ruling P-2=B, NOT the default (A-1=B).
 */
export const broadsheet: PackDefinition = {
  id: 'broadsheet',
  label: 'Broadsheet',
  themes: {
    light: paletteToThemeConfig({ ...BASE, ...SEMANTIC_ROOT, ...ROOT_LIGHT, ...BROADSHEET_TEXT.light }, 'light'),
    dark: paletteToThemeConfig({ ...BASE, ...SEMANTIC_ROOT, ...ROOT_DARK, ...BROADSHEET_TEXT.dark }, 'dark'),
  },
  cssVars: {
    light: paletteToCssVars({ ...BASE, ...SEMANTIC_ROOT, ...ROOT_LIGHT, ...BROADSHEET_TEXT.light }),
    dark: paletteToCssVars({ ...BASE, ...SEMANTIC_ROOT, ...ROOT_DARK, ...BROADSHEET_TEXT.dark }),
  },
};
