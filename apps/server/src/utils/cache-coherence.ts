/**
 * Q2c cross-node permission-cache coherence (gap-audit D5/12).
 *
 * The 30s per-process cache (permission-cache.ts, zero-dep leaf) now also
 * announces through Redis: writers publish `perm:{tenant}|{user}` on channel
 * `ab:perm:invalidate`; every node subscribes and drops its local copy with
 * fromRemote (no republish loop). Redis absent/unmocked ⇒ silent single-node
 * mode (30s TTL remains the backstop) — never a boot failure (K-T4 brick rule).
 * Mock-safety: identity is resolved via dynamic property access so partial
 * vi.mock factories do not throw at import link.
 */
import { getRedis } from './redis.js';
import type { RedisLike } from '@accessbase/identity';

const CHANNEL = 'ab:perm:invalidate';

interface InvalidateFn {
  (tenantId?: string, userId?: string, opts?: { fromRemote?: boolean }): void;
}

export interface CoherenceHandle {
  teardown: () => Promise<void>;
}

type RedisLikeWithPub = RedisLike & {
  publish?: (channel: string, message: string) => Promise<unknown>;
  duplicate?: () => unknown;
};

export async function setupCacheCoherence(log: {
  info: (o: unknown, m: string) => void;
  warn: (o: unknown, m: string) => void;
}): Promise<CoherenceHandle> {
  const noop: CoherenceHandle = { teardown: async () => undefined };
  let setHook: ((h: ((t?: string, u?: string) => void) | undefined) => void) | undefined;
  let invalidate: InvalidateFn | undefined;
  try {
    // NOTE: vi.mock proxies THROW on undeclared-export access (not undefined) —
    // the reads themselves must sit inside the try (users.test collection lesson).
    const mod = (await import('@accessbase/identity')) as unknown as Record<string, unknown>;
    setHook = mod['setPermissionCachePublishHook'] as typeof setHook;
    invalidate = mod['invalidatePermissionCache'] as typeof invalidate;
  } catch {
    return noop;
  }
  if (typeof setHook !== 'function' || typeof invalidate !== 'function') return noop; // mocked lane

  const redis = await getRedis();
  if (!redis) return noop;
  const client = redis as RedisLikeWithPub;
  if (typeof client.publish !== 'function' || typeof client.duplicate !== 'function') return noop;

  setHook((t, u) => {
    void client.publish?.(CHANNEL, `${t ?? ''}|${u ?? ''}`).catch(() => undefined);
  });
  const sub = client.duplicate() as {
    subscribe: (c: string) => Promise<unknown>;
    unsubscribe: (c: string) => Promise<unknown>;
    on: (ev: 'message', cb: (ch: string, msg: string) => void) => void;
    quit?: () => Promise<unknown>;
  };
  try {
    await sub.subscribe(CHANNEL);
  } catch (err) {
    log.warn({ err }, 'cache coherence: subscribe failed — single-node mode');
    setHook(undefined);
    return noop;
  }
  sub.on('message', (_ch, msg) => {
    const [t = '', u = ''] = String(msg).split('|');
    invalidate(t || undefined, u || undefined, { fromRemote: true });
  });
  log.info({}, 'cache coherence: redis pub/sub active (ab:perm:invalidate)');
  return {
    teardown: async () => {
      setHook(undefined);
      try {
        await sub.unsubscribe(CHANNEL);
        await sub.quit?.();
      } catch {
        // best-effort teardown
      }
    },
  };
}
