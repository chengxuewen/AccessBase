import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.REDIS_URL = 'redis://localhost:6379';

const { getRedis } = await import('../utils/redis.js');
type Redis = Awaited<ReturnType<typeof getRedis>>;

describe('redis wiring (P0 infra consolidation)', () => {
  it('getRedis caches the client and returns the same instance', async () => {
    const a = await getRedis();
    const b = await getRedis();
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it('rate-limit config includes redis storage when available', () => {
    // Static regression lock (route-guard.test.ts precedent)
    const src = readFileSync(resolve(__dirname, '../app.ts'), 'utf-8');
    expect(src).toMatch(/rateLimit[\s\S]{0,200}redis/i);
  });
  
  it('rate-limit fails open on redis outage (skipOnError)', () => {
    // Static regression lock: RedisStore incr rethrows by default (skipOnError:false)
    // → a redis outage would 500 every request. Must stay fail-open.
    const src = readFileSync(resolve(__dirname, '../app.ts'), 'utf-8');
    expect(src).toMatch(/rateLimit[\s\S]{0,400}skipOnError:\s*true/);
  });

  it('health ready reports redis status truthfully', () => {
    // Static regression lock: stubbed value removed in favor of real ping
    const src = readFileSync(resolve(__dirname, '../routes/health.ts'), 'utf-8');
    expect(src).not.toMatch(/not_configured/);
  });

  it('auth SessionManager receives a redis client', () => {
    // Static regression lock: session cache is an optimization that only
    // works when the manager is constructed with a client
    const src = readFileSync(resolve(__dirname, '../routes/auth.ts'), 'utf-8');
    expect(src).toMatch(/new SessionManager\([^)]*,\s*await getRedis\(\)/);
  });
});

// Compile-time guard: Redis here must be ioredis' client (has ping), not the
// structural RedisLike subset (get/set/del only).
import type { Redis as IORedis } from 'ioredis';
const _typeGuard: IORedis | null = null as unknown as Redis;
void _typeGuard;
