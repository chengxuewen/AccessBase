import type { ThemeConfig } from 'antd';

/**
 * S1 (plan rev.5): pack definition — the CONTRACT is the source of truth.
 * `cssVars` keys mirror the prototype's custom-property names VERBATIM
 * (`--accent`, `--bg`, …) so `theme/__tests__/packs.test.ts` can diff this
 * module against `docs/ui/prototypes/admin-console.html` LIVE — that test is
 * simultaneously the golden-fixture lock AND the A-3 token-diff gate (any
 * cross-cutting prototype token change reds it before S1 merges).
 */
export type PackId = 'ant' | 'broadsheet';

/** Raw contract palette — keys WITHOUT the `--` prefix, values verbatim. */
export type Palette = Record<string, string>;

export interface PackDefinition {
  id: PackId;
  /** Selector label — proper noun, not i18n'd (brand-name doctrine). */
  label: string;
  themes: { light: ThemeConfig; dark: ThemeConfig };
  cssVars: { light: Record<string, string>; dark: Record<string, string> };
}
