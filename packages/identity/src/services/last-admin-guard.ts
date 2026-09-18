/**
 * Last-admin lockout guard (Batch K T2).
 *
 * Single source of truth for the predicate "would removing/suspending/deleting
 * this user leave the tenant with zero ACTIVE users holding an isSystem
 * (built-in administrator) role?" — consumed by RoleManager (setUserRoles /
 * revokeFromUser) and UserManager (delete / changeStatus→suspended).
 *
 * Manager-level placement is deliberate (addendum R2): the guard must also
 * gate the SCIM surface, which calls UserManager.changeStatus directly and
 * would bypass any route-level check.
 */
import { and, eq } from 'drizzle-orm';
import type { DrizzleDB } from '../db/index.js';
import { roles, userRoles, users } from '../db/schema.js';

/** 409 mapper tag: operation against a protected (isSystem) role. */
export const ROLE_PROTECTED = 'ROLE_PROTECTED';
/** 409 mapper tag: operation would orphan the tenant of its last admin. */
export const LAST_ADMIN_GUARD = 'LAST_ADMIN_GUARD';

/**
 * Returns true when `excludingUserId` is currently an active holder of an
 * isSystem role AND no other active holder remains in the tenant.
 *
 * False (allow) cases: target is not a holder (already suspended, no admin
 * role, different tenant), or at least one other active holder exists.
 */
export async function wouldOrphanLastAdmin(
  db: DrizzleDB,
  tenantId: string,
  excludingUserId: string,
): Promise<boolean> {
  const holders = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.tenantId, tenantId)))
    .where(
      and(eq(userRoles.tenantId, tenantId), eq(roles.isSystem, true), eq(users.status, 'active')),
    );

  const set = new Set(holders.map((row) => row.userId));
  if (!set.has(excludingUserId)) {
    return false;
  }
  return set.size <= 1;
}
