/**
 * Redis-backed node-saml CacheProvider (logout-coherence §3.6 — A2/R6
 * PRECONDITION, spec 2026-10-08-logout-coherence-design).
 *
 * WHY: saml.ts buildProvider constructs a fresh SamlProvider per request; the
 * node-saml default cache is per-instance, so the AuthnRequest ID stored at
 * /saml/login is gone by the time /saml/acs verifies InResponseTo under
 * `'always'` — and the SP-initiated LogoutRequest ID would never be found by
 * the inbound LogoutResponse validator either (cross-node: never, single-node:
 * always). Shared Redis state fixes both lanes.
 *
 * Redis absent -> buildSamlCacheProvider() returns undefined and node-saml
 * keeps its in-memory default (single-node honest, warned once).
 * Command errors PROPAGATE (fail-closed): a broken replay cache must not
 * silently accept un-verifiable InResponseTo values.
 */
import type { SamlCacheProvider } from '@accessbase/identity';
import { logger } from '@accessbase/logging';
import { getRedis } from './redis.js';

const KEY_PREFIX = 'ab:saml:req:';

/**
 * node-saml 5.1.0 default requestIdExpirationPeriodMs is 8h (saml.js:91);
 * we keep its default window plus a 60s grace so entries outlive the expiry
 * check they guard. Exported for the SLO replay-dedup TTL (saml-logout.ts).
 */
export const SAML_REQUEST_TTL_MS = 28_800_000 + 60_000;

let warnedNoRedis = false;

export async function buildSamlCacheProvider(): Promise<SamlCacheProvider | undefined> {
  const redis = await getRedis();
  if (!redis) {
    if (!warnedNoRedis) {
      warnedNoRedis = true;
      logger.warn(
        { feature: 'saml' },
        'Redis unavailable — SAML request-id cache stays per-instance in-memory (single-node only; cross-node InResponseTo validation will fail)',
      );
    }
    return undefined;
  }
  const ttlSeconds = Math.ceil(SAML_REQUEST_TTL_MS / 1000);
  return {
    async saveAsync(key: string, value: string) {
      await redis.set(`${KEY_PREFIX}${key}`, value, 'EX', ttlSeconds);
      return { value, createdAt: Date.now() };
    },
    async getAsync(key: string) {
      return redis.get(`${KEY_PREFIX}${key}`);
    },
    async removeAsync(key: string | null) {
      if (key === null) return null;
      await redis.del(`${KEY_PREFIX}${key}`);
      return key;
    },
  };
}
