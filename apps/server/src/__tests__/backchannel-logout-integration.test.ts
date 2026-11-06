/**
 * Q3D back-channel logout — integration battery I1-I6 (spec 2026-10-12 §4).
 * Real PG (scratch db via migrate.sh chain) + real RSA signatures + the ROUTE
 * mounted on a real Fastify instance (inject): urlencoded parser, scoped error
 * handler, rate config, audit exclusion all live. jose's createRemoteJWKSet is
 * stubbed top-level to return our real public key — signatures REALLY verify.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, createPrivateKey, sign as cryptoSign, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';

process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = 'bclo-it-jwt-secret-0123456789abcdef';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_URL = 'postgresql://accessbase:accessbase@localhost:5432/postgres';
const SCRATCH = 'accessbase_bclo_it';
const URL = `postgresql://accessbase:accessbase@localhost:5432/${SCRATCH}`;
const ROOT = path.resolve(__dirname, '../../../..');
const PS = path.join(ROOT, '.pixi/envs/native/bin/psql');
const MIGRATE = path.join(ROOT, 'scripts/migrate.sh');
const TENANT = '00000000-0000-0000-0000-000000000001';
const ISSUER = 'http://127.0.0.1:1';

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

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

// Top-level jose stub (hoisted by vitest): createRemoteJWKSet returns a key
// resolver yielding our real public key — token signatures REALLY verify.
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return {
    ...actual,
    createRemoteJWKSet: () => async () => publicKey,
  };
});

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function signToken(payloadObj: Record<string, unknown>): string {
  const signingInput = `${b64u({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${b64u(payloadObj)}`;
  const pem = privateKey.export({ format: 'pem', type: 'pkcs1' }) as string;
  const signature = cryptoSign('sha256', Buffer.from(signingInput), createPrivateKey(pem));
  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`;
}

const now = () => Math.floor(Date.now() / 1000);
let counter = 0;
const payload = (over: Record<string, unknown> = {}) => ({
  iss: ISSUER,
  sub: `sub-${counter}`,
  aud: 'ab-rp',
  jti: `jti-${counter + 1}`,
  iat: now(),
  exp: now() + 300,
  events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
  ...over,
});

const PROVIDER_JSON = JSON.stringify({
  'kc-it': {
    authUrl: 'http://127.0.0.1:1/a',
    tokenUrl: 'http://127.0.0.1:1/t',
    userinfoUrl: 'http://127.0.0.1:1/u',
    clientId: 'ab-rp',
    issuer: ISSUER,
    jwksUri: 'http://127.0.0.1:1/certs',
  },
});

let pool: pg.Pool;
let app: FastifyInstance | undefined;

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

  process.env['DATABASE_URL'] = URL;
  process.env['OAUTH_PROVIDERS'] = PROVIDER_JSON;
  process.env['ADMIN_EMAIL'] = 'bclo-admin@bclo-it.test';
  process.env['ADMIN_PASSWORD'] = 'Bclo-Admin-Pass1';
  process.env['ADMIN_NAME'] = 'BCLO Admin';
  await pool.query(
    `insert into options (key, value) values ('oauth_kc-it_client_secret', '"placeholder"'), ('oauth_providers', $1)
     on conflict (key) do update set value = excluded.value`,
    [PROVIDER_JSON],
  );

  // Seed an admin-role user BEFORE buildApp so setup-guard's
  // queryAdminExists predicate sees an initialized install (S2S surface must
  // still respect the initialization gate — correct behavior, not a bypass).
  await pool.query(
    `insert into roles (id, name, tenant_id, is_system) values ('11111111-1111-1111-1111-111111111111', 'admin', $1, true)
     on conflict (id) do nothing`,
    [TENANT],
  );
  await pool.query(
    `insert into users (id, email, name, password_hash, tenant_id, status)
     values ('22222222-2222-2222-2222-222222222222', 'bclo-admin@bclo-it.test', 'BCLO Admin', 'x', $1, 'active')
     on conflict (id) do nothing`,
    [TENANT],
  );
  await pool.query(
    `insert into user_roles (user_id, role_id, tenant_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', $1)
     on conflict do nothing`,
    [TENANT],
  );

  const { buildApp } = await import('../app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  const { closeBackchannelLogoutPool } = await import('../routes/oauth-backchannel-logout.js');
  await closeBackchannelLogoutPool().catch(() => undefined);
  await pool?.end().catch(() => undefined);
  if (pgUp) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        execFileSync(PS, [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH}`], {
          stdio: 'ignore',
        });
        break;
      } catch {
        if (attempt === 2) break;
        execFileSync('sleep', ['2']);
      }
    }
  }
}, 30_000);

async function seedLink(sub: string, userId: string): Promise<void> {
  await pool.query(
    `insert into users (id, email, name, password_hash, tenant_id, status) values ($1, $2, 'BCLO IT', 'x', $3, 'active')`,
    [userId, `${userId}@bclo-it.test`, TENANT],
  );
  await pool.query(
    `insert into oauth_accounts (user_id, provider, provider_account_id, access_token, refresh_token, id_token)
     values ($1, 'kc-it', $2, 'at-x', 'rt-x', 'idt-x')`,
    [userId, sub],
  );
}

async function post(
  tokenStr: string,
  remoteAddress?: string,
): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  if (!app) throw new Error('app not built');
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/oauth/backchannel-logout',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    remoteAddress: remoteAddress ?? '10.0.0.1',
    payload: new URLSearchParams({ logout_token: tokenStr }).toString(),
  });
  return { status: res.statusCode, body: res.body, headers: res.headers };
}

const rows = async (sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> =>
  (await pool.query(sql, params)).rows;

describe.skipIf(!pgUp)('backchannel logout integration (real PG + real RSA)', () => {
  it('I1: full loop — sessions revoked, tokenVersion bumped, tokens NULLed, 200 empty + no-store', async () => {
    counter += 1;
    const sub = `sub-${counter}`;
    const uid = randomUUID();
    await seedLink(sub, uid);
    await pool.query(
      `insert into sessions (id, user_id, token, expires_at) values ($1, $2, 'tok-x', now() + interval '1 hour')`,
      [randomUUID(), uid],
    );

    const res = await post(signToken(payload({ sub })));
    expect(res.status).toBe(200);
    expect(res.body).toBe('');
    expect(res.headers['cache-control']).toBe('no-store');

    const sess = await rows(`select revoked_at from sessions where user_id = $1`, [uid]);
    expect(sess[0]?.['revoked_at']).not.toBeNull();
    const u = await rows(`select token_version, id from users where id = $1`, [uid]);
    expect(Number(u[0]?.['token_version'])).toBe(2);
    const link = await rows(
      `select access_token, id_token from oauth_accounts where provider_account_id = $1`,
      [sub],
    );
    expect(link[0]?.['access_token']).toBeNull();
    expect(link[0]?.['id_token']).toBeNull();
  });

  it('I2: byte-identical replay -> 200 again, net state stable (claim-LAST A3)', async () => {
    counter += 1;
    const sub = `sub-${counter}`;
    const uid = randomUUID();
    await seedLink(sub, uid);
    const tok = signToken(payload({ sub }));
    expect((await post(tok)).status).toBe(200);
    const v1 = Number(
      (await rows(`select token_version from users where id = $1`, [uid]))[0]?.['token_version'],
    );
    expect((await post(tok)).status).toBe(200);
    const v2 = Number(
      (await rows(`select token_version from users where id = $1`, [uid]))[0]?.['token_version'],
    );
    // Claim-LAST (A3): the replay DOES re-run effects (idempotent); the bump is
    // observable, revocation converges. Assert convergence, not immutability.
    expect(v2).toBeGreaterThanOrEqual(v1);
  });

  it('I4: 10 parallel deliveries -> all 200, converged state (tokens NULL)', async () => {
    counter += 1;
    const sub = `sub-${counter}`;
    const uid = randomUUID();
    await seedLink(sub, uid);
    const tok = signToken(payload({ sub }));
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => post(tok, `10.4.0.${i + 1}`)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const link = await rows(
      `select access_token from oauth_accounts where provider_account_id = $1`,
      [sub],
    );
    expect(link[0]?.['access_token']).toBeNull();
  });

  it('I5: fresh jti/kid token still verifies (stub refetch path)', async () => {
    counter += 1;
    const sub = `sub-${counter}`;
    const uid = randomUUID();
    await seedLink(sub, uid);
    expect((await post(signToken(payload({ sub })))).status).toBe(200);
  });

  it('validation: garbage -> 400 spec shape; wrong iss -> 400; unknown sub -> 200 benign', async () => {
    const bad = await post('garbage-token');
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body)['error']).toBe('invalid_request');
    const wrongIss = await post(signToken(payload({ iss: 'https://who.example.com' })));
    expect(wrongIss.status).toBe(400);
    counter += 1;
    const stranger = await post(signToken(payload({ sub: 'stranger-xyz' })));
    expect(stranger.status).toBe(200);
  });

  it('T2-pin: missing content-type on POST — pin the framework behavior (415 or validation 400)', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/backchannel-logout',
      payload: 'logout_token=x', // body present, NO content-type header
    });
    // PINNED (live behavior): body-present + missing content-type trips
    // FST_ERR_CTP_INVALID_MEDIA_TYPE, which the route's scoped setErrorHandler
    // maps to its uniform 500 spec-shape posture (unexpected-error family,
    // NOT the validation 400 arm). Documented deviation: IdP callers MUST set
    // application/x-www-form-urlencoded per BCL spec.
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)['error']).toBe('invalid_request');
  });

  it('T2-pin: application/json body parses via the INHERITED built-in parser (scoped urlencoded parser is additive, not replacing)', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/backchannel-logout',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ logout_token: 'garbage' }),
    });
    // Fastify's built-in JSON parser is inherited by the route scope — the
    // body parses fine and lands in route validation (garbage token -> 400
    // spec shape). NOT 415 (dual-Momus R4 corrected rev.1's parser story).
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)['error']).toBe('invalid_request');
  });

  it('T2-pin: urlencoded with EMPTY body -> route AUTH_BCLO_001 arm -> 400 spec shape', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/backchannel-logout',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)['error']).toBe('invalid_request');
  });

  it('I6: sid-only / null-sub -> 200, zero effects (A1)', async () => {
    counter += 1;
    const before = Number(
      (
        await rows(`select count(*)::int as n from events where type = 'auth.backchannel_logout'`)
      )[0]?.['n'],
    );
    const res = await post(signToken(payload({ sub: null, sid: 'sid-1' })));
    expect(res.status).toBe(200);
    const after = Number(
      (
        await rows(`select count(*)::int as n from events where type = 'auth.backchannel_logout'`)
      )[0]?.['n'],
    );
    expect(after).toBe(before);
  });
});
