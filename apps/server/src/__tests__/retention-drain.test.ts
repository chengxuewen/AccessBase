import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  resolveRetentionDays,
  startRetentionSweeper,
  SESSION_GRACE_DAYS,
} from '../utils/retention-sweeper.js';
import { setDraining, isDraining, _resetDrainingForTest } from '../utils/drain.js';

describe('retention sweeper (Q2a E)', () => {
  it('resolveRetentionDays: env wins, garbage/0/negative disable, default 365', () => {
    expect(resolveRetentionDays('30', 365)).toBe(30);
    expect(resolveRetentionDays(undefined, 90)).toBe(90);
    expect(resolveRetentionDays(undefined, undefined)).toBe(365);
    expect(resolveRetentionDays('abc', 365)).toBe(0);
    expect(resolveRetentionDays('0', 365)).toBe(0);
    expect(resolveRetentionDays('', 365)).toBe(365); // '' = unset (falls back), never an accidental disable
  });

  it('pool is lazy (no makeDb at start); first tick sweeps both tables with BOUND params', async () => {
    vi.useFakeTimers();
    try {
      const execute = vi.fn(async () => ({ rowCount: 2 }));
      const makeDb = vi.fn(() => ({ execute }) as never);
      const log = { info: vi.fn(), warn: vi.fn() };
      const sweeper = startRetentionSweeper(makeDb, 45, log);
      expect(makeDb).not.toHaveBeenCalled(); // health-pool premise: nothing dials at registration
      await vi.advanceTimersByTimeAsync(60_000);
      expect(makeDb).toHaveBeenCalledTimes(1);
      // retention>0 → audit DELETE + session DELETE
      expect(execute).toHaveBeenCalledTimes(2);
      const first = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0] as never);
      expect(first.sql).toContain('make_interval');
      expect(first.params).toEqual([45]);
      const second = new PgDialect().sqlToQuery(execute.mock.calls[1]?.[0] as never);
      expect(second.sql).toContain('sessions');
      expect(second.params).toEqual([SESSION_GRACE_DAYS]);
      await sweeper.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retention 0 disables the audit pass (sessions still swept)', async () => {
    vi.useFakeTimers();
    try {
      const execute = vi.fn(async () => ({ rowCount: 0 }));
      const makeDb = vi.fn(() => ({ execute }) as never);
      const sweeper = startRetentionSweeper(makeDb, 0, { info: vi.fn(), warn: vi.fn() });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0] as never).sql).toContain('sessions');
      await sweeper.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sweep errors are swallowed (logged, next pass continues)', async () => {
    vi.useFakeTimers();
    try {
      const execute = vi.fn(async () => {
        throw new Error('db down');
      });
      const warn = vi.fn();
      const sweeper = startRetentionSweeper(() => ({ execute }) as never, 45, {
        info: vi.fn(),
        warn,
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(warn).toHaveBeenCalled();
      await expect(sweeper.stop()).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('drain flag (Q2a F)', () => {
  it('setDraining is one-way until the test reset seam', () => {
    _resetDrainingForTest();
    expect(isDraining()).toBe(false);
    setDraining();
    expect(isDraining()).toBe(true);
    _resetDrainingForTest();
    expect(isDraining()).toBe(false);
  });
});
