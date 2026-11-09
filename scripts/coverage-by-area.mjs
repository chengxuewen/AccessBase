#!/usr/bin/env node
/**
 * coverage-by-area - the measurement behind vitest.config.ts's per-area floors.
 *
 * Why this exists: one averaged percentage let apps/admin-ui sit at ~2% while the aggregate
 * read 54.82%, which is the exact failure mode R3-B (tiered gates) was ruled to remove. And a
 * floor without a re-measure command rots into a claim, so the config points here instead of
 * quoting numbers as truth.
 *
 * Run: node scripts/coverage-by-area.mjs           (after `pnpm test:coverage`)
 *      node scripts/coverage-by-area.mjs --json    (machine-readable, for CI comparison)
 *
 * Reads coverage/coverage-final.json (v8 provider output, 232 entries as of 2026-11-09).
 * Statement counts come from statementMap/s, branches from branchMap/b (each location is one
 * branch site with multiple outcomes, all counted), functions from fnMap/f - the same three
 * dimensions the thresholds are set on.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'coverage', 'coverage-final.json');

// Ordered longest-prefix wins, so a package is never counted into a broader area.
const AREAS = [
  { prefix: 'apps/admin-ui/src', label: 'apps/admin-ui', tiered: true },
  { prefix: 'apps/server/src', label: 'apps/server', tiered: true },
  { prefix: 'packages/identity/src', label: 'packages/identity', tiered: true },
  { prefix: 'packages/audit/src', label: 'packages/audit', tiered: true },
  { prefix: 'packages/logging/src', label: 'packages/logging', tiered: true },
  // declared-but-unwired or type-only surfaces: reported, never floored (flooring a zero here
  // would legalise the blind spot instead of exposing it)
  { prefix: 'packages/types/src', label: 'packages/types (type-only)', tiered: false },
  { prefix: 'packages/i18n/src', label: 'packages/i18n (S3 disposal)', tiered: false },
  { prefix: 'packages/health/src', label: 'packages/health (S3 disposal)', tiered: false },
  { prefix: 'packages/admin/src', label: 'packages/admin (S3 disposal)', tiered: false },
  { prefix: 'packages/migration/src', label: 'packages/migration (tooling host)', tiered: false },
];

const pct = (hit, total) => (total === 0 ? 0 : Math.round((10000 * hit) / total) / 100);

/**
 * Per-file measurement, with one correction that matters.
 *
 * The v8 provider emits PLACEHOLDERS for files it never loaded: a `.d.ts` or an untouched
 * source file arrives with `st 0/103` yet `br 1/1, fn 1/1`. Taken literally, an entirely
 * untested file contributes a fully-covered branch and function - which is how the project-wide
 * branch/function percentages read high while whole packages sit at 0% statements. Two rules
 * follow, both per file:
 *   1. no statement sites at all (type-only file)  -> contributes nothing to any dimension;
 *   2. statement sites exist but none executed     -> branch/function hits are placeholders too,
 *                                                     so count the totals and zero the hits.
 * CAVEAT for anyone setting thresholds from this output: the enforcement gate is vitest itself,
 * which does NOT apply these corrections. Use this script to locate blind spots; read the floor
 * numbers off vitest's own `ERROR: Coverage for ... does not meet "<glob>" threshold (<x>%)`
 * line, so the floor and the gate never diverge in definition.
 */
function measure(d) {
  const s = d.statementMap ?? {};
  const f = d.fnMap ?? {};
  const b = d.branchMap ?? {};
  const counts = { st: [0, 0], br: [0, 0], fn: [0, 0] };
  for (const k of Object.keys(s)) {
    counts.st[1]++;
    if ((d.s?.[k] ?? 0) > 0) counts.st[0]++;
  }
  if (counts.st[1] === 0) return { st: [0, 0], br: [0, 0], fn: [0, 0] }; // rule 1
  for (const k of Object.keys(f)) {
    counts.fn[1]++;
    if ((d.f?.[k] ?? 0) > 0) counts.fn[0]++;
  }
  for (const k of Object.keys(b)) {
    for (const v of d.b?.[k] ?? []) {
      counts.br[1]++;
      if (v > 0) counts.br[0]++;
    }
  }
  if (counts.st[0] === 0) {
    counts.br[0] = 0; // rule 2
    counts.fn[0] = 0;
  }
  return counts;
}

if (!existsSync(FILE)) {
  console.error(`missing ${path.relative(ROOT, FILE)} - run \`pnpm test:coverage\` first`);
  process.exit(2);
}

const cov = JSON.parse(readFileSync(FILE, 'utf8'));
const table = [];
const claimed = new Set();
let unassigned = 0;
for (const area of AREAS) {
  const acc = { st: [0, 0], br: [0, 0], fn: [0, 0] };
  let files = 0;
  for (const [absPath, data] of Object.entries(cov)) {
    const rel = path.relative(ROOT, absPath).split(path.sep).join('/');
    // prefix match on a directory boundary; the first matching area claims the file, so no
    // file is ever counted twice (which would inflate the denominator of two floors at once)
    if (!rel.startsWith(area.prefix + '/') || claimed.has(rel)) continue;
    claimed.add(rel);
    const m = measure(data);
    for (const key of ['st', 'br', 'fn']) {
      acc[key][0] += m[key][0];
      acc[key][1] += m[key][1];
    }
    files++;
  }
  if (files === 0) continue;
  if (!area.tiered) unassigned += files;
  table.push({
    label: area.label,
    tiered: area.tiered,
    files,
    statements: pct(acc.st[0], acc.st[1]),
    branches: pct(acc.br[0], acc.br[1]),
    functions: pct(acc.fn[0], acc.fn[1]),
    statementSites: acc.st[1],
  });
}

const missed = Object.keys(cov).length - claimed.size;
const json = process.argv.includes('--json');
if (json) {
  console.log(JSON.stringify(table, null, 2));
} else {
  console.log(`area                                  files  stmts%  branch%  funcs%   sites`);
  for (const r of table) {
    console.log(
      `${r.label.padEnd(36)}${String(r.files).padStart(5)}  ${String(r.statements).padStart(6)}  ` +
        `${String(r.branches).padStart(7)}  ${String(r.functions).padStart(6)}  ${String(r.statementSites).padStart(7)}`,
    );
  }
  console.log(`\nreported-but-not-floored (type-only / S3 disposal candidates): ${unassigned} files`);
  console.log(`files outside every declared area: ${missed} (non-zero means AREAS below drifted from the tree)`);
  console.log('floors in vitest.config.ts carry asOf dates; re-measure with this script, never edit from memory.');
}
process.exit(missed === 0 ? 0 : 1);
