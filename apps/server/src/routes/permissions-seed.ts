/**
 * Builtin permission seeding — idempotent, best-effort.
 * Seeds 21 {resource, action} permissions and binds all to the admin role.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DrizzleDB } from '@accessbase/identity/db';
import { permissions, rolePermissions, roles, tenants } from '@accessbase/identity/db';
import { logger } from '@accessbase/logging';
import { DEFAULT_TENANT } from '../utils/constants.js';

/**
 * 21 builtin permissions — resource/action pairs must match
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
  { name: 'audit:read', resource: 'audit', action: 'read', description: 'View audit logs' },
  { name: 'stats:read', resource: 'stats', action: 'read', description: 'View deployment stats' },
  { name: 'options:read', resource: 'options', action: 'read', description: 'View runtime options' },
  { name: 'options:write', resource: 'options', action: 'write', description: 'Modify runtime options' },
  { name: 'clients:read', resource: 'clients', action: 'read', description: 'View OIDC clients' },
  { name: 'clients:write', resource: 'clients', action: 'write', description: 'Manage OIDC clients' },
  { name: 'apikeys:read', resource: 'apikeys', action: 'read', description: 'View API keys' },
  { name: 'apikeys:write', resource: 'apikeys', action: 'write', description: 'Create API keys' },
  { name: 'apikeys:delete', resource: 'apikeys', action: 'delete', description: 'Revoke API keys' },
  { name: 'tenants:read', resource: 'tenants', action: 'read', description: 'View tenants' },
  { name: 'tenants:write', resource: 'tenants', action: 'write', description: 'Create or update tenants' },
  { name: 'tenants:delete', resource: 'tenants', action: 'delete', description: 'Delete tenants' },
];

const RESOURCES = ['users', 'roles', 'permissions', 'audit', 'stats', 'options', 'clients', 'apikeys', 'tenants'];
const ACTIONS = ['read', 'write', 'delete'];

/**
 * First-writer insert of the default tenant row (R6). Idempotent via the slug
 * unique constraint (onConflictDoNothing): safe against pre-existing rows from
 * a prior bootstrap. Uses the fixed DEFAULT_TENANT literal id so auth claim
 * fallback and permission-cache keys resolve to the same row.
 */
export async function ensureDefaultTenantRow(db: DrizzleDB): Promise<void> {
  try {
    await db
      .insert(tenants)
      .values({
        id: DEFAULT_TENANT,
        name: 'Default',
        slug: 'default',
      })
      .onConflictDoNothing();
  } catch (err) {
    // best-effort: tenants table may predate migration 0002 on legacy DBs
    logger.warn({ err }, 'ensureDefaultTenantRow failed — continuing without default tenant row');
  }
}


/**
 * Insert the 21 builtin permissions (ON CONFLICT DO NOTHING), read back their
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
    // Default tenant first-writer (R6) — independent of the admin-role early
    // return below: self-heal backfills the row even with no admin role.
    await ensureDefaultTenantRow(db);

    // K-T2: stamp every built-in admin role as system-protected (immutable).
    // Direct SQL, deliberately NO tenant filter (addendum R4: every tenant's
    // admin gets the moat) and never via RoleManager.update (input would
    // refuse isSystem and the guard would make re-stamping non-idempotent).
    // Own swallow: a legacy table without is_system must not block seeding.
    try {
      await db.update(roles).set({ isSystem: true }).where(eq(roles.name, 'admin'));
    } catch (stampErr: unknown) {
      logger.warn({ err: stampErr }, 'system-role stamp skipped — continuing');
    }

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
