/**
 * Q2b real-PG integration: the transactional funnels must be ATOMIC — a later
 * write failing inside routeTx/transaction rolls back the earlier writes.
 * Mock lanes cannot prove this (they fake the methods); this file is the net
 * (pattern: session-rotate-race.test.ts scratch-DB idiom).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_URL = 'postgresql://accessbase:accessbase@localhost:5432/postgres';
const SCRATCH = 'accessbase_funnel_tx_it';
const URL = `postgresql://accessbase:accessbase@localhost:5432/${SCRATCH}`;
const ROOT = path.resolve(__dirname, '../../../..');
const PS = path.join(ROOT, '.pixi/envs/native/bin/psql');
const MIGRATE = path.join(ROOT, 'scripts/migrate.sh');
const TENANT = '00000000-0000-0000-0000-000000000001';

const pgUp = await (async () => {
  try {
    const c = new pg.Client({ connectionString: ADMIN_URL });
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
})();

let pool: pg.Pool;

beforeAll(async () => {
  execFileSync(PS, [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH}`]);
  execFileSync(PS, [ADMIN_URL, '-qc', `CREATE DATABASE ${SCRATCH}`]);
  execFileSync('bash', [MIGRATE, path.join(ROOT, 'packages/migration/drizzle')], {
    env: {
      ...process.env,
      DATABASE_URL: URL,
      PATH: `${path.join(ROOT, '.pixi/envs/native/bin')}:${process.env['PATH'] ?? ''}`,
    },
  });
  pool = new pg.Pool({ connectionString: URL });
});

afterAll(async () => {
  await pool?.end().catch(() => undefined);
  if (pgUp) {
    execFileSync(PS, [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH}`], { stdio: 'ignore' });
  }
});

describe.skipIf(!pgUp)('transactional funnels (real PG)', () => {
  it('create + failing role grant → FULL rollback (no orphan user row)', async () => {
    const { UserManager, RoleManager } = await import('@accessbase/identity');
    const um = new UserManager(URL);
    const rm = new RoleManager(URL);
    const email = `tx-rb-${Date.now()}@it.local`;
    await expect(
      um.transaction(async (tx) => {
        const u = await um.create({ email, name: 'RB', password: 'Passw0rd-1' }, TENANT, tx);
        // FK violation on user_roles.role_id — must roll back the user insert too
        await rm.setUserRoles(u.id, [randomUUID()], TENANT, tx);
      }),
    ).rejects.toThrow();
    const rows = await pool.query('SELECT count(*)::int AS n FROM users WHERE email = $1', [email]);
    expect(Number(rows.rows[0]?.n ?? 0)).toBe(0);
    await um.close();
    await rm.close();
  });

  it('create + valid role grant in one tx → both persisted', async () => {
    const { UserManager, RoleManager } = await import('@accessbase/identity');
    const um = new UserManager(URL);
    const rm = new RoleManager(URL);
    const roleId = randomUUID();
    await pool.query(
      `INSERT INTO roles (id, name, tenant_id, is_system) VALUES ($1,$2,$3,false)`,
      [roleId, `tx-role-${Date.now()}`, TENANT],
    );
    const email = `tx-ok-${Date.now()}@it.local`;
    const u = await um.transaction(async (tx) => {
      const created = await um.create({ email, name: 'OK', password: 'Passw0rd-1' }, TENANT, tx);
      await rm.setUserRoles(created.id, [roleId], TENANT, tx);
      return created;
    });
    const rows = await pool.query(
      'SELECT count(*)::int AS n FROM user_roles WHERE user_id = $1 AND role_id = $2',
      [u.id, roleId],
    );
    expect(Number(rows.rows[0]?.n ?? 0)).toBe(1);
    await um.close();
    await rm.close();
  });
});
