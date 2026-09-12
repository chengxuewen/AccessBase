import { getRedisClient } from '@accessbase/identity';
import type { Redis } from 'ioredis';

let cached: Redis | null | undefined;

/**
 * Process-wide Redis singleton; resolves to the ioredis client (has ping)
 * rather than the RedisLike subset. getRedisClient() is synchronous and
 * practically never throws — the try/catch stays as dead-code tolerance
 * so callers can rely on "never rejects" (null instead).
 */
export async function getRedis(): Promise<Redis | null> {
  if (cached !== undefined) return cached;
  try {
    cached = getRedisClient();
  } catch {
    cached = null;
  }
  return cached;
}
