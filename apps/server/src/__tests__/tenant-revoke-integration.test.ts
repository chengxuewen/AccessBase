/**
 * Batch P W3-3 (F14, C-A2 revived): TenantManager.update(status suspended)
 * must revoke the tenant's live sessions + api keys and clear the (TTL-less)
 * session-list caches. Real PostgreSQL (harness per oidc-persistence /
 * session-rotate-race precedent; whole file skips when PG is down).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';

const ADMIN_URL = 'postgresql://accessbase:accessbase@localhost:5432/postgres';
const SCRATCH = 'accessbase_tenant_revoke_it';
const URL = `postgresql://accessbase:accessbase@localhost:5432/${SCRATCH}`;
const ROOT = path.resolve(__dirname, '../../../..');
const PS = path.join(ROOT, '.pixi/envs/native/bin/psql');
const MIGRATE = path.join(ROOT, 'scripts/migrate.sh');

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
  await pool?.end();
  execFileSync(PS, [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH}`]);
});

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

async function mkTenant(name: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`,
    [id, name, `${name}-${id.slice(0, 8)}`],
  );
  return id;
}

async function mkUser(tenantId: string, tag: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, name, status, tenant_id) VALUES ($1,$2,$3,'active',$4)`,
    [id, `${tag}-${id.slice(0, 8)}@it.test`, 'Revoker', tenantId],
  );
  return id;
}

async function mkSession(userId: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO sessions (id, user_id, token, refresh_token_hash, expires_at)
     VALUES ($1,$2,$3,$4, now() + interval '7 days')`,
    [id, userId, `tok-${id}`, `rh-${id}`],
  );
  return id;
}

async function mkApiKey(tenantId: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO api_keys (id, tenant_id, name, prefix, hash)
     VALUES ($1,$2,'it-key','abcd',$3)`,
    [id, tenantId, `hash-${id}`],
  );
  return id;
}

async function revoked(table: 'sessions' | 'api_keys', id: string): Promise<boolean> {
  const r = await pool.query(`SELECT revoked_at IS NOT NULL AS r FROM ${table} WHERE id = $1`, [id]);
  return r.rows[0]?.r === true;
}

describe.skipIf(!pgUp)('TenantManager.revokeTenantAccess (W3-3)', () => {
  it('suspend revokes the tenant sessions+keys, leaves other tenants untouched, is one-way', async () => {
    const { TenantManager } = await import('@accessbase/identity');
    const mgr = new TenantManager(URL);
    const t1 = await mkTenant('acme-susp');
    const t2 = await mkTenant('other-keep');
    const u1 = await mkUser(t1, 'u1');
    const u2 = await mkUser(t2, 'u2');
    const s1 = await mkSession(u1);
    const s2 = await mkSession(u2);
    const k1 = await mkApiKey(t1);
    const k2 = await mkApiKey(t2);

    await mgr.update(t1, { status: 'suspended' });

    expect(await revoked('sessions', s1)).toBe(true);
    expect(await revoked('api_keys', k1)).toBe(true);
    // Cross-tenant isolation: the other tenant keeps living access.
    expect(await revoked('sessions', s2)).toBe(false);
    expect(await revoked('api_keys', k2)).toBe(false);

    // One-way: reactivation never un-revokes (new logins/keys by design).
    await mgr.update(t1, { status: 'active' });
    expect(await revoked('sessions', s1)).toBe(true);
    expect(await revoked('api_keys', k1)).toBe(true);
  });

  it('delete() delegates through the same funnel; default tenant stays protected', async () => {
    const { TenantManager } = await import('@accessbase/identity');
    const mgr = new TenantManager(URL);
    const t = await mkTenant('via-delete');
    const u = await mkUser(t, 'ud');
    const s = await mkSession(u);
    const k = await mkApiKey(t);

    await mgr.delete(t);
    expect(await revoked('sessions', s)).toBe(true);
    expect(await revoked('api_keys', k)).toBe(true);

    await expect(mgr.update(DEFAULT_TENANT, { status: 'suspended' })).rejects.toThrow(
      /TENANT_PROTECTED/,
    );
  });
});
