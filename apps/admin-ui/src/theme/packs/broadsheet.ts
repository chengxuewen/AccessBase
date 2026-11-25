import type { PackDefinition } from '../types.js';
import type { ThemeConfig } from 'antd';
import { paletteToCssVars, paletteToThemeConfig } from '../mapping.js';
import { BASE, BROADSHEET_TEXT, ROOT_DARK, ROOT_LIGHT, SEMANTIC_ROOT } from './contract.js';

/** broadsheet table density: :root `tbody td{padding:var(--row-pad,6px) …}`
 * (adjudication 43) — NO [data-style="broadsheet"] override exists. */
function withTableDensity(theme: ThemeConfig, block: number): ThemeConfig {
  return {
    ...theme,
    components: {
      ...theme.components,
      // MERGE with the mapper's base Table tokens (S4 header grammar) — a
      // bare replace would silently drop headerBg/headerColor.
      Table: { ...theme.components?.Table, cellPaddingBlock: block, cellPaddingInline: 16 },
    },
  };
}

/**
 * Broadsheet (WorkOS-style enterprise language) — the PROTOTYPE'S baseline
 * pack (:root). Design intent pack (panel run 1: post-seal polish targeted
 * this pack); ships alongside Ant per ruling P-2=B, NOT the default (A-1=B).
 */
export const broadsheet: PackDefinition = {
  id: 'broadsheet',
  label: 'Broadsheet',
  themes: {
    light: withTableDensity(
      paletteToThemeConfig({ ...BASE, ...SEMANTIC_ROOT, ...ROOT_LIGHT, ...BROADSHEET_TEXT.light }, 'light'),
      6,
    ),
    dark: withTableDensity(
      paletteToThemeConfig({ ...BASE, ...SEMANTIC_ROOT, ...ROOT_DARK, ...BROADSHEET_TEXT.dark }, 'dark'),
      6,
    ),
  },
  cssVars: {
    light: paletteToCssVars({ ...BASE, ...SEMANTIC_ROOT, ...ROOT_LIGHT, ...BROADSHEET_TEXT.light }),
    dark: paletteToCssVars({ ...BASE, ...SEMANTIC_ROOT, ...ROOT_DARK, ...BROADSHEET_TEXT.dark }),
  },
};
