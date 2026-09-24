/**
 * Q3A bearer-revocation reader (spec rev.2): ≤30s Redis-memoed {tokenVersion,
 * status} compared against the JWT claims stamped at signing. Absent Redis →
 * check SKIPS (single-node honest fallback = 15m TTL semantics, unchanged).
 * Redis/DB errors fail-OPEN — an infra blip must never lock everyone out.
 */
import { eq } from 'drizzle-orm';
import { users } from '@accessbase/identity/db';
import { getRedis } from './redis.js';
import { authDb } from './managers.js';

export interface AuthState {
  tokenVersion: number;
  status: string;
}

const TTL_SECONDS = 30;

async function readDb(sub: string): Promise<AuthState | null> {
  try {
    const db = authDb();
    const rows = await db
      .select({ tokenVersion: users.tokenVersion, status: users.status })
      .from(users)
      .where(eq(users.id, sub))
      .limit(1);
    const row = rows[0];
    return row ? { tokenVersion: row.tokenVersion, status: row.status } : null;
  } catch {
    return null; // DB error → fail-open
  }
}

export async function getAuthState(sub: string): Promise<AuthState | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const key = `authst:${sub}`;
  try {
    const hit = await redis.get(key);
    if (hit !== null && hit !== undefined) {
      return JSON.parse(hit) as AuthState;
    }
  } catch {
    // fall through to DB on a GET error, but SKIP caching (no SET on a broken link)
    return readDb(sub);
  }
  const fresh = await readDb(sub);
  if (fresh) {
    try {
      await redis.set(key, JSON.stringify(fresh), 'EX', TTL_SECONDS);
    } catch {
      // cache write is best-effort
    }
  }
  return fresh;
}
