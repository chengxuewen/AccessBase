/**
 * DG-6d data-scope real-PG integration (data-scope batch T-SERVER, spec §5).
 *
 * The mock lanes fake the managers; THIS file proves the whole wire resolves
 * through real SQL: widened role_permissions.data_scope → getUserDataScope →
 * resolveUserRowScope → findAll's dept predicate → isWithinScope row guards.
 * Scratch-DB idiom: funnel-tx-integration.test.ts (drop/create + migrate.sh);
 * real app + signed JWT per oidc-flow.test.ts. Skips when native PG is down.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_URL = 'postgresql://accessbase:accessbase@localhost:5432/postgres';
const SCRATCH = 'accessbase_data_scope_it';
const URL = `postgresql://accessbase:accessbase@localhost:5432/${SCRATCH}`;
const ROOT = path.resolve(__dirname, '../../../..');
const PS = path.join(ROOT, '.pixi/envs/native/bin/psql');
const MIGRATE = path.join(ROOT, 'scripts/migrate.sh');
const TENANT = '00000000-0000-0000-0000-000000000001';
const TENANT2 = '00000000-0000-0000-0000-000000000002';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'data-scope-integration-secret-32by';
process.env.DATABASE_URL = URL;
process.env.REDIS_URL = 'redis://localhost:6379';

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

// Same plugin mocks as oidc-flow.test.ts (fastify@4 mismatch + noise suppressors).
vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

let pool: pg.Pool;
let app: App;
let callerToken = '';
let emptyDeptToken = '';
const ids = {
  caller: '',
  emptyDept: '',
  memberA: '',
  memberB: '',
  otherDeptMember: '',
  outsider: '',
  crossTenant: '',
  dept1: '',
  dept2: '',
  plainGroup: '',
};

async function insertUser(email: string, tenant: string): Promise<string> {
  const res = await pool.query(
    'INSERT INTO users (email, name, tenant_id) VALUES ($1, $2, $3) RETURNING id',
    [email, `ds-it-${email.split('@')[0]}`, tenant],
  );
  return res.rows[0].id as string;
}

async function ensurePermission(name: string, resource: string, action: string): Promise<string> {
  const existing = await pool.query('SELECT id FROM permissions WHERE resource = $1 AND action = $2', [
    resource,
    action,
  ]);
  if ((existing.rowCount ?? 0) > 0) return existing.rows[0].id as string;
  const ins = await pool.query(
    'INSERT INTO permissions (name, resource, action, description) VALUES ($1, $2, $3, $4) RETURNING id',
    [name, resource, action, 'data-scope integration'],
  );
  return ins.rows[0].id as string;
}

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

  // tenants: groups.tenant_id carries an FK — both tenants must exist.
  await pool.query('INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)', [
    TENANT, 'ds-it-default', `ds-it-default-${Date.now()}`,
    TENANT2, 'ds-it-second', `ds-it-second-${Date.now()}`,
  ]);

  ids.caller = await insertUser('ds-caller@it.local', TENANT);
  ids.emptyDept = await insertUser('ds-emptydept@it.local', TENANT);
  ids.memberA = await insertUser('ds-member-a@it.local', TENANT);
  ids.memberB = await insertUser('ds-member-b@it.local', TENANT);
  ids.otherDeptMember = await insertUser('ds-other-dept@it.local', TENANT);
  ids.outsider = await insertUser('ds-outsider@it.local', TENANT);
  ids.crossTenant = await insertUser('ds-cross-tenant@it.local', TENANT2);

  await pool.query(
    "INSERT INTO groups (id, tenant_id, name, kind) VALUES ($1, $2, 'ds-dept-1', 'department'), ($3, $2, 'ds-dept-2', 'department'), ($4, $2, 'ds-plain-group', 'group')",
    [(ids.dept1 = randomUUID()), TENANT, (ids.dept2 = randomUUID()), (ids.plainGroup = randomUUID())],
  );
  await pool.query(
    'INSERT INTO group_users (group_id, user_id, tenant_id) VALUES ($1,$2,$3),($1,$4,$3),($1,$5,$3),($6,$2,$3),($6,$7,$3),($8,$9,$3)',
    [ids.dept1, ids.caller, TENANT, ids.memberA, ids.memberB, ids.dept2, ids.otherDeptMember, ids.plainGroup, ids.outsider],
  );
  // outsider sits in a kind='group' group ONLY — plain groups must NOT widen dept.

  // Roles: an is_system 'admin' holder satisfies the D113 setup guard; the
  // ds-dept role carries the three users:* bindings at data_scope='dept'.
  const adminRoleId = randomUUID();
  await pool.query(
    "INSERT INTO roles (id, name, tenant_id, is_system) VALUES ($1, 'admin', $2, true), ($3, 'ds-dept-role', $2, false)",
    [adminRoleId, TENANT, randomUUID()],
  );
  const roleRes = await pool.query("SELECT id FROM roles WHERE name = 'ds-dept-role'");
  const deptRoleId = roleRes.rows[0].id as string;
  for (const [resource, action] of [['users', 'read'], ['users', 'write'], ['users', 'delete']] as const) {
    const pid = await ensurePermission(`${resource}:${action}`, resource, action);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id, data_scope) VALUES ($1, $2, $3)', [
      deptRoleId,
      pid,
      'dept',
    ]);
  }
  await pool.query('INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1,$2,$3),($4,$2,$3),($1,$5,$3)', [
    ids.caller,
    deptRoleId,
    TENANT,
    ids.emptyDept,
    adminRoleId,
  ]);

  app = await buildApp();
  callerToken = app.jwt.sign({ sub: ids.caller });
  emptyDeptToken = app.jwt.sign({ sub: ids.emptyDept });
});

afterAll(async () => {
  await app?.close().catch(() => undefined);
  await pool?.end().catch(() => undefined);
  if (pgUp) {
    // WITH (FORCE): the data-scope util's lazy PermissionManager/GroupManager
    // singletons still hold backends to the scratch DB inside THIS process.
    execFileSync(PS, [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`], { stdio: 'ignore' });
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe.skipIf(!pgUp)('data-scope users wiring (real PG)', () => {
  it('dept caller list = members + self across BOTH departments exactly', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users?pageSize=100', headers: auth(callerToken) });
    expect(res.statusCode).toBe(200);
    const got = (res.json().data as Array<{ id: string }>).map((u) => u.id).sort();
    expect(got).toEqual([ids.caller, ids.memberA, ids.memberB, ids.otherDeptMember].sort());
    expect(res.json().total).toBe(4);
  });

  it('empty-dept caller with a dept binding sees ONLY self [B4 end-to-end]', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users?pageSize=100', headers: auth(emptyDeptToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((u: { id: string }) => u.id)).toEqual([ids.emptyDept]);
  });

  it('outsider row read is 403 DATA_SCOPE (exists but out-of-scope)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/users/${ids.outsider}`, headers: auth(callerToken) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('DATA_SCOPE');
  });

  it('in-scope row read is 200', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/users/${ids.memberA}`, headers: auth(callerToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(ids.memberA);
  });

  it('unknown id stays 404 under a narrowed scope (404-first posture)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/users/${randomUUID()}`, headers: auth(callerToken) });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('cross-tenant user id reads 404, never 403 (tenant scoping precedes scope)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/users/${ids.crossTenant}`, headers: auth(callerToken) });
    expect(res.statusCode).toBe(404);
  });

  it('outsider row write is 403 DATA_SCOPE', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${ids.outsider}`,
      headers: auth(callerToken),
      payload: { name: 'nope' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('DATA_SCOPE');
  });

  it('create under dept scope is 403 DATA_SCOPE [A3/R3]', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(callerToken),
      payload: { email: 'ds-created@it.local', name: 'Nope', password: 'Passw0rd-123' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('DATA_SCOPE');
  });

  it('eraseAudit under dept-scoped users:delete is denied at the gate, row untouched [A6/B2]', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${ids.memberA}`,
      headers: auth(callerToken),
      payload: { eraseAudit: true, legalBasis: 'GDPR Art.17' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('DATA_SCOPE');
    const probe = await pool.query('SELECT count(*)::int AS n FROM users WHERE id = $1', [ids.memberA]);
    expect(Number(probe.rows[0]?.n ?? 0)).toBe(1);
  });

  it('plain delete of an in-scope member succeeds (dept reach is real, not decorative)', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/users/${ids.memberB}`, headers: auth(callerToken) });
    expect(res.statusCode).toBe(200);
    const probe = await pool.query('SELECT count(*)::int AS n FROM users WHERE id = $1', [ids.memberB]);
    expect(Number(probe.rows[0]?.n ?? 0)).toBe(0);
  });
});
