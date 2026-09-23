/**
 * Batch P W1-4 integration: rotateRefreshToken on REAL PostgreSQL.
 * Locks the atomic-burn semantics: concurrent double-rotate yields exactly one
 * winner WITHOUT burning the family (grace classifier), serial replay AFTER
 * the grace window still revokes everything, expired rows never rotate.
 * Whole file skips cleanly when PG is unreachable (H′ signal discipline,
 * harness copied from oidc-persistence.test.ts per PIT-033).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';

const ADMIN_URL = 'postgresql://accessbase:accessbase@localhost:5432/postgres';
const SCRATCH = 'accessbase_session_rotate_it';
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
const managers: { close: () => Promise<void> }[] = [];

async function makeManager() {
  const { SessionManager } = await import('@accessbase/identity');
  const m = new SessionManager(URL, null);
  managers.push(m); // structurally compatible — SessionManager.close() is public
  return m;
}

async function seedUser(email: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, name, status, tenant_id) VALUES ($1,$2,$3,'active',$4)`,
    [id, email, 'Rotate Tester', '00000000-0000-0000-0000-000000000001'],
  );
  return id;
}

async function revokedCount(userId: string): Promise<number> {
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NOT NULL`,
    [userId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

const META = { ip: '127.0.0.1', userAgent: 'rotate-it' };

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
  for (const m of managers) await m.close();
  execFileSync(PS, [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH}`]);
});

describe.skipIf(!pgUp)('rotateRefreshToken — atomic burn (W1-4)', () => {
  it('concurrent rotate of one token: exactly one winner, family NOT burned', async () => {
    const mgr = await makeManager();
    const userId = await seedUser(`rot-concurrent-${Date.now()}@it.test`);
    const { refreshToken } = await mgr.issueRefreshToken(randomUUID(), userId, META);

    const results = await Promise.allSettled([
      mgr.rotateRefreshToken(refreshToken, META),
      mgr.rotateRefreshToken(refreshToken, META),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The loser classifies within the grace window → concurrent error, NOT a
    // family burn (rev.2 R2).
    const err = (rejected[0] as PromiseRejectedResult).reason as Error;
    expect(err.message).toMatch(/concurrent rotation/);
    expect(await revokedCount(userId)).toBe(0);
  });

  it('serial replay after the grace window burns the whole family', async () => {
    const mgr = await makeManager();
    const userId = await seedUser(`rot-replay-${Date.now()}@it.test`);
    const { refreshToken } = await mgr.issueRefreshToken(randomUUID(), userId, META);

    // First rotation succeeds and creates the child session.
    await mgr.rotateRefreshToken(refreshToken, META);
    // Age the burn stamp beyond REPLAY_GRACE_MS (10s) — simulate a replay
    // attempt minutes after legitimate use.
    await pool.query(
      `UPDATE sessions SET used_at = now() - interval '60 seconds' WHERE user_id = $1 AND used_at IS NOT NULL`,
      [userId],
    );

    await expect(mgr.rotateRefreshToken(refreshToken, META)).rejects.toThrow(
      /Token reuse detected/,
    );
    // Family burn: every session row for the user is now revoked.
    expect(await revokedCount(userId)).toBeGreaterThan(0);
  });

  it('expired session never rotates (guard inside the atomic UPDATE)', async () => {
    const mgr = await makeManager();
    const userId = await seedUser(`rot-expired-${Date.now()}@it.test`);
    const sessionId = randomUUID();
    const { refreshToken } = await mgr.issueRefreshToken(sessionId, userId, META);
    await pool.query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = $1`, [
      sessionId,
    ]);

    await expect(mgr.rotateRefreshToken(refreshToken, META)).rejects.toThrow(/Session expired/);
    const r = await pool.query(`SELECT used_at FROM sessions WHERE id = $1`, [sessionId]);
    expect(r.rows[0]?.used_at).toBeNull(); // not marked used by the failed attempt
  });
});
