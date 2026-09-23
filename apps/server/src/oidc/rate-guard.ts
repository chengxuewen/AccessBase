/**
 * Batch P W2-1 (report F6): coarse fixed-window per-IP guard for the OIDC
 * provider HIJACK SPACE. All /oidc/* traffic is handed to the panva provider
 * from an onRequest hook (app.ts) before routing, i.e. it lives in Fastify's
 * route-less (404) space where @fastify/rate-limit provably never engages
 * (matched routes 429, route-less requests do not — spec §1 minimal repro).
 *
 * Design notes (rev.2):
 * - Redis-backed when a client is available; ANY redis error degrades to the
 *   per-process Map (local counting — strictly stronger than skipOnError's
 *   allow, and parity with the global plugin's non-redis behavior).
 * - Minute-bucket keys expire via the 120s TTL on redis; the Map prunes
 *   opportunistically past 10k buckets (ponytail: fine at this surface).
 * - Exemptions are decided by the CALLER (discovery/jwks prefixes and the
 *   real-route interaction space never call this).
 */

/** Minimal structural client shape — the getRedis() ioredis singleton fits. */
export interface OidcGuardClient {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export function createOidcRateGuard(
  limitPerMinute: number,
  client: OidcGuardClient | null,
): (ip: string) => Promise<boolean> {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return async (ip: string): Promise<boolean> => {
    const minute = Math.floor(Date.now() / 60_000);
    const key = `rl:oidc:${ip}:${minute}`;

    if (client) {
      try {
        const n = await client.incr(key);
        if (n === 1) await client.expire(key, 120); // TTL outlives the bucket minute
        return n <= limitPerMinute;
      } catch {
        // fall through to local counting — never fail open while we can count
      }
    }

    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: (minute + 1) * 60_000 });
      return true;
    }
    bucket.count += 1;
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return bucket.count <= limitPerMinute;
  };
}
