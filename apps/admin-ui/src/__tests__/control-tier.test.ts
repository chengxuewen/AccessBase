/**
 * W0.6 — control-tier static lock (rev.5: scanner + EMPTY allowlist now;
 * allowlist CONTENT fills at the wait point from the mirrored contract).
 *
 * The contract's per-container control-height rule (32 form/toolbar vs 24
 * in-table/dense) is invisible to tokens (usage rule, not theming), to
 * behavior specs, and to screenshots at 0.002 — this static scan is the only
 * automated enforcer. Run-1 ruling: lint-enforced, not human-audited.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const PAGES = path.resolve(__dirname, '../pages');

/**
 * Per-page control-tier allowlist: page file → { size:"large" | size:"small"
 * occurrences allowed, with reasons }. EMPTY today — the wait-point contract
 * mirror fills it. Until then the scan asserts the MECHANISM works (it
 * detects real usages) rather than enforcing content.
 */
const ALLOWLIST: Readonly<Record<string, { large: number; small: number }>> = {};

/** Boolean-domain rule (prototype contract): form-submitted binaries are
 * Checkbox; only immediate-effect toggles may be Switch. Per-page Switch
 * count allowlist — forms must not grow new Switches. */
const SWITCH_ALLOWLIST: Readonly<Record<string, number>> = {};

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (entry.endsWith('.tsx')) yield full;
  }
}

describe('control-tier static lock (W0.6)', () => {
  it('scanner detects real size usages (mechanism proof)', () => {
    let large = 0;
    let small = 0;
    let switches = 0;
    for (const file of walk(PAGES)) {
      const text = readFileSync(file, 'utf-8');
      large += (text.match(/size="large"/g) ?? []).length;
      small += (text.match(/size="small"/g) ?? []).length;
      switches += (text.match(/<Switch[\s>/]/g) ?? []).length;
    }
    // The mechanism must see SOMETHING (the codebase certainly uses sizes);
    // a scanner that reports zeros is broken, not clean.
    expect(large + small).toBeGreaterThan(0);
    expect(switches).toBeGreaterThan(0);
  });

  it('pages with an allowlist entry stay within it', () => {
    const violations: string[] = [];
    for (const file of walk(PAGES)) {
      const rel = path.relative(PAGES, file);
      const entry = ALLOWLIST[rel];
      if (!entry) continue; // content fills at the wait point
      const text = readFileSync(file, 'utf-8');
      const large = (text.match(/size="large"/g) ?? []).length;
      const small = (text.match(/size="small"/g) ?? []).length;
      if (large > entry.large) violations.push(`${rel}: size=large ${large} > ${entry.large}`);
      if (small > entry.small) violations.push(`${rel}: size=small ${small} > ${entry.small}`);
    }
    expect(violations).toEqual([]);
  });

  it('Switch usage never exceeds the per-page allowlist (boolean-domain rule)', () => {
    const violations: string[] = [];
    for (const file of walk(PAGES)) {
      const rel = path.relative(PAGES, file);
      const cap = SWITCH_ALLOWLIST[rel];
      if (cap === undefined) continue; // unfilled until the contract mirror
      const text = readFileSync(file, 'utf-8');
      const switches = (text.match(/<Switch[\s>/]/g) ?? []).length;
      if (switches > cap) violations.push(`${rel}: Switch ${switches} > ${cap}`);
    }
    expect(violations).toEqual([]);
  });
});
