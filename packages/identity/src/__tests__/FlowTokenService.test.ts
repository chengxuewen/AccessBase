import { describe, it, expect, vi } from 'vitest';

// Mock logging
vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import Redis from 'ioredis';
import { FlowTokenService } from '../services/FlowTokenService.js';
import type { RedisLike } from '../services/redis.js';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

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
    // ioredis 5 always exposes getdel — the double mirrors production shape.
    getdel: vi.fn(async (key: string) => {
      calls.push({ cmd: 'getdel', key });
      const v = kv.get(key) ?? null;
      kv.delete(key);
      return v;
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
      // issue=set, then consume=GETDEL — the atomic single-use burn (batch P W1-3)
      expect(calls.filter((c) => c.key === `flow:${token}`).map((c) => c.cmd)).toEqual([
        'set',
        'getdel',
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

    it('falls back to get+del when the server rejects GETDEL as unknown command', async () => {
      const { redis, kv, calls } = makeMockRedis();
      redis.getdel = vi.fn(async () => {
        throw new Error("ERR unknown command 'GETDEL'");
      });
      const svc = new FlowTokenService(redis);
      const token = await svc.issue('mfa-challenge', { userId: 'u-1' }, 300);
      const payload = await svc.consume<{ userId: string }>(token, 'mfa-challenge');
      // still functional via the legacy path, key burned
      expect(payload).toEqual({ userId: 'u-1' });
      expect(kv.has(`flow:${token}`)).toBe(false);
      expect(calls.map((c) => c.cmd)).toContain('get');
      expect(calls.map((c) => c.cmd)).toContain('del');
    });
  });

  // Live native redis: the GET→DEL race is only observable against a real
  // server. Runtime ctx.skip() when redis is down (identity tsconfig target
  // rejects top-level await, so no collect-time probe — H′ signal hygiene).
  describe('live redis atomic consume (W1-3 race lock)', () => {
    it('ten concurrent consumes of one token yield exactly one winner', async (ctx) => {
      const client = new Redis(REDIS_URL, {
        lazyConnect: true,
        retryStrategy: () => null,
        connectTimeout: 500,
        maxRetriesPerRequest: 1,
      });
      try {
        await client.connect();
      } catch {
        client.disconnect();
        ctx.skip();
        return;
      }
      try {
        const svc = new FlowTokenService(client);
        const token = await svc.issue('race-test', { userId: 'u-race' }, 60);
        const results = await Promise.all(
          Array.from({ length: 10 }, () => svc.consume(token, 'race-test')),
        );
        expect(results.filter((r) => r !== null)).toHaveLength(1);
        expect(await client.get(`flow:${token}`)).toBeNull();
      } finally {
        client.disconnect();
      }
    });
  });
});
