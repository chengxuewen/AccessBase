import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      all: true,
      // M3: un-prefixed 'node_modules/'/'dist/' missed the pnpm .pnpm layout -> bogus
      // 55.46% denominator; whitelist src-only so untouched files count as 0% (the floor).
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts', '**/*.spec.ts'],
      include: [
        'packages/*/src/**/*.ts',
        'apps/*/src/**/*.{ts,tsx}',
        'apps/admin-ui/src/**/*.{ts,tsx}',
      ],
      // ponytail: floors = measured(51.01/76.19/75.05/51.01) - 5, 2026-09-20 PG-down.
      // Ratchet toward 80 as suites grow; raise ~5pt per batch, never lower.
      //
      // R3-B tiered gates landed 2026-11-09 (S4 first cut). The aggregate below was letting
      // apps/admin-ui sit at 2.26% statements behind a 54.82% project total - the precise
      // failure mode the ruling exists to remove. Per-area floors are set ONE NOTCH under what
      // vitest itself reports for that glob (its counting, read off vitest's own
      // `does not meet "<glob>" threshold (x%)` line - deliberately not the numbers from
      // scripts/coverage-by-area.mjs, which corrects v8's placeholder inflation and would put
      // the floor out of reach of the gate it is supposed to match). Each floor carries its asOf
      // date; re-measure before raising, never edit from memory (R2-X1).
      thresholds: {
        statements: 46,
        branches: 71,
        functions: 70,
        lines: 46,
        // asOf 2026-11-09: vitest's own reading is 88.11 statements over 78 files (the demo run
        // that raised this floor to 95 printed it); scripts/coverage-by-area.mjs computes 88.12
        // for the same area - a 0.01 rounding-path difference, which is exactly why floors come
        // from the gate's output and not from the measuring script.
        'apps/server/src/**': { statements: 87, branches: 77, functions: 83 },
        // asOf 2026-11-09: 80.08 / 85.15 / 84.64 over 37 files
        'packages/identity/src/**': { statements: 79, branches: 84, functions: 83 },
        // asOf 2026-11-09: 89.25 / 81.65 / 96.00 over 5 files (highest area; small denominator,
        // so the floor is a floor and not an achievement claim)
        'packages/audit/src/**': { statements: 88, branches: 80, functions: 95 },
        // asOf 2026-11-09: measured 2.26 statements / 43.85 branches / 19.57 functions across 75
        // files and 8754 statement sites. This floor is deliberately honest-low: its job is to
        // make the frontend's gap visible as its own number instead of averaging it away, and to
        // forbid regression - NOT to certify the area. Next raise: statements >= 10, one quality
        // batch, per R3-B's "per-area floors with asOf dates".
        'apps/admin-ui/src/**': { statements: 2, branches: 43, functions: 19 },
        // packages/logging is intentionally NOT floored: 15 passing tests yet 0% statements
        // (blind spot registered as E21). A floor of 0 would launder the gap into a pass.
      },
    },
    include: ['packages/**/*.{test,spec}.ts', 'apps/**/*.{test,spec}.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '.refinfo/**',
      '.opencode/**',
      '.agents/**',
    ],
  },
});
