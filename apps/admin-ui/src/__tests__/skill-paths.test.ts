/**
 * W0.4 — design-system skill path gate (run-2 H-2 fold).
 *
 * The v1 skill pointed at phantom paths (packages/admin-ui/, theme/tokens.ts,
 * aude-theme, zh-CN.json) — "phantom authority" defect class (E20 family).
 * Every path the skill cites MUST resolve on disk. The path list lives here;
 * adding a skill reference without adding it here = the gate cannot see it
 * (the boundary test for documentation, mirroring css-boundary for CSS).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../..'); // __tests__ → src → admin-ui → apps → repo root
const SKILL = path.join(ROOT, '.agents/skills/design-system/SKILL.md');

/** Paths the skill text references — each must exist. */
const REQUIRED_PATHS = [
  'apps/admin-ui/src',
  'apps/admin-ui/src/layouts/AdminLayout.tsx',
  'apps/admin-ui/src/components/LocaleGate.tsx',
  'apps/admin-ui/src/stores/ui.ts',
  'apps/admin-ui/src/i18n/locales/zh.json',
  'apps/admin-ui/src/i18n/locales/en.json',
  'apps/admin-ui/src/i18n/__tests__/parity.test.ts',
  'e2e/fixtures/mocks.ts',
  'playwright.config.ts',
  'docs/ui/prototypes/README.md',
  'docs/superpowers/plans/2026-11-24-ui-alignment-refactor.md',
];

/** Paths the skill must NOT reference anymore (v1 phantoms). */
const BANNED_MARKERS = [
  'packages/admin-ui',
  'theme/tokens.ts',
  'aude-theme',
  'zh-CN.json',
  'en-US.json',
];

describe('design-system skill reality gate (W0.4)', () => {
  it('skill file exists', () => {
    expect(existsSync(SKILL)).toBe(true);
  });

  it('every referenced path resolves on disk', () => {
    for (const rel of REQUIRED_PATHS) {
      expect(existsSync(path.join(ROOT, rel)), `missing: ${rel}`).toBe(true);
    }
  });

  it('carries no v1 phantom markers', () => {
    const text = readFileSync(SKILL, 'utf-8');
    for (const marker of BANNED_MARKERS) {
      expect(text.includes(marker), `phantom marker in skill: ${marker}`).toBe(false);
    }
  });

  it('covers the refactor contract surface (packs, exemption, tiers, no-shrink)', () => {
    const text = readFileSync(SKILL, 'utf-8');
    for (const marker of [
      'pack-vars.css',
      'ui-storage',
      'pack-select',
      'control-tier',
      'broadsheet',
      'switch',
    ]) {
      expect(text.toLowerCase().includes(marker.toLowerCase()), `skill missing: ${marker}`).toBe(
        true,
      );
    }
  });
});
