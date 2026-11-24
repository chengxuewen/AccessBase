/**
 * 4A items 1+4 — real-app integration battery: per-key CIDR on BOTH lanes
 * (authenticate + the SCIM preHandler) and the audit-export destination CRUD
 * surface (platform belt, one-time secret reveal, PH-3 cursor init, rotate,
 * delete, apikey-lane denial). Scratch-DB pattern per revocation-stack /
 * webhook-dispatcher-integration: full chain onto a run-unique database,
 * buildApp() against it, pgUp skipIf.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { hashApiKey } from '@accessbase/identity';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../../..');
const ADMIN_URL = 'postgresql://accessbase:accessbase@localhost:5432/postgres';
const SCRATCH = `accessbase_4alane_${Date.now().toString(36)}`;
const URL = `postgresql://accessbase:accessbase@localhost:5432/${SCRATCH}`;
const PS = path.join(ROOT, '.pixi/envs/native/bin/psql');

let pgUp = false;
try {
  const p = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
  await p.query('SELECT 1');
  await p.end();
  pgUp = true;
} catch {
  pgUp = false;
}

// config reads env at import; pin BEFORE importing app.js
process.env['DATABASE_URL'] = URL;
process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = '4a-lanes-integration-secret';
process.env['ADMIN_EMAIL'] = 'lanes@it.local';

const { buildApp } = await import('../app.js');

type Awaited2<T> = T extends Promise<infer U> ? U : T;
type App = Awaited2<ReturnType<typeof buildApp>>;

let app: App;
let admin: string;
let pool: pg.Pool;

const EMAIL = 'lanes@it.local';
const PASSWORD = 'LanesPass-123';

beforeAll(async () => {
  try {
    execFileSync(PS, [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH}`], { stdio: 'ignore' });
  } catch {
    /* reclaimed next run */
  }
  execFileSync(PS, [ADMIN_URL, '-qc', `CREATE DATABASE ${SCRATCH}`]);
  execFileSync('bash', [path.join(ROOT, 'scripts/migrate.sh'), path.join(ROOT, 'packages/migration/drizzle')], {
    env: {
      ...process.env,
      DATABASE_URL: URL,
      PATH: `${path.join(ROOT, '.pixi/envs/native/bin')}:${process.env['PATH'] ?? ''}`,
    },
  });
  pool = new pg.Pool({ connectionString: URL, max: 4 });
  app = await buildApp();
  // Wizard: creates the admin AND seeds the admin role + builtin permissions.
  const setup = await app.inject({
    method: 'POST',
    url: '/api/v1/setup/admin',
    payload: { email: EMAIL, name: 'Lanes Admin', password: PASSWORD },
  });
  expect(setup.statusCode).toBe(201);
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: EMAIL, password: PASSWORD },
  });
  expect(login.statusCode).toBe(200);
  admin = (login.json().data as { accessToken: string }).accessToken;
}, 90_000);

afterAll(async () => {
  await app?.close().catch(() => undefined);
  await pool?.end().catch(() => undefined);
  try {
    execFileSync(
      PS,
      [
        ADMIN_URL,
        '-qc',
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${SCRATCH}' AND pid <> pg_backend_pid()`,
      ],
      { stdio: 'ignore' },
    );
    execFileSync(PS, [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH}`], { stdio: 'ignore' });
  } catch {
    /* prefix sweep */
  }
  try {
    const orphans = execSync(
      `"${PS}" "${ADMIN_URL}" -tAc "SELECT datname FROM pg_database WHERE datname LIKE 'accessbase_4alane_%'"`,
      { encoding: 'utf8' },
    ).trim();
    for (const name of orphans.split('\n').filter(Boolean)) {
      execSync(`"${PS}" "${ADMIN_URL}" -qc "DROP DATABASE IF EXISTS ${name}"`, { stdio: 'ignore' });
    }
  } catch {
    /* harmless */
  }
});

const AUTH = () => ({ authorization: `Bearer ${admin}` });

async function createKey(payload: Record<string, unknown>): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/api-keys',
    headers: { ...AUTH(), 'content-type': 'application/json' },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return (res.json().data as { plaintext: string }).plaintext;
}

describe.skipIf(!pgUp)('per-key CIDR — BOTH lanes (4A T4 / F-04)', () => {
  it(
    'authenticate lane: key allowlisted off-origin → 401 APIKEY_IP_001 (inject origin 127.0.0.1)',
    { timeout: 30_000 },
    async () => {
      const plaintext = await createKey({
        name: 'lanes-blocked',
        scopes: ['*'],
        cidrAllowlist: ['203.0.113.0/24'], // TEST-NET-3 — inject's 127.0.0.1 is outside
      });
      const blocked = await app.inject({
        method: 'GET',
        url: '/api/v1/stats',
        headers: { authorization: `Bearer ${plaintext}` },
      });
      expect(blocked.statusCode).toBe(401);
      expect(blocked.json().error.code).toBe('APIKEY_IP_001');
    },
  );
});

async function widenKey(plaintext: string, cidr: string[]): Promise<void> {
  await pool.query(`UPDATE api_keys SET cidr_allowlist = $2::jsonb WHERE hash = $1`, [
    hashApiKey(plaintext),
    JSON.stringify(cidr),
  ]);
}

describe.skipIf(!pgUp)('per-key CIDR — widened keys pass both lanes', () => {
  it(
    'authenticate lane passes; SCIM lane blocked → 401 scim shape, widened → 200 ListResponse',
    { timeout: 30_000 },
    async () => {
      const starKey = await createKey({ name: 'lanes-star', scopes: ['*'], cidrAllowlist: ['203.0.113.0/24'] });
      await widenKey(starKey, ['127.0.0.1/32']);
      const ok = await app.inject({
        method: 'GET',
        url: '/api/v1/stats',
        headers: { authorization: `Bearer ${starKey}` },
      });
      expect(ok.statusCode).toBe(200);

      const scimKey = await createKey({ name: 'lanes-scim', scopes: ['scim'], cidrAllowlist: ['203.0.113.0/24'] });
      const scimBlocked = await app.inject({
        method: 'GET',
        url: '/api/v1/scim/v2/Users',
        headers: { authorization: `Bearer ${scimKey}` },
      });
      expect(scimBlocked.statusCode).toBe(401);
      expect(scimBlocked.json().detail).toContain('allowlist');

      await widenKey(scimKey, ['127.0.0.1/32']);
      const scimOk = await app.inject({
        method: 'GET',
        url: '/api/v1/scim/v2/Users',
        headers: { authorization: `Bearer ${scimKey}` },
      });
      expect(scimOk.statusCode).toBe(200);
      // the wizard's admin user is visible — at least that one
      expect(scimOk.json().totalResults).toBeGreaterThanOrEqual(1);
    },
  );
});

describe.skipIf(!pgUp)('audit-export destination CRUD (4A T2 / P-5=A)', () => {
  it(
    'validation → create (secret once + PH-3 cursor at current max) → list (no secret) → rotate → apikey denied → delete → 404',
    { timeout: 30_000 },
    async () => {
      const http = await app.inject({
        method: 'POST',
        url: '/api/v1/audit-export',
        headers: { ...AUTH(), 'content-type': 'application/json' },
        payload: { url: 'http://siem.example/a' },
      });
      expect(http.statusCode).toBe(400);
      expect(http.json().error.code).toBe('AUDIT_EXPORT_URL_HTTP');

      const ssrf = await app.inject({
        method: 'POST',
        url: '/api/v1/audit-export',
        headers: { ...AUTH(), 'content-type': 'application/json' },
        payload: { url: 'https://169.254.169.254/latest/meta-data' },
      });
      expect(ssrf.statusCode).toBe(400);
      expect(ssrf.json().error.code).toBe('AUDIT_EXPORT_URL_DENIED');

      // PH-3: destination created AFTER rows exist starts at current max(seq).
      await pool.query(
        `INSERT INTO audit_logs (tenant_id, user_id, action, response_status) VALUES ('00000000-0000-0000-0000-000000000001', 'u', 'CREATE', 201)`,
      );
      const head = await pool.query(`SELECT COALESCE(max("seq"), 0)::int AS m FROM audit_logs`);
      const maxSeq = Number(head.rows[0]?.['m']);

      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/audit-export',
        headers: { ...AUTH(), 'content-type': 'application/json' },
        payload: { url: 'https://siem.example/audit', description: 'battery' },
      });
      expect(created.statusCode).toBe(201);
      const row = created.json().data as {
        id: string;
        secret: string;
        lastDeliveredSeq: number;
      };
      expect(typeof row.secret).toBe('string');
      expect(row.lastDeliveredSeq).toBe(maxSeq); // PH-3 battery lock

      const dupe = await app.inject({
        method: 'POST',
        url: '/api/v1/audit-export',
        headers: { ...AUTH(), 'content-type': 'application/json' },
        payload: { url: 'https://siem.example/audit' },
      });
      expect(dupe.statusCode).toBe(409);

      const list = await app.inject({ method: 'GET', url: '/api/v1/audit-export', headers: AUTH() });
      expect(list.statusCode).toBe(200);
      const items = list.json().data as Array<Record<string, unknown>>;
      const mine = items.find((i) => i['id'] === row.id);
      if (!mine) throw new Error('created destination missing from list');
      expect(mine['secret']).toBeUndefined();
      expect(mine['secretEncrypted']).toBeUndefined();
      expect(mine['skippedCount']).toBe(0);

      const rotated = await app.inject({
        method: 'POST',
        url: `/api/v1/audit-export/${row.id}/rotate`,
        headers: AUTH(),
      });
      expect(rotated.statusCode).toBe(200);
      const rotatedSecret = (rotated.json().data as { secret: string }).secret;
      expect(rotatedSecret).not.toBe(row.secret);

      // apikey lane NEVER manages export channels (sec M-2)
      const starKey = await createKey({ name: 'lanes-export', scopes: ['*'] });
      const viaKey = await app.inject({
        method: 'POST',
        url: '/api/v1/audit-export',
        headers: { authorization: `Bearer ${starKey}`, 'content-type': 'application/json' },
        payload: { url: 'https://evil.example/audit' },
      });
      expect(viaKey.statusCode).toBe(403);
      expect(viaKey.json().error.code).toBe('PERM_002');

      const deleted = await app.inject({
        method: 'DELETE',
        url: `/api/v1/audit-export/${row.id}`,
        headers: AUTH(),
      });
      expect(deleted.statusCode).toBe(200);
      const ghost = await app.inject({
        method: 'POST',
        url: `/api/v1/audit-export/${row.id}/rotate`,
        headers: AUTH(),
      });
      expect(ghost.statusCode).toBe(404);
    },
  );
});
