/**
 * Shared lazy ioredis singleton for @accessbase/identity consumers.
 *
 * Design: thin `RedisLike` structural type (get/set/del) is what
 * SessionManager and FlowTokenService actually need — tests substitute an
 * in-memory implementation, production gets the ioredis client from
 * `getRedisClient()`. The client is lazy: created on first call, reconnects
 * suppressed in tests (NODE_ENV==='test').
 */
import Redis from 'ioredis';

/** Structural subset used by identity services. Keep tiny on purpose. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (!client) {
    client = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      // ponytail: no reconnect in tests — callers handle failure paths
      retryStrategy: (times: number) => (process.env['NODE_ENV'] === 'test' ? null : Math.min(times * 200, 5000)),
    });
  }
  return client;
}
