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
      thresholds: {
        statements: 46,
        branches: 71,
        functions: 70,
        lines: 46,
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
