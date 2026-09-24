/**
 * Q3A live-stack revocation proof (replaces the one-shot manual battery).
 * Real scratch PG (full chain) + real local Redis: a bearer minted BEFORE an
 * authorization change must die on the NEXT request (immediate DEL — well
 * inside the documented ≤30s contract), refresh rebuilds it, and legacy
 * claim-less tokens keep passing until their 15m TTL (rev.2 B1 rule).
 *
 * No vi.mock anywhere — this file is the anti-seam-mask the batch-B/C audits
 * kept demanding for security semantics.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import Redis from 'ioredis';
import type { FastifyInstance } from 'fastify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../../..');
const ADMIN_URL = 'postgresql://accessbase:accessbase@localhost:5432/postgres';
const SCRATCH = `accessbase_revstack_${Date.now().toString(36)}`; // run-unique: no cross-file DROP races
const URL = `postgresql://accessbase:accessbase@localhost:5432/${SCRATCH}`;
const PS = path.join(ROOT, '.pixi/envs/native/bin/psql');
const MIGRATE = path.join(ROOT, 'scripts/migrate.sh');
const TENANT = '00000000-0000-0000-0000-000000000001';

let pool: pg.Pool;
let sub: FastifyInstance;
let bearer = '';
let refreshToken = '';
let userId = '';
const rds = new Redis('redis://localhost:6379', { maxRetriesPerRequest: 2, retryStrategy: () => null });
let redisUp = false;
try {
  await rds.ping();
  redisUp = true;
} catch {
  redisUp = false;
}

beforeAll(async () => {
  // buildApp opens several scratch pools (oidc adapter et al.) that may still
  // hold backends at this instant; terminate-then-drop makes cleanup terminal.
  try {
    execFileSync(PS, [ADMIN_URL, '-qc', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${SCRATCH}' AND pid <> pg_backend_pid()`], { stdio: 'ignore' });
  } catch { /* best effort */ }
  try {
    try {
    const { execSync } = await import('node:child_process');
    const orphans = execSync(`"${PS}" "${ADMIN_URL}" -tAc "SELECT datname FROM pg_database WHERE datname LIKE 'accessbase_revstack_%'"`, { encoding: 'utf8' }).trim();
    for (const name of orphans.split('\n').filter(Boolean)) {
      execSync(`"${PS}" "${ADMIN_URL}" -qc "DROP DATABASE IF EXISTS ${name}"`, { stdio: 'ignore' });
    }
  } catch { /* fresh box or locked orphans — harmless */ }
  execFileSync(PS, [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH}`], { stdio: 'ignore' });
  } catch { /* next-run beforeAll reclaims */ }
  execFileSync(PS, [ADMIN_URL, '-qc', `CREATE DATABASE ${SCRATCH}`]);
  execFileSync('bash', [MIGRATE, path.join(ROOT, 'packages/migration/drizzle')], {
    env: {
      ...process.env,
      DATABASE_URL: URL,
      PATH: `${path.join(ROOT, '.pixi/envs/native/bin')}:${process.env['PATH'] ?? ''}`,
    },
  });
  process.env.DATABASE_URL = URL;
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.JWT_SECRET = 'revocation-stack-secret';
  process.env.NODE_ENV = 'test';
  const { buildApp } = await import('../app.js');
  sub = await buildApp();

  const adm = await sub.inject({
    method: 'POST',
    url: '/api/v1/setup/admin',
    payload: { email: 'revoketest@it.local', name: 'Revoker', password: 'RevokerPass-123' },
  });
  expect(adm.statusCode).toBe(201);
  userId = (adm.json().data as { userId: string }).userId;
  const done = await sub!.inject({ method: 'POST', url: '/api/v1/setup/complete', payload: {} });
  expect(done.statusCode).toBe(200);
  const tokens = done.json().data as { accessToken: string; refreshToken: string };
  bearer = tokens.accessToken;
  refreshToken = tokens.refreshToken;
  pool = new pg.Pool({ connectionString: URL });
});

afterAll(async () => {
  await sub?.close();
  await pool?.end().catch(() => undefined);
  if (userId) await rds.del(`authst:${userId}`).catch(() => undefined);
  await rds.quit().catch(() => undefined);
  // plugin-scope pools (setup.ts wizard managers, oidc adapter db) may still
  // hold backends — terminate first, then a best-effort drop.
  try {
    execFileSync(PS, [ADMIN_URL, '-qc', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${SCRATCH}' AND pid <> pg_backend_pid()`], { stdio: 'ignore' });
    execFileSync(PS, [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH}`], { stdio: 'ignore' });
  } catch {
    /* orphan scratch DBs are reclaimed by the next run's prefix sweep */
  }
});

describe.skipIf(!redisUp)('bearer revocation end-to-end (live stack)', () => {
  it('pre-change bearer passes; authst got memoized in Redis', async () => {
    const me = await sub!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${bearer}` } });
    expect(me.statusCode).toBe(200);
    expect(await rds.exists(`authst:${userId}`)).toBe(1);
  });

  it('authorization mutation → SAME bearer dies on next request (≤2s ≪ 30s), refresh rebuilds, legacy claim passes', async () => {
    // mutate via the real RoleManager (production path: assign → bumpAuthState + DEL)
    const { RoleManager } = await import('@accessbase/identity');
    const rm = new RoleManager(URL);
    const aux = await rm.create({ name: `aux-${Date.now()}`, description: '' }, TENANT);
    const t0 = Date.now();
    await rm.assignToUser(userId, aux.id, TENANT);
    await rm.close();

    const dead = await sub.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${bearer}` } });
    expect(dead.statusCode).toBe(401);
    expect((dead.json() as { error: { code: string } }).error.code).toBe('AUTH_005');
    expect(Date.now() - t0).toBeLessThan(2000); // DEL is immediate; contract is ≤30s

    // refresh rebuild path via a REAL login (DB-backed session pair — the
    // wizard's /complete hands out a JWT-shaped dev refresh token that never
    // enters the sessions table, so it cannot rotate; login mints a real one)
    const lg = await sub!.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'revoketest@it.local', password: 'RevokerPass-123' },
    });
    expect(lg.statusCode).toBe(200);
    const pair = (lg.json().data as { accessToken: string; refreshToken: string });
    const rf = await sub.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: pair.refreshToken } });
    expect(rf.statusCode).toBe(200);
    const fresh = (rf.json().data as { accessToken: string }).accessToken;
    void refreshToken;
    const me2 = await sub.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${fresh}` } });
    expect(me2.statusCode).toBe(200);

    // legacy token (no tokenVersion claim) → gate must skip (B1 rule), not loop
    const legacy = sub.jwt.sign({ sub: userId, email: 'revoketest@it.local', status: 'active', tenantId: TENANT });
    const ok = await sub.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${legacy}` } });
    expect(ok.statusCode).toBe(200);
  });
});
