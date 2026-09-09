/**
 * Builtin permission seeding — idempotent, best-effort.
 * Seeds 9 {resource, action} permissions and binds all to the admin role.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DrizzleDB } from '@accessbase/identity/db';
import { permissions, rolePermissions, roles } from '@accessbase/identity/db';
import { logger } from '@accessbase/logging';
import { DEFAULT_TENANT } from '../utils/constants.js';

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
    logger.error({ err, roleId }, 'Failed to seed builtin permissions — admin creation continues');
  }
}

/**
 * Startup self-heal: when an 'admin' role already exists in the default tenant
 * (wizard or env-bypass created it), re-run the idempotent builtin-permission
 * seed. Covers deployments whose admin predates seeding — requirePermission
 * would otherwise lock every mapped route for the admin. Never rejects.
 */
export async function ensureSeedForAdmin(db: DrizzleDB): Promise<void> {
  try {
    const [adminRole] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.name, 'admin'), eq(roles.tenantId, DEFAULT_TENANT)))
      .limit(1);
    if (adminRole) {
      await seedBuiltinPermissions(db, adminRole.id);
    }
  } catch (err) {
    // best-effort: missing/broken tables must never crash startup
    logger.error({ err }, 'ensureSeedForAdmin failed — startup continues');
  }
}

/**
 * Startup-entry self-heal: dials DATABASE_URL and re-seeds builtin permissions
 * onto an existing admin role. Fire-and-forget from the process entry point only —
 * buildApp() must stay side-effect-free (factory dialing real PG in tests raced
 * with teardown: 'role test does not exist' FATAL noise, flaky audit tests).
 * All layers swallow: never rejects, never crashes startup.
 */
export async function selfHealSeed(databaseUrl: string): Promise<void> {
  try {
    // lazy import keeps pg Pool out of the module graph (same pattern as app.ts audit)
    const { createDb } = await import('@accessbase/identity/db');
    await ensureSeedForAdmin(createDb(databaseUrl));
  } catch (err) {
    logger.error({ err }, 'permission seed self-heal failed');
  }
}
