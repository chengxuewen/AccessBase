import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PACKS } from '../packs/index.js';
import { compositeTintOver, wcagRatio } from '../tint.js';

/**
 * S1 golden lock + A-3 token-diff gate (plan rev.5): the cssVars exported by
 * the pack modules are diffed LIVE against docs/ui/prototypes/admin-console.html
 * — the contract is parsed on every run, so ANY cross-cutting prototype token
 * change reds this test before S1 merges (ruling A-3=B). Also locks:
 * cssVars key parity between packs, the adjudication-21 ≥4.5:1 *-text pairs
 * (via the SHARED tint util — same composition the mapper uses for antd
 * `*-bg` tokens), and themeConfig↔cssVars internal consistency.
 */
const HTML = path.resolve(
  __dirname,
  '../../../../..',
  'docs/ui/prototypes/admin-console.html',
);

function parseAllBlocks(html: string, selector: string): Array<Record<string, string>> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped.replace(/\s+/g, '\\s*') + '\\s*\\{([^}]*)\\}', 'g');
  const blocks: Array<Record<string, string>> = [];
  for (const m of html.matchAll(re)) {
    const body = m[1];
    if (body === undefined) continue;
    const out: Record<string, string> = {};
    for (const line of body.split(';')) {
      const t = line.trim();
      if (!t) continue;
      const i = t.indexOf(':');
      if (i <= 0) continue;
      const key = t.slice(0, i).trim();
      if (!key.startsWith('--')) continue; // only custom properties (color-scheme etc. are NOT tokens)
      out[key] = t.slice(i + 1).trim();
    }
    blocks.push(out);
  }
  if (blocks.length === 0) throw new Error(`selector block not found: ${selector}`);
  return blocks;
}

/** Merge EVERY block matching the selector (the contract splits a pack-theme
 * across a palette block AND an adjudication-21 *-text block). */
function parseBlock(html: string, selector: string): Record<string, string> {
  return Object.assign({}, ...parseAllBlocks(html, selector));
}

/** Throw-guard cssVar read (no non-null assertions — repo doctrine). */
const tok = (vars: Record<string, string>, k: string): string => {
  const v = vars[k];
  if (v === undefined) throw new Error(`cssVar missing: ${k}`);
  return v;
};

const html = readFileSync(HTML, 'utf-8');

/** Contract merge for a pack+theme, mirroring the prototype cascade. */
function contractPalette(style: 'ant' | 'broadsheet', theme: 'light' | 'dark'): Record<string, string> {
  const root = parseBlock(html, ':root');
  const rootTheme = parseBlock(html, `:root[data-theme="${theme}"]`);
  const packTheme = parseBlock(html, `[data-style="${style}"][data-theme="${theme}"]`);
  let merged = { ...root, ...rootTheme, ...packTheme };
  if (style === 'broadsheet') {
    // adjudication-21 *-text pairs ride separate blocks per pack
    const textBlock = parseBlock(html, `[data-style="broadsheet"][data-theme="${theme}"]`);
    merged = { ...merged, ...textBlock };
    // the generic text block only exists per-style; broadsheet's IS the one parsed above
  }
  return merged;
}

describe('pack cssVars vs the prototype contract (golden + A-3 gate)', () => {
  for (const packId of ['ant', 'broadsheet'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      it(`${packId}/${theme}: cssVars === live-merged contract palette`, () => {
        // both sides key VERBATIM with the '--' prefix — direct diff
        expect(PACKS[packId].cssVars[theme]).toEqual(contractPalette(packId, theme));
      });
    }
  }
});

describe('cssVars key parity between packs (same consumption surface for S2)', () => {
  // NOTE: within-pack light/dark parity is deliberately NOT locked — the
  // contract itself is asymmetric (--danger-inv exists light-only; ant dark
  // omits nothing the golden merge produces). Cross-pack parity per theme IS
  // the consumption-surface lock.
  it('both packs expose the identical key set (per theme)', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(Object.keys(PACKS.ant.cssVars[theme]).sort()).toEqual(
        Object.keys(PACKS.broadsheet.cssVars[theme]).sort(),
      );
    }
  });
});

describe('adjudication-21 contrast lock (≥4.5:1, shared composition)', () => {
  const PAIRS = ['ok-text', 'warn-text', 'danger-text', 'accent-text'] as const;
  for (const packId of ['ant', 'broadsheet'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      it(`${packId}/${theme}: all four *-text pairs ≥4.5:1 over composited tint`, () => {
        const vars = PACKS[packId].cssVars[theme];
        const surface = tok(vars, '--surface');
        for (const pair of PAIRS) {
          const family = pair.replace('-text', '');
          const tint = tok(vars, `--${family}-tint`);
          const fg = tok(vars, `--${pair}`);
          const bg = compositeTintOver(tint, surface);
          const ratio = wcagRatio(fg, bg);
          expect(ratio, `${packId}/${theme} ${pair} ${fg} on ${bg} = ${ratio}`).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});

describe('themeConfig ↔ cssVars internal consistency (same palette, two shapes)', () => {
  it('colorPrimary/colorError/colors and fonts match the cssVars source', () => {
    for (const packId of ['ant', 'broadsheet'] as const) {
      for (const theme of ['light', 'dark'] as const) {
        const vars = PACKS[packId].cssVars[theme];
        const token = PACKS[packId].themes[theme].token;
        if (!token) throw new Error('token block missing');
        expect(token.colorPrimary).toBe(vars['--accent']);
        expect(token.colorError).toBe(vars['--danger']);
        expect(token.colorSuccess).toBe(vars['--ok']);
        expect(token.colorWarning).toBe(vars['--warn']);
        expect(token.colorBgLayout).toBe(vars['--bg']);
        expect(token.colorBgContainer).toBe(vars['--surface']);
        expect(token.colorText).toBe(vars['--tx1']);
        expect(token.fontFamily).toBe(vars['--sans']);
        expect(token.controlHeight).toBe(32);
      }
    }
  });
});
