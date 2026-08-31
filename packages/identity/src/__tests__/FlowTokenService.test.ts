import { describe, it, expect, vi } from 'vitest';

// Mock logging
vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { FlowTokenService } from '../services/FlowTokenService.js';
import type { RedisLike } from '../services/redis.js';

/** Minimal redis double recording every call (for asserted interactions). */
function makeMockRedis() {
  const kv = new Map<string, string>();
  const calls: Array<{ cmd: string; key: string }> = [];
  const redis: RedisLike = {
    get: vi.fn(async (key: string) => {
      calls.push({ cmd: 'get', key });
      return kv.get(key) ?? null;
    }),
    set: vi.fn(async (key: string, value: string) => {
      calls.push({ cmd: 'set', key });
      kv.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      calls.push({ cmd: 'del', key });
      kv.delete(key);
    }),
  };
  return { redis, kv, calls };
}

describe('FlowTokenService', () => {
  describe('in-memory fallback (no redis)', () => {
    it('issues + consumes happy path', async () => {
      const svc = new FlowTokenService();
      const token = await svc.issue('mfa-challenge', { userId: 'u-1' });

      expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes hex

      const payload = await svc.consume<{ userId: string }>(token, 'mfa-challenge');
      expect(payload).toEqual({ userId: 'u-1' });
    });

    it('second consume returns null (single-use)', async () => {
      const svc = new FlowTokenService();
      const token = await svc.issue('mfa-challenge', { userId: 'u-1' });

      await svc.consume(token, 'mfa-challenge');
      const second = await svc.consume(token, 'mfa-challenge');

      expect(second).toBeNull();
    });

    it('wrong purpose returns null AND consumes the token', async () => {
      const svc = new FlowTokenService();
      const token = await svc.issue('mfa-challenge', { userId: 'u-1' });

      const wrong = await svc.consume(token, 'other-purpose');
      expect(wrong).toBeNull();

      // Token must be burned even on purpose mismatch
      const replay = await svc.consume(token, 'mfa-challenge');
      expect(replay).toBeNull();
    });

    it('expired token returns null', async () => {
      const svc = new FlowTokenService();
      const token = await svc.issue('mfa-challenge', { userId: 'u-1' }, -1); // already expired

      const payload = await svc.consume(token, 'mfa-challenge');
      expect(payload).toBeNull();
    });

    it('payload roundtrip preserves types (nested objects, numbers, booleans)', async () => {
      const svc = new FlowTokenService();
      const payload = {
        userId: 'u-1',
        attempt: 2,
        trusted: false,
        nested: { codes: ['a', 'b'], meta: { ok: true, ratio: 0.5 } },
      };
      const token = await svc.issue('mfa-challenge', payload);

      const consumed = await svc.consume<typeof payload>(token, 'mfa-challenge');
      expect(consumed).toEqual(payload);
    });

    it('issue with explicit ttl is honored (token alive before expiry)', async () => {
      const svc = new FlowTokenService();
      const token = await svc.issue('p', { x: 1 }, 60);
      expect(await svc.consume(token, 'p')).toEqual({ x: 1 });
    });

    it('consume of unknown token returns null', async () => {
      const svc = new FlowTokenService();
      expect(await svc.consume('deadbeef', 'p')).toBeNull();
    });
  });

  describe('redis-backed', () => {
    it('issue writes to redis and consume reads via atomic path', async () => {
      const { redis, kv, calls } = makeMockRedis();
      const svc = new FlowTokenService(redis);
      const token = await svc.issue('mfa-challenge', { userId: 'u-1' }, 300);

      expect(kv.has(`flow:${token}`)).toBe(true);
      expect(calls.some((c) => c.cmd === 'set')).toBe(true);

      const payload = await svc.consume<{ userId: string }>(token, 'mfa-challenge');
      expect(payload).toEqual({ userId: 'u-1' });
      // issue=set, then consume=get+del (GETDEL not on RedisLike surface)
      expect(calls.filter((c) => c.key === `flow:${token}`).map((c) => c.cmd)).toEqual([
        'set',
        'get',
        'del',
      ]);
    });

    it('consume deletes the key in redis (second consume null)', async () => {
      const { redis, kv } = makeMockRedis();
      const svc = new FlowTokenService(redis);
      const token = await svc.issue('mfa-challenge', { userId: 'u-1' });

      await svc.consume(token, 'mfa-challenge');
      expect(kv.has(`flow:${token}`)).toBe(false);
      expect(await svc.consume(token, 'mfa-challenge')).toBeNull();
    });

    it('falls back to in-memory when redis errors, still functional', async () => {
      const broken: RedisLike = {
        get: async () => {
          throw new Error('ECONNREFUSED');
        },
        set: async () => {
          throw new Error('ECONNREFUSED');
        },
        del: async () => {
          throw new Error('ECONNREFUSED');
        },
      };
      const svc = new FlowTokenService(broken);
      const token = await svc.issue('mfa-challenge', { userId: 'u-1' });

      const payload = await svc.consume<{ userId: string }>(token, 'mfa-challenge');
      expect(payload).toEqual({ userId: 'u-1' });
    });
  });
});
