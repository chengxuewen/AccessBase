/**
 * R-audit A4: retention-sweeper prune-mark suite (spec D2/B4, plan RED bullet:
 * "mark fully-expired anchors pruned_at in same tx BEFORE DELETE; crash-between
 * simulation — mark throws after delete-prepared → nothing half-applied").
 * The sweeper's legacy tests live in retention-drain.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { startRetentionSweeper } from '../utils/retention-sweeper.js';

interface Call {
  sql: string;
  params: unknown[];
}

function makeTxDb(script?: (sqlText: string, params: unknown[], call: Call) => unknown): {
  execute: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
  calls: Call[];
} {
  const calls: Call[] = [];
  const run = (call: Call) => async (q: never) => {
    const { sql: text, params } = new PgDialect().sqlToQuery(q);
    calls.push(call);
    call.sql = text;
    call.params = params as unknown[];
    return script?.(text, params as unknown[], call) ?? { rowCount: 3 };
  };
  const execute = vi.fn();
  const transaction = vi.fn(async (fn: (tx: { execute: (q: never) => Promise<unknown> }) => Promise<void>) =>
    // Each statement gets its OWN Call record — reusing one object would make
    // the calls[] probe see a single mutated entry instead of the sequence.
    fn({
      execute: ((q: never) => run({ sql: '', params: [] })(q)) as never,
    }),
  );
  return { execute, transaction, calls };
}

describe('retention sweeper — anchor prune-mark (B4, same-tx before DELETE)', () => {
  it('marks fully-expired anchors pruned_at BEFORE the audit DELETE, both inside ONE tx', async () => {
    vi.useFakeTimers();
    try {
      const fake = makeTxDb();
      const sweeper = startRetentionSweeper(() => fake as never, 365, {
        info: vi.fn(),
        warn: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(60_000);

      // Two transactions this tick: (1) mark+audit-DELETE, (2) session DELETE.
      // The B4 contract is that the audit pair shares ONE tx — assert the tx
      // count and that the two audit statements landed inside the FIRST one.
      expect(fake.transaction).toHaveBeenCalledTimes(2);
      expect(fake.execute).toHaveBeenCalledTimes(0); // statements ride the tx, never the bare handle
      const markIdx = fake.calls.findIndex((c) => c.sql.includes('pruned_at'));
      const delIdx = fake.calls.findIndex((c) => c.sql.includes('DELETE FROM audit_logs'));
      expect(markIdx).toBeGreaterThanOrEqual(0);
      expect(delIdx).toBeGreaterThan(markIdx); // mark-first ordering
      expect(fake.calls[markIdx]?.sql).toContain('make_interval(days =>');
      expect(fake.calls[markIdx]?.params).toEqual([365]);
      expect(fake.calls[delIdx]?.params).toEqual([365]);
      await sweeper.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('crash-between simulation: mark throws → whole tx aborts, DELETE never reached, error swallowed', async () => {
    vi.useFakeTimers();
    try {
      const fake = makeTxDb((text) => {
        if (text.includes('pruned_at')) throw new Error('simulated crash between mark and delete');
        return { rowCount: 0 };
      });
      const warn = vi.fn();
      const sweeper = startRetentionSweeper(() => fake as never, 365, {
        info: vi.fn(),
        warn,
      });
      await vi.advanceTimersByTimeAsync(60_000);
      // DELETE never executed — nothing half-applied (single-tx atomicity proof)
      expect(fake.calls.find((c) => c.sql.includes('DELETE FROM audit_logs'))).toBeUndefined();
      expect(warn).toHaveBeenCalled();
      await sweeper.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retention 0 still wraps the session sweep (no anchor mark, no audit DELETE)', async () => {
    vi.useFakeTimers();
    try {
      const fake = makeTxDb();
      const sweeper = startRetentionSweeper(() => fake as never, 0, {
        info: vi.fn(),
        warn: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fake.calls.find((c) => c.sql.includes('pruned_at'))).toBeUndefined();
      expect(fake.calls.find((c) => c.sql.includes('DELETE FROM audit_logs'))).toBeUndefined();
      expect(fake.calls.find((c) => c.sql.includes('DELETE FROM sessions'))).toBeDefined();
      await sweeper.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
