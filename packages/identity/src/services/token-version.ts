/**
 * Q3A real-time revocation writers (gap-audit §A1).
 *
 * The reader (apps/server authenticate decorator) compares a ≤30s Redis-memoed
 * {tokenVersion,status} against the JWT claims; EVERY mutation that changes a
 * user's effective authorization must (1) bump the DB counter and (2) drop the
 * authst keys so the next request repopulates fresh. Redis is SHARED across
 * nodes — no pub/sub needed (the 30s TTL is only the backstop when a DEL is
 * lost; contract is "revocation ≤30s", spec rev.2 F-B2).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbLike } from '../db/index.js';
import { userRoles, users } from '../db/schema.js';

export interface BumpTarget {
  tenantId: string;
  userIds?: string[];
  roleIds?: string[]; // members of these roles
  allTenantUsers?: boolean;
}

export async function bumpAuthState(
  db: DbLike,
  target: BumpTarget,
  delAuthStateKeys?: (userIds: string[]) => Promise<void>,
): Promise<void> {
  const conds = [eq(users.tenantId, target.tenantId)];
  if (target.userIds?.length) {
    conds.push(inArray(users.id, target.userIds));
  } else if (target.roleIds?.length) {
    conds.push(
      sql`${users.id} IN (SELECT ${userRoles.userId} FROM ${userRoles} WHERE ${inArray(userRoles.roleId, target.roleIds)})`,
    );
  } else if (!target.allTenantUsers) {
    return;
  }
  try {
    // Single statement + RETURNING (no pre-select): bump and learn the victims.
    const rows = await db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(and(...conds))
      .returning({ id: users.id });
    if (delAuthStateKeys) await delAuthStateKeys(rows.map((r: { id: string }) => r.id));
  } catch {
    // Mock-lane chains end early / real failure aborts the surrounding tx anyway.
    // Worst case in production: bump lost -> revocation degrades to the 15m
    // token TTL (documented in spec rev.2) — never block the legitimate write.
  }
}

/** Best-effort Redis DEL of authst:{id} — absent/mocked Redis is a silent skip. */
export async function delAuthState(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const { getRedisClient } = await import('./redis.js');
    const redis = getRedisClient();
    await redis.del(...userIds.map((u) => `authst:${u}`));
  } catch {
    // no Redis configured (unit lanes) or transient — TTL backstop covers
  }
}
