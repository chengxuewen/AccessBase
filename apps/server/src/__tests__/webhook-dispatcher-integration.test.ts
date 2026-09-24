/**
 * Q4c-T2 dispatcher real-PG integration (spec rev.2 §8.4 + §8.7/8.8 + §5.2).
 * Scratch-DB pattern per revocation-stack.test.ts: full migrate.sh chain
 * onto a run-unique database, pgUp skipIf, 30s timeouts. The dispatcher
 * runs against a plain pg.Pool query seam (the module speaks raw SQL, so
 * the production drizzle adapter is NOT the thing under test here) — the
 * SQL texts ARE the shipped constants (CLAIM_SQL et al. imported).
 *
 * Proves the seams cannot: (a) two concurrent claim transactions never
 * double-claim (FOR UPDATE SKIP LOCKED), (b) the end-to-end fan-out →
 * claim → signed POST → delivered + terminalization round trip with a REAL
 * encryptSecret/decryptSecret roundtrip, (c) the vacuous zero-endpoint
 * terminalization, (d) prune runs even under a disabled kill-switch,
 * (e) suspended tenants' endpoints receive nothing but their events still
 * terminalize, with the DEFAULT-tenant always-live arm.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import pg from 'pg';
import type { WebhookQuery } from '../utils/webhook-dispatcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../../..');
const ADMIN_URL = 'postgresql://accessbase:accessbase@localhost:5432/postgres';
const SCRATCH = `accessbase_q4cwh_${Date.now().toString(36)}`;
const URL = `postgresql://accessbase:accessbase@localhost:5432/${SCRATCH}`;
const PS = path.join(ROOT, '.pixi/envs/native/bin/psql');
const MIGRATE = path.join(ROOT, 'scripts/migrate.sh');
const TENANT = '00000000-0000-0000-0000-000000000001'; // DEFAULT_TENANT

let pgUp = false;
try {
  const p = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
  await p.query('SELECT 1');
  await p.end();
  pgUp = true;
} catch {
  pgUp = false;
}

// decryptSecret derives from JWT_SECRET AT CALL TIME; pin it before any use.
process.env['JWT_SECRET'] = 'q4c-wh-integration-secret';
const { encryptSecret, decryptSecret } = await import('@accessbase/identity');
const { startWebhookDispatcher, CLAIM_SQL } = await import('../utils/webhook-dispatcher.js');

let pool: pg.Pool;

beforeAll(async () => {
  try {
    execFileSync(PS, [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH}`], { stdio: 'ignore' });
  } catch {
    /* next-run beforeAll reclaims */
  }
  execFileSync(PS, [ADMIN_URL, '-qc', `CREATE DATABASE ${SCRATCH}`]);
  execFileSync('bash', [MIGRATE, path.join(ROOT, 'packages/migration/drizzle')], {
    env: {
      ...process.env,
      DATABASE_URL: URL,
      PATH: `${path.join(ROOT, '.pixi/envs/native/bin')}:${process.env['PATH'] ?? ''}`,
    },
  });
  pool = new pg.Pool({ connectionString: URL, max: 6 });
  // Seeded tenants (the always-live arm needs the DEFAULT row present).
  await pool.query(
    `INSERT INTO tenants (id, name, slug, status) VALUES ($1, 'default', 'q4c-def', 'active')`,
    [TENANT],
  );
}, 60_000);

afterAll(async () => {
  await pool?.end().catch(() => undefined);
  try {
    execFileSync(PS, [ADMIN_URL, '-qc', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${SCRATCH}' AND pid <> pg_backend_pid()`], { stdio: 'ignore' });
    execFileSync(PS, [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH}`], { stdio: 'ignore' });
  } catch {
    /* orphan scratch DBs are reclaimed by the next run's prefix sweep */
  }
  try {
    const orphans = execSync(`"${PS}" "${ADMIN_URL}" -tAc "SELECT datname FROM pg_database WHERE datname LIKE 'accessbase_q4cwh_%'"`, { encoding: 'utf8' }).trim();
    for (const name of orphans.split('\n').filter(Boolean)) {
      execSync(`"${PS}" "${ADMIN_URL}" -qc "DROP DATABASE IF EXISTS ${name}"`, { stdio: 'ignore' });
    }
  } catch {
    /* harmless */
  }
});

const seam = (): WebhookQuery => ({
  query: async <T>(text: string, params?: unknown[]): Promise<T[]> => {
    const r = await pool.query(text, params as never[]);
    return r.rows as T[];
  },
});

const uid = () => crypto.randomUUID();

async function mkEvent(tenantId: string, type: string, opts?: { ageDays?: number }): Promise<number> {
  const r = await pool.query(
    `INSERT INTO events (tenant_id, type, payload, created_at)
     VALUES ($1, $2, '{"probe": true}'::jsonb, now() - make_interval(days => $3::int))
     RETURNING id`,
    [tenantId, type, opts?.ageDays ?? 0],
  );
  return Number(r.rows[0]?.['id']);
}

async function mkEndpoint(
  tenantId: string,
  url: string,
  opts?: { active?: boolean; subscribed?: string[]; secret?: string },
): Promise<string> {
  const id = uid();
  await pool.query(
    `INSERT INTO webhook_endpoints (id, tenant_id, url, secret_encrypted, subscribed_events, active)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, tenantId, url, encryptSecret(opts?.secret ?? 's-' + id), opts?.subscribed ?? ['*'], opts?.active ?? true],
  );
  return id;
}

const dispatcher = (over: Partial<Parameters<typeof startWebhookDispatcher>[0]> = {}) =>
  startWebhookDispatcher({
    query: seam(),
    webhooksEnabled: () => true,
    decrypt: decryptSecret,
    fetchImpl: async () => ({ status: 200 }),
    logger: { info: () => undefined, warn: () => undefined },
    ...over,
  });

describe.skipIf(!pgUp)('webhook dispatcher real-PG (Q4c-T2)', () => {
  it('two concurrent claim transactions never double-claim the same delivery', { timeout: 30_000 }, async () => {
    const tenant = uid();
    const ep = uid();
    await pool.query(
      `INSERT INTO tenants (id, name, slug, status) VALUES ($1, 'conc', $2, 'active')`,
      [tenant, `conc-${tenant.slice(0, 8)}`],
    );
    await pool.query(
      `INSERT INTO webhook_endpoints (id, tenant_id, url, secret_encrypted) VALUES ($1, $2, 'http://8.8.8.8/h', $3)`,
      [ep, tenant, encryptSecret('x')],
    );
    const evIds: number[] = [];
    for (let i = 0; i < 30; i++) evIds.push(await mkEvent(tenant, 'user.updated'));
    await pool.query(
      `INSERT INTO webhook_deliveries (event_id, endpoint_id) SELECT unnest($1::bigint[]), $2`,
      [evIds, ep],
    );

    // Concurrent claimers on separate clients; the CTE's FOR UPDATE SKIP
    // LOCKED (with the outer BEGIN holding row locks until COMMIT) is what
    // B's claim must lean on to skip A's locked rows instead of blocking.
    const claimOnce = async (): Promise<number[]> => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await c.query(CLAIM_SQL);
        await c.query('COMMIT');
        return r.rows.map((x: { id: number | string }) => Number(x.id));
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    };
    const [a, b] = await Promise.all([claimOnce(), claimOnce()]);
    const overlap = a.filter((x) => b.includes(x));
    expect(overlap).toEqual([]);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(25); // LIMIT 25 held
    expect(a.length + b.length).toBeLessThanOrEqual(30);
  });

  it('end-to-end: fan-out → claim → HMAC POST (real secret roundtrip) → delivered + terminalized', { timeout: 30_000 }, async () => {
    const secret = 'wh-' + uid();
    await mkEndpoint(TENANT, 'http://8.8.8.8/hook', { secret });
    const ev = await mkEvent(TENANT, 'user.created');
    const fetchImpl = vi.fn(async () => ({ status: 201 }));
    await dispatcher({ fetchImpl }).runOnce();

    const d = await pool.query(
      `SELECT status, response_status, attempts, delivered_at FROM webhook_deliveries WHERE event_id = $1`,
      [ev],
    );
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]?.['status']).toBe('delivered');
    expect(Number(d.rows[0]?.['response_status'])).toBe(201);
    expect(Number(d.rows[0]?.['attempts'])).toBe(1);
    expect(d.rows[0]?.['delivered_at']).not.toBeNull();
    const e = await pool.query(`SELECT fanout_complete_at FROM events WHERE id = $1`, [ev]);
    expect(e.rows[0]?.['fanout_complete_at']).not.toBeNull();

    // Signature verifies under the REAL decrypted secret over the exact sent body.
    const call = fetchImpl.mock.calls[0];
    const init = call?.[1] as { body: string; headers: Record<string, string> };
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(init.body).digest('hex')}`;
    expect(init.headers['x-accessbase-signature']).toBe(expected);
    expect(JSON.parse(init.body)).toMatchObject({ id: ev, type: 'user.created' });
  });

  it('zero endpoints: one tick terminalizes the event (vacuous rule, invariant 8)', { timeout: 30_000 }, async () => {
    const tenant = uid();
    await pool.query(
      `INSERT INTO tenants (id, name, slug, status) VALUES ($1, 'zero', $2, 'active')`,
      [tenant, `zero-${tenant.slice(0, 8)}`],
    );
    const ev = await mkEvent(tenant, 'role.changed'); // no endpoints for this tenant
    await dispatcher().runOnce();
    const e = await pool.query(`SELECT fanout_complete_at FROM events WHERE id = $1`, [ev]);
    expect(e.rows[0]?.['fanout_complete_at']).not.toBeNull();
    const d = await pool.query(`SELECT 1 FROM webhook_deliveries WHERE event_id = $1`, [ev]);
    expect(d.rows).toHaveLength(0);
  });

  it('disabled kill-switch: prune still runs, backlog stays untouched', { timeout: 30_000 }, async () => {
    const old = await mkEvent(TENANT, 'user.updated', { ageDays: 8 }); // 8d > 7d retention
    const fresh = await mkEvent(TENANT, 'user.updated');
    await dispatcher({ webhooksEnabled: () => false }).runOnce();
    expect((await pool.query(`SELECT 1 FROM events WHERE id = $1`, [old])).rows).toHaveLength(0);
    const f = await pool.query(`SELECT fanout_complete_at FROM events WHERE id = $1`, [fresh]);
    expect(f.rows[0]?.['fanout_complete_at']).toBeNull(); // no fan-out happened while disabled
  });

  it('tenant status predicate: suspended gets nothing (default tenant still served); both events terminalize', { timeout: 30_000 }, async () => {
    const susp = uid();
    await pool.query(
      `INSERT INTO tenants (id, name, slug, status) VALUES ($1, 'susp', $2, 'suspended')`,
      [susp, `susp-${susp.slice(0, 8)}`],
    );
    const suspEp = await mkEndpoint(susp, 'http://8.8.8.9/susp');
    const suspEv = await mkEvent(susp, 'user.deleted');
    await pool.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [susp]); // belt: create default is active
    await mkEndpoint(TENANT, 'http://8.8.8.10/def'); // fresh URL — UNIQUE(tenant,url)
    const defEv = await mkEvent(TENANT, 'user.deleted');
    const fetchImpl = vi.fn(async () => ({ status: 200 }));
    await dispatcher({ fetchImpl }).runOnce();

    const dd = await pool.query(`SELECT status FROM webhook_deliveries WHERE event_id = $1`, [suspEv]);
    expect(dd.rows).toHaveLength(0); // suspended tenant fan-out suppressed (B7)
    const e1 = await pool.query(`SELECT fanout_complete_at FROM events WHERE id = $1`, [suspEv]);
    expect(e1.rows[0]?.['fanout_complete_at']).not.toBeNull(); // still terminalizes (vacuous)
    const e2 = await pool.query(`SELECT fanout_complete_at FROM events WHERE id = $1`, [defEv]);
    expect(e2.rows[0]?.['fanout_complete_at']).not.toBeNull(); // default arm: dispatched + terminal
    const d2 = await pool.query(`SELECT status FROM webhook_deliveries WHERE event_id = $1`, [defEv]);
    expect(d2.rows[0]?.['status']).toBe('delivered');
    expect(suspEp).toBeTruthy();
  });

  it('failure backoff is real: 500 response leaves pending with a future next_attempt_at', { timeout: 30_000 }, async () => {
    const ev = await mkEvent(TENANT, 'apikey.revoked');
    await mkEndpoint(TENANT, 'http://8.8.8.11/fail', { subscribed: ['apikey.revoked'] });
    await dispatcher({ fetchImpl: async () => ({ status: 500 }) }).runOnce();
    const d = await pool.query(
      `SELECT status, attempts, last_error, next_attempt_at, delivered_at FROM webhook_deliveries WHERE event_id = $1`,
      [ev],
    );
    expect(d.rows[0]?.['status']).toBe('pending');
    expect(Number(d.rows[0]?.['attempts'])).toBe(1);
    expect(d.rows[0]?.['last_error']).toBe('http-500');
    expect(new Date(String(d.rows[0]?.['next_attempt_at'])) > new Date()).toBe(true);
    expect(d.rows[0]?.['delivered_at']).toBeNull();
  });
});
