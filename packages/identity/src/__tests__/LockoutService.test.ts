import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { LockoutService } from '../services/LockoutService.js';

describe('LockoutService', () => {
  let svc: LockoutService;

  beforeEach(() => {
    svc = new LockoutService({ maxFailures: 5, windowSeconds: 900 });
  });

  it('does not lock below threshold', async () => {
    for (let i = 0; i < 4; i++) await svc.recordFailure('a@x.tld');
    expect(await svc.isLocked('a@x.tld')).toBe(false);
  });

  it('locks at threshold (5 failures)', async () => {
    for (let i = 0; i < 5; i++) await svc.recordFailure('a@x.tld');
    expect(await svc.isLocked('a@x.tld')).toBe(true);
  });

  it('clear() resets failures so login succeeds again', async () => {
    for (let i = 0; i < 5; i++) await svc.recordFailure('a@x.tld');
    await svc.clear('a@x.tld');
    expect(await svc.isLocked('a@x.tld')).toBe(false);
  });

  it('failures expire after the window (fake timers)', async () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 5; i++) await svc.recordFailure('win@x.tld');
      expect(await svc.isLocked('win@x.tld')).toBe(true);
      vi.advanceTimersByTime(901_000);
      expect(await svc.isLocked('win@x.tld')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('different identifiers are independent', async () => {
    for (let i = 0; i < 5; i++) await svc.recordFailure('one@x.tld');
    expect(await svc.isLocked('one@x.tld')).toBe(true);
    expect(await svc.isLocked('two@x.tld')).toBe(false);
  });

  it('ip blacklist: add then check', async () => {
    expect(await svc.isIpBlacklisted('9.9.9.9')).toBe(false);
    await svc.blacklistIp('9.9.9.9');
    expect(await svc.isIpBlacklisted('9.9.9.9')).toBe(true);
    expect(await svc.isIpBlacklisted('8.8.8.8')).toBe(false);
  });

  it('ip blacklist respects ttl expiry (fake timers)', async () => {
    vi.useFakeTimers();
    try {
      await svc.blacklistIp('7.7.7.7', 60);
      expect(await svc.isIpBlacklisted('7.7.7.7')).toBe(true);
      vi.advanceTimersByTime(61_000);
      expect(await svc.isIpBlacklisted('7.7.7.7')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses redis when provided', async () => {
    const store = new Map<string, string>();
    const redis = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
      del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    };
    const rsvc = new LockoutService({ redis });
    for (let i = 0; i < 5; i++) await rsvc.recordFailure('redis@x.tld');
    expect(redis.set).toHaveBeenLastCalledWith('lockout:redis@x.tld', '5', 'EX', 900);
    expect(await rsvc.isLocked('redis@x.tld')).toBe(true);
  });
});
