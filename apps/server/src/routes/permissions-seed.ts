/**
 * Builtin permission seeding — idempotent, best-effort.
 * Seeds 21 {resource, action} permissions and binds all to the admin role.
 */
import { and, count, eq, inArray, sql } from 'drizzle-orm';
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
 * STRICT kernel (L-prime X4): ensure the 21 builtin permission rows exist, bind the
 * given permission NAMES to a role, then ASSERT the role holds exactly that many
 * bindings — throws on any shortfall so a caller (tenant bootstrap) can never
 * report 201 with a silently unbound admin role. Binding is additive with ON
 * CONFLICT DO NOTHING, so repeated calls converge on the same state.
 */
export async function bindPermissions(
  db: DrizzleDB,
  roleId: string,
  names: ReadonlyArray<string>,
): Promise<void> {
  await db.insert(permissions).values(BUILTIN_PERMISSIONS).onConflictDoNothing();

  const rows = await db
    .select({ id: permissions.id, name: permissions.name })
    .from(permissions)
    .where(inArray(permissions.name, [...names]));

  const found = new Set(rows.map((row) => row.name));
  const missing = names.filter((name) => !found.has(name));
  if (missing.length > 0) {
    throw new Error(`bindPermissions: missing builtin rows after insert: ${missing.join(', ')}`);
  }

  await db
    .insert(rolePermissions)
    .values(rows.map((row) => ({ roleId, permissionId: row.id })))
    .onConflictDoNothing();

  const [bound] = await db
    .select({ count: count() })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  const boundCount = bound?.count ?? 0;
  if (boundCount !== names.length) {
    throw new Error(
      `bindPermissions: role ${roleId} holds ${boundCount} bindings, expected ${names.length}`,
    );
  }
  logger.info({ roleId, count: boundCount }, 'Bound permissions to role');
}

/**
 * Best-effort seed of ALL 21 builtin permissions onto a role. NEVER throws —
 * failures are logged and swallowed (admin creation must not be blocked by a
 * transient seed error; startup self-heal retries). Wizard/init keep calling
 * this; bootstrap uses the strict kernel directly with the tenant partition.
 */
export async function seedBuiltinPermissions(db: DrizzleDB, roleId: string): Promise<void> {
  try {
    await bindPermissions(
      db,
      roleId,
      BUILTIN_PERMISSIONS.map((permission) => permission.name),
    );
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
 * Single self-heal attempt: dial DB, probe `SELECT 1 FROM permissions` (throws on
 * connection failure or missing core schema), then run the existing swallowing body.
 * ensureSeedForAdmin keeps its never-throws contract (init/setup share it).
 */
export async function runSelfHealOnce(databaseUrl: string): Promise<void> {
  const { createDb, closeDb } = await import('@accessbase/identity/db');
  const db = createDb(databaseUrl);
  try {
    // Probe: verify connectivity + core schema exist. This is the one point that
    // must throw so the retry loop can observe failure — unlike ensureSeedForAdmin
    // which swallows everything internally (three-layer swallow, flows R1).
    await db.execute(sql`SELECT 1 FROM permissions`);
    await ensureSeedForAdmin(db);
  } finally {
    // Dial a fresh pool per attempt and always end it — a leaked idle-client
    // 'error' event on a never-ended pool can surface as an uncaughtException
    // (exit 1) between retries (final-review F2).
    await closeDb(db).catch((err: unknown) => {
      logger.warn({ err }, 'failed to close self-heal dial pool');
    });
  }
}

/**
 * Startup-entry self-heal: dials DATABASE_URL and re-seeds builtin permissions
 * onto an existing admin role. Bounded retry with fixed delay (attempts=6,
 * delayMs=5000 by default). Fire-and-forget from index.ts only — buildApp()
 * must stay side-effect-free. Never rejects.
 */
export async function selfHealSeed(
  databaseUrl: string,
  opts: { attempts?: number; delayMs?: number; runOnce?: (url: string) => Promise<void> } = {},
): Promise<void> {
  const attempts = opts.attempts ?? 6;
  const delayMs = opts.delayMs ?? 5000;
  const runOnce = opts.runOnce ?? runSelfHealOnce;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await runOnce(databaseUrl);
      return;
    } catch (err) {
      if (attempt === attempts) {
        logger.error({ err }, 'permission seed self-heal failed — seed missing — guarded routes 403');
        return;
      }
      logger.warn({ err, attempt, attempts }, 'permission seed self-heal attempt failed — retrying');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
