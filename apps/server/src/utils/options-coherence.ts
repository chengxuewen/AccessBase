/**
 * R-A cross-node options coherence (multi-node correctness batch).
 *
 * OptionsManager holds a per-process cache of the options table. On a write,
 * the manager announces through setOptionsPublishHook; this module registers
 * that hook to publish on channel `ab:options:invalidate` and subscribes so
 * every OTHER node drops its local copy via invalidate({fromRemote:true}) —
 * no republish loop. Redis absent / subscribe failure / mocked identity
 * => silent single-node mode (per-process cache stays, bounded staleness by
 * cache-until-write semantics) — never a boot failure (K-T4 brick rule).
 * Pattern template: cache-coherence.ts (Q2c permission-cache).
 */
import { getRedis } from './redis.js';
import type { RedisLike } from '@accessbase/identity';

const CHANNEL = 'ab:options:invalidate';

export interface CoherenceHandle {
  teardown: () => Promise<void>;
}

type RedisLikeWithPub = RedisLike & {
  publish?: (channel: string, message: string) => Promise<unknown>;
  duplicate?: () => unknown;
};

export async function setupOptionsCoherence(log: {
  info: (o: unknown, m: string) => void;
  warn: (o: unknown, m: string) => void;
}): Promise<CoherenceHandle> {
  const noop: CoherenceHandle = { teardown: async () => undefined };
  let setHook: ((h: (() => void) | undefined) => void) | undefined;
  try {
    // NOTE: vi.mock proxies THROW on undeclared-export access (PIT-082) — the
    // reads themselves must sit inside the try.
    const mod = (await import('@accessbase/identity')) as unknown as Record<string, unknown>;
    setHook = mod['setOptionsPublishHook'] as typeof setHook;
  } catch {
    return noop;
  }
  if (typeof setHook !== 'function') return noop; // mocked lane

  const redis = await getRedis();
  if (!redis) return noop;
  const client = redis as RedisLikeWithPub;
  if (typeof client.publish !== 'function' || typeof client.duplicate !== 'function') return noop;

  setHook(() => {
    void client.publish?.(CHANNEL, 'invalidate').catch(() => undefined);
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
    log.warn({ err }, 'options coherence: subscribe failed — single-node mode');
    setHook(undefined);
    return noop;
  }
  sub.on('message', (_ch, _msg) => {
    // Lazy import avoids the options.ts <-> utils cycle at module load; the
    // singleton already exists by the time a message can arrive (boot order:
    // routes registered before this wiring runs).
    void import('../routes/options.js')
      .then(({ getOptionsManager }) => getOptionsManager().invalidate({ fromRemote: true }))
      .catch(() => undefined);
  });
  log.info({}, 'options coherence: redis pub/sub active (ab:options:invalidate)');
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
