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
import { and, eq, sql } from 'drizzle-orm';
import type { DbLike } from '../db/index.js';
import { groupRoles, groupUsers, roles, userRoles, users } from '../db/schema.js';

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
  db: DbLike,
  tenantId: string,
  excludingUserId: string,
): Promise<boolean> {
  const set = await collectAdminHolders(db, tenantId);
  if (!set.has(excludingUserId)) {
    return false;
  }
  return set.size <= 1;
}

/** Direct + group-via active isSystem holders of a tenant (Q4b R2: JS union,
 * both legs joined to users on tenant + status='active' — never raw $ SQL). */
export async function collectAdminHolders(db: DbLike, tenantId: string): Promise<Set<string>> {
  const direct = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.tenantId, tenantId)))
    .where(
      and(eq(userRoles.tenantId, tenantId), eq(roles.isSystem, true), eq(users.status, 'active')),
    );
  const viaGroup = await db
    .select({ userId: groupUsers.userId })
    .from(groupUsers)
    .innerJoin(groupRoles, eq(groupUsers.groupId, groupRoles.groupId))
    .innerJoin(roles, eq(groupRoles.roleId, roles.id))
    .innerJoin(users, and(eq(users.id, groupUsers.userId), eq(users.tenantId, tenantId)))
    .where(
      and(
        eq(groupUsers.tenantId, tenantId),
        eq(roles.isSystem, true),
        eq(users.status, 'active'),
      ),
    );
  const set = new Set<string>();
  for (const r of direct as Array<{ userId: string }>) set.add(r.userId);
  for (const r of viaGroup as Array<{ userId: string }>) set.add(r.userId);
  return set;
}

/** True when the user's isSystem standing does NOT depend on `groupId`
 * (direct grant or another group). Basis for member-revoke skips. */
export async function holdsIsSystemExceptViaGroup(
  db: DbLike,
  tenantId: string,
  userId: string,
  groupId: string,
): Promise<boolean> {
  const [directHit] = await db
    .select({ x: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId), eq(roles.isSystem, true)))
    .limit(1);
  if (directHit) return true;
  const [otherGroupHit] = await db
    .select({ x: groupUsers.userId })
    .from(groupUsers)
    .innerJoin(groupRoles, eq(groupUsers.groupId, groupRoles.groupId))
    .innerJoin(roles, eq(groupRoles.roleId, roles.id))
    .where(
      and(
        eq(groupUsers.userId, userId),
        eq(groupUsers.tenantId, tenantId),
        eq(roles.isSystem, true),
        sql`${groupUsers.groupId} <> ${groupId}`,
      ),
    )
    .limit(1);
  return Boolean(otherGroupHit);
}

/** Any isSystem standing via group membership at all (over-block skip for the
 * DIRECT-role funnels — R3). */
export async function holdsSystemRoleViaGroup(
  db: DbLike,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const [hit] = await db
    .select({ x: groupUsers.userId })
    .from(groupUsers)
    .innerJoin(groupRoles, eq(groupUsers.groupId, groupRoles.groupId))
    .innerJoin(roles, eq(groupRoles.roleId, roles.id))
    .where(and(eq(groupUsers.userId, userId), eq(groupRoles.tenantId, tenantId), eq(roles.isSystem, true)))
    .limit(1);
  return Boolean(hit);
}
