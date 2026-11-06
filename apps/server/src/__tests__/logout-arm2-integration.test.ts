/**
 * T1 I1 (gap-remediation 2026-10-12): logout arm-2 (bearer-only) revokes ALL
 * session rows in a real PG — the mock lane cannot prove row effects.
 * Scratch db via the funnel-tx recipe.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_URL = 'postgresql://accessbase:accessbase@localhost:5432/postgres';
const SCRATCH = 'accessbase_logout_it';
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
  process.env['DATABASE_URL'] = URL;
});

afterAll(async () => {
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

describe.skipIf(!pgUp)('logout arm-2 (real PG)', () => {
  it('I1: SessionManager.revokeAllUserSessions marks all rows revoked', async () => {
    const uid = randomUUID();
    await pool.query(
      `insert into users (id, email, name, password_hash, tenant_id, status) values ($1, $2, 'LG', 'x', $3, 'active')`,
      [uid, `${uid}@logout-it.test`, TENANT],
    );
    for (let i = 0; i < 3; i += 1) {
      await pool.query(
        `insert into sessions (id, user_id, token, expires_at) values ($1, $2, $3, now() + interval '1 hour')`,
        [randomUUID(), uid, `tok-${i}`],
      );
    }

    const { SessionManager } = await import('@accessbase/identity');
    const sm = new SessionManager(URL);
    await sm.revokeAllUserSessions(uid);

    const rows = await pool.query(`select revoked_at from sessions where user_id = $1`, [uid]);
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows.every((r) => r['revoked_at'] !== null)).toBe(true);
  });
});
