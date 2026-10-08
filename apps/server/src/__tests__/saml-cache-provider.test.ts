/**
 * saml-cache-provider unit tests (logout-coherence §3.6 — R6 PRECONDITION).
 *
 * Seam: ../utils/redis.js getRedis (options-coherence.test.ts precedent).
 * The provider is the Redis-backed node-saml CacheProvider that lets a
 * LogoutRequest ID generated on one request (or one node) be found by the
 * validator running on a different per-request SamlProvider instance.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type RedisState = { client: Record<string, ReturnType<typeof vi.fn>> | null };
const redisState: RedisState = {
  client: {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
  },
};

vi.mock('../utils/redis.js', () => ({
  getRedis: async () => redisState.client,
}));

vi.mock('@accessbase/logging', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { logger } = await import('@accessbase/logging');
const { buildSamlCacheProvider, SAML_REQUEST_TTL_MS } = await import(
  '../utils/saml-cache-provider.js'
);

beforeEach(() => {
  vi.clearAllMocks();
  redisState.client = {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
  };
});

describe('buildSamlCacheProvider (Redis present)', () => {
  it('returns a provider and saveAsync writes ab:saml:req:<id> with EX ttl (default + grace)', async () => {
    const provider = await buildSamlCacheProvider();
    expect(provider).toBeDefined();

    const item = await provider?.saveAsync('_req42', '2026-10-08T00:00:00Z');

    expect(redisState.client?.['set']).toHaveBeenCalledWith(
      'ab:saml:req:_req42',
      '2026-10-08T00:00:00Z',
      'EX',
      Math.ceil(SAML_REQUEST_TTL_MS / 1000),
    );
    // node-saml reads the CacheItem back (types.d.ts:22-25 shape)
    expect(item).not.toBeNull();
    expect(item?.value).toBe('2026-10-08T00:00:00Z');
    expect(typeof item?.createdAt).toBe('number');
  });

  it('getAsync reads the prefixed key through; miss returns null', async () => {
    const provider = await buildSamlCacheProvider();
    redisState.client?.['get'].mockResolvedValueOnce('instant-value');

    await expect(provider?.getAsync('_req42')).resolves.toBe('instant-value');
    expect(redisState.client?.['get']).toHaveBeenCalledWith('ab:saml:req:_req42');

    await expect(provider?.getAsync('_missing')).resolves.toBeNull();
  });

  it('removeAsync deletes the key and echoes it back', async () => {
    const provider = await buildSamlCacheProvider();

    await expect(provider?.removeAsync('_req42')).resolves.toBe('_req42');
    expect(redisState.client?.['del']).toHaveBeenCalledWith('ab:saml:req:_req42');
  });

  it('removeAsync(null) is a no-op (node-saml passes a null InResponseTo on some error paths)', async () => {
    const provider = await buildSamlCacheProvider();

    await expect(provider?.removeAsync(null)).resolves.toBeNull();
    expect(redisState.client?.['del']).not.toHaveBeenCalled();
  });
});

describe('buildSamlCacheProvider (Redis absent — honest single-node fallback)', () => {
  it('returns undefined so node-saml keeps its default in-memory cache, and warns exactly once', async () => {
    redisState.client = null;
    vi.resetModules();
    const fresh = await import('../utils/saml-cache-provider.js');

    const a = await fresh.buildSamlCacheProvider();
    const b = await fresh.buildSamlCacheProvider();

    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String((logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[1])).toMatch(/in-memory/i);
  });
});
