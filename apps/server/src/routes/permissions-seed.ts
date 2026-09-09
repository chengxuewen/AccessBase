/**
 * Builtin permission seeding — idempotent, best-effort.
 * Seeds 9 {resource, action} permissions and binds all to the admin role.
 */
import { and, inArray } from 'drizzle-orm';
import type { DrizzleDB } from '@accessbase/identity/db';
import { permissions, rolePermissions } from '@accessbase/identity/db';
import { logger } from '@accessbase/logging';

/**
 * 9 builtin permissions — resource/action pairs must match
 * authorize.ts getRequiredPermission() mapping verbatim.
 */
export const BUILTIN_PERMISSIONS: { name: string; resource: string; action: string; description: string }[] = [
  { name: 'users:read', resource: 'users', action: 'read', description: 'View users' },
  { name: 'users:write', resource: 'users', action: 'write', description: 'Create or update users' },
  { name: 'users:delete', resource: 'users', action: 'delete', description: 'Delete users' },
  { name: 'roles:read', resource: 'roles', action: 'read', description: 'View roles' },
  { name: 'roles:write', resource: 'roles', action: 'write', description: 'Create or update roles' },
  { name: 'roles:delete', resource: 'roles', action: 'delete', description: 'Delete roles' },
  { name: 'permissions:read', resource: 'permissions', action: 'read', description: 'View permissions' },
  { name: 'permissions:write', resource: 'permissions', action: 'write', description: 'Create or update permissions' },
  { name: 'permissions:delete', resource: 'permissions', action: 'delete', description: 'Delete permissions' },
];

const RESOURCES = ['users', 'roles', 'permissions'];
const ACTIONS = ['read', 'write', 'delete'];

/**
 * Insert the 9 builtin permissions (ON CONFLICT DO NOTHING), read back their
 * IDs by resource+action, then bind all to the given role (idempotent).
 * Never throws — failures are logged and swallowed (best-effort, seed must not
 * block admin creation).
 */
export async function seedBuiltinPermissions(db: DrizzleDB, roleId: string): Promise<void> {
  try {
    await db.insert(permissions).values(BUILTIN_PERMISSIONS).onConflictDoNothing();

    const rows = await db
      .select({ id: permissions.id, resource: permissions.resource, action: permissions.action })
      .from(permissions)
      .where(
        and(
          inArray(permissions.resource, RESOURCES),
          inArray(permissions.action, ACTIONS),
        ),
      );

    if (rows.length === 0) {
      logger.error('seedBuiltinPermissions: no permissions found after insert — skipping role binding');
      return;
    }

    await db
      .insert(rolePermissions)
      .values(rows.map((row) => ({ roleId, permissionId: row.id })))
      .onConflictDoNothing();

    logger.info({ roleId, count: rows.length }, 'Seeded builtin permissions and bound to role');
  } catch (err) {
    // best-effort: seed failure must not fail admin creation
    logger.error({ err, roleId }, 'Failed to seed builtin permissions — admin creation continues');
  }
}
