/**
 * DG-6d data-scope resolution (data-scope batch T-SERVER, spec §3.3).
 *
 * Maps the caller's per-binding data scope for one users:* code onto the
 * UserScopeFilter the UserManager predicates consume (findAll list arm +
 * isWithinScope row arm). Rules, in ladder order:
 *
 * - [R2] apikey callers short-circuit to tenant-wide BEFORE any permission
 *   read: machine lanes are scope-less by design (mirrors requirePermission's
 *   apikey bypass in utils/permission.ts; a key id as `sub` would resolve
 *   nothing through getUserDataScope).
 * - null binding (code absent from the effective set) is unreachable behind
 *   requirePermission (the code gate 403s first) — fail-SOFT to tenant-wide
 *   with one warn, per the cache/rate-limit fail-soft parity doctrine. The
 *   narrowing-to-self alternative would silently brick legitimate admins on
 *   a cache race, which is the worse failure.
 * - [B4] dept with zero department memberships converts to self HERE — an
 *   empty groupIds array would render a degenerate `in ()` downstream
 *   (UserManager.findAll re-applies the same conversion as a belt).
 */
import type { FastifyRequest } from 'fastify';
import { GroupManager, type UserScopeFilter } from '@accessbase/identity';
import { DEFAULT_TENANT } from './constants.js';
// The guard's module singleton is REUSED (exported for this) — a second
// PermissionManager would mean a second pg pool for the same concern (PIT-081).
import { getPermissionManager } from './permission.js';

/** Codes the v1 data-scope surface governs (ruling A2: users surface only). */
export type UserRowScopeCode = 'users:read' | 'users:write' | 'users:delete';

/**
 * Lazy module-level GroupManager singleton (permission.ts precedent): the
 * manager ctor builds one pg Pool per call, so never per request.
 */
let gm: GroupManager | null = null;
function getGroupManager(): GroupManager {
  gm ??= new GroupManager();
  return gm;
}

export async function resolveUserRowScope(
  request: FastifyRequest,
  code: UserRowScopeCode,
): Promise<UserScopeFilter> {
  // app.authenticate always populates request.user (JWT claims or the apikey
  // skeleton at app.ts); the type is the same cast utils/permission.ts uses.
  const payload = request.user as { sub: string; type?: string };
  if (payload.type === 'apikey') return { kind: 'all' };

  const tenantId = request.tenantId ?? DEFAULT_TENANT;
  const binding = await getPermissionManager().getUserDataScope(payload.sub, code, tenantId);
  if (binding === null) {
    request.log.warn(
      { code, userId: payload.sub },
      'data-scope: guarded code absent from effective permissions — falling back to tenant-wide',
    );
    return { kind: 'all' };
  }
  if (binding === 'self') return { kind: 'self', userId: payload.sub };
  if (binding === 'dept') {
    const groupIds = await getGroupManager().getDepartmentIdsForUser(payload.sub, tenantId);
    if (groupIds.length === 0) return { kind: 'self', userId: payload.sub };
    return { kind: 'dept', userId: payload.sub, groupIds };
  }
  return { kind: 'all' };
}
