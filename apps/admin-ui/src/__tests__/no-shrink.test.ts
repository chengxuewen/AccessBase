/**
 * W0.5 — no-shrink lock (rev.5 upgraded shape: NAME-set + payload ledger).
 *
 * Count-based locks are rename-blind; this locks the testid NAME SET
 * bidirectionally. Deletions require a LEDGER ENTRY whose ref points at a
 * real, non-empty line in a real ledger file (grep-verified — the audit is
 * payload, not a comment). testid→file map catches silent moves.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../..'); // repo root
const SRC = path.resolve(__dirname, '..');
const E2E = path.resolve(__dirname, '../../../../e2e'); // __tests__ → src → admin-ui → apps → root/e2e

/** FROZEN baseline (W0.5 core design): generated ONCE from the W0 census and
 * committed. NEVER derive it from a live scan at test time — a baseline that
 * tracks the codebase locks nothing. Extend deliberately; remove via ledger. */
const BASELINE_TESTIDS: ReadonlySet<string> = new Set(
  (readFileSync(path.join(__dirname, 'testid-baseline.txt'), 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))),
);

/** FROZEN e2e per-file test counts (same discipline). */
const E2E_BASELINE_COUNTS: ReadonlyMap<string, number> = new Map(
  (readFileSync(path.join(__dirname, 'e2e-counts.txt'), 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
    .map((l) => {
      const [file, n] = l.split(' ');
      return [file ?? '', Number(n)];
    })),
);

/** Ledger for intentional deletions: name → where the decision is recorded.
 * Empty today; the shape is the enforcement. */
const DELETED: Readonly<Record<string, string>> = {};

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      yield* walk(full);
    } else if (/\.(tsx|ts)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      yield full;
    }
  }
}

function collectTestids(): string[] {
  const ids = new Set<string>();
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf-8');
    for (const m of text.matchAll(/data-testid="([^"]+)"/g)) {
      ids.add(m[1] ?? '');
    }
  }
  return [...ids].filter(Boolean);
}

function collectE2eTestCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const spec of readdirSync(E2E)) {
    if (!spec.endsWith('.spec.ts')) continue;
    const text = readFileSync(path.join(E2E, spec), 'utf-8');
    const n = (text.match(/^\s*test\(/gm) ?? []).length;
    counts.set(spec, n);
  }
  return counts;
}

describe('no-shrink lock (W0.5)', () => {
  it('testid NAME-SET is exactly baseline ∪ deleted (bidirectional)', () => {
    const current = collectTestids();
    const expected = new Set(BASELINE_TESTIDS);
    for (const name of Object.keys(DELETED)) {
      expected.add(name); // deleted names remain "known" — via ledger
    }
    const added = current.filter((id) => !expected.has(id));
    const removed = [...expected].filter((id) => !current.includes(id) && !(id in DELETED));
    expect(
      { added, removed },
      'testid set changed — add to BASELINE_TESTIDS (new) or DELETED ledger (removed, with reason ref)',
    ).toEqual({ added: [], removed: [] });
  });

  it('every ledger entry references a real, non-empty ledger line', () => {
    for (const [name, ref] of Object.entries(DELETED)) {
      expect(ref.trim().length, `ledger ref for ${name} is empty`).toBeGreaterThan(0);
      const [file, pattern] = ref.split('#');
      const full = path.resolve(ROOT, file ?? '');
      expect(existsSync(full), `ledger file missing: ${ref}`).toBe(true);
      const text = readFileSync(full, 'utf-8');
      expect(text.includes(pattern ?? ''), `ledger pattern not found: ${ref}`).toBe(true);
    }
  });

  it('e2e per-file test counts never shrink', () => {
    const current = collectE2eTestCounts();
    const shrunk: string[] = [];
    for (const [spec, base] of E2E_BASELINE_COUNTS) {
      const now = current.get(spec);
      if (now === undefined) {
        shrunk.push(`${spec}: FILE DELETED (had ${base} tests)`);
      } else if (now < base) {
        shrunk.push(`${spec}: ${base} → ${now}`);
      }
    }
    expect(shrunk, 'e2e tests shrank — Never #3; deletions need a stated reason').toEqual([]);
  });

  it('i18n floors: parity + count ≥ 702', async () => {
    const zh = JSON.parse(
      readFileSync(path.join(SRC, 'i18n/locales/zh.json'), 'utf-8'),
    ) as Record<string, unknown>;
    const en = JSON.parse(
      readFileSync(path.join(SRC, 'i18n/locales/en.json'), 'utf-8'),
    ) as Record<string, unknown>;
    const flat = (o: Record<string, unknown>, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' && v !== null ? flat(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`],
      );
    const zhKeys = flat(zh);
    const enKeys = flat(en);
    expect(zhKeys.length, 'zh key floor (run-2 H-8: actual 702, not 474)').toBeGreaterThanOrEqual(
      702,
    );
    expect(new Set(zhKeys)).toEqual(new Set(enKeys));
  });
});
