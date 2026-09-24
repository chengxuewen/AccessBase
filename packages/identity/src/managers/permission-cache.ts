/**
 * Permission cache - zero-dependency leaf module (B1)
 *
 * 30s TTL cache for effective permissions, keyed by `perm:{tenantId}:{userId}`.
 * Invalidate on role/permission mutations; same-process scope only.
 */
import type { Permission } from '../types.js';

export const PERMISSION_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  permissions: Permission[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function permissionCacheKey(tenantId: string, userId: string): string {
  return `perm:${tenantId}:${userId}`;
}

export type CachePublishHook = (tenantId?: string, userId?: string) => void;
let publishHook: CachePublishHook | undefined;
/** Q2c: server boot registers a redis-publisher so OTHER nodes drop their
 * per-process copies too (cross-node coherence without dropping the leaf
 * module's zero-dependency shape). */
export function setPermissionCachePublishHook(hook: CachePublishHook | undefined): void {
  publishHook = hook;
}

export function invalidatePermissionCache(
  tenantId?: string,
  userId?: string,
  opts?: { fromRemote?: boolean },
): void {
  const announce = (t?: string, u?: string) => {
    if (!opts?.fromRemote) publishHook?.(t, u);
  };
  if (!tenantId) {
    cache.clear();
    announce();
    return;
  }
  if (!userId) {
    for (const k of cache.keys()) if (k.startsWith(`perm:${tenantId}:`)) cache.delete(k);
    announce(tenantId);
    return;
  }
  cache.delete(permissionCacheKey(tenantId, userId));
  announce(tenantId, userId);
}

export function resetPermissionCache(): void {
  cache.clear();
}

export function getCachedPermissions(tenantId: string, userId: string): CacheEntry | undefined {
  return cache.get(permissionCacheKey(tenantId, userId));
}

export function setCachedPermissions(
  tenantId: string,
  userId: string,
  permissions: Permission[],
  ttlMs: number,
): void {
  cache.set(permissionCacheKey(tenantId, userId), { permissions, expiresAt: Date.now() + ttlMs });
}
