/**
 * R-audit Task A3: the write path seals rows.
 *
 * The injected auditStorage (buildApp seam) must receive entries carrying:
 *  - `createdAt` = the entry's own timestamp (ms precision, Date object),
 *  - `rowHash` = rowHash() over the D1 field set (single-implementation
 *    cross-check via the SAME packages/audit hashing module).
 *
 * Real-PG round-trip probe (plan watchitem, mandated): the sealed row must
 * survive the timestamptz/jsonb round-trip — rowHash recomputed FROM THE
 * STORED ROW equals the stored row_hash, proving ms precision survives the
 * DB round-trip. Scratch DB per funnel-tx-integration idiom; dropped after.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { AuditLog, AuditStorage } from '@accessbase/audit';
import type { IdentityService } from '@accessbase/identity';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

vi.mock('@fastify/cors', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger', () => ({ default: async () => {} }));
vi.mock('@fastify/swagger-ui', () => ({ default: async () => {} }));
vi.mock('@fastify/helmet', () => ({ default: async () => {} }));
vi.mock('@fastify/rate-limit', () => ({ default: async () => {} }));

// R1-T3 telemetry lane (auth-events) is sanctioned fire-and-forget; without a
// real events table it only warns. Muted to keep output clean, not because it
// can fail the run.
vi.spyOn(console, 'error').mockImplementation(() => {});

// D113 setup guard queries users via the managers singleton on EVERY request —
// mock the seam exactly like audit-middleware.test.ts does.
vi.mock('@accessbase/identity', async (importOriginal) => {
  const actual = await importOriginal<IdentityService>();
  return {
    ...actual,
    UserManager: vi.fn().mockImplementation(() => ({
      findByEmail: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' }),
    })),
  };
});

import { rowHash as computeRowHash } from '@accessbase/audit';

const { buildApp } = await import('../app.js');

type Awaited<T> = T extends Promise<infer U> ? U : T;
type App = Awaited<ReturnType<typeof buildApp>>;

/** Captures what AuditLogger hands to the storage seam. */
class MemoryAuditStorage implements AuditStorage {
  readonly entries: AuditLog[] = [];
  async write(entries: AuditLog[]): Promise<void> {
    this.entries.push(...entries);
  }
}

const writeReq = (app: App): ReturnType<App['inject']> =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'nobody@example.com', password: 'wrong-password' },
  });

/** Recompute the expected hash from an entry (same D1 pick as the write path). */
function expectedHash(e: AuditLog): string {
  const requestBody =
    typeof e.requestBody === 'string' ? JSON.parse(e.requestBody) : e.requestBody;
  return computeRowHash({
    tenantId: e.tenantId ?? '',
    userId: e.userId ?? '',
    action: e.action,
    resourceType: e.resourceType ?? '',
    resourceId: e.resourceId ?? '',
    requestBody: requestBody ?? {},
    responseStatus: e.responseStatus,
    requestId: e.requestId ?? '',
    ip: e.userIp ?? '',
    userAgent: e.userAgent ?? '',
    createdAt: e.createdAt as Date,
  });
}

describe('audit write path seals rows (A3, injected storage)', () => {
  let app: App;
  const storage = new MemoryAuditStorage();

  beforeAll(async () => {
    app = await buildApp({ auditStorage: storage as never });
  });

  afterAll(async () => {
    await app.close();
  });

  it('entry carries createdAt==timestamp (ms) and rowHash over D1; perturbation + second entry differ', async () => {
    const res = await writeReq(app);
    expect([200, 401, 403, 429]).toContain(res.statusCode);
    await new Promise((r) => setTimeout(r, 20));

    const first = storage.entries[storage.entries.length - 1];
    expect(first).toBeDefined();

    // (a) createdAt is a Date equal (ms) to entry.timestamp
    expect(first.createdAt).toBeInstanceOf(Date);
    expect(first.createdAt?.getTime()).toBe(first.timestamp.getTime());

    // (b) single-implementation cross-check
    expect(first.rowHash).toBe(expectedHash(first));

    // (c) sanity: perturbing any field changes the hash
    const d1 = {
      tenantId: first.tenantId ?? '',
      userId: first.userId ?? '',
      action: first.action,
      resourceType: first.resourceType ?? '',
      resourceId: first.resourceId ?? '',
      requestBody:
        typeof first.requestBody === 'string' ? JSON.parse(first.requestBody) : first.requestBody,
      responseStatus: first.responseStatus,
      requestId: first.requestId ?? '',
      ip: first.userIp ?? '',
      userAgent: first.userAgent ?? '',
      createdAt: first.createdAt as Date,
    };
    expect(computeRowHash({ ...d1, action: 'DELETE' })).not.toBe(first.rowHash);

    // (d) two sequential entries → two distinct rowHash values
    storage.entries.length = 0;
    const res2 = await writeReq(app);
    expect([200, 401, 403, 429]).toContain(res2.statusCode);
    await new Promise((r) => setTimeout(r, 20));
    const second = storage.entries[storage.entries.length - 1];
    expect(second).toBeDefined();
    expect(second.requestId).not.toBe(first.requestId);
    expect(second.rowHash).not.toBe(first.rowHash);
  });
});

// --- Real-PG round-trip probe (watchitem, mandated) -------------------------
// funnel-tx-integration scratch-DB idiom: dedicated DB, migrate, insert via the
// real drizzle-backed write() mapping, SELECT back, recompute, drop the DB.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_URL = 'postgresql://accessbase:accessbase@localhost:5432/postgres';
const SCRATCH = 'accessbase_audit_seal_it';
const SCRATCH_URL = `postgresql://accessbase:accessbase@localhost:5432/${SCRATCH}`;
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

describe.skipIf(!pgUp)('audit seal round-trip (real PG)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    execFileSync(PS, [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH}`]);
    execFileSync(PS, [ADMIN_URL, '-qc', `CREATE DATABASE ${SCRATCH}`]);
    execFileSync('bash', [MIGRATE, path.join(ROOT, 'packages/migration/drizzle')], {
      env: {
        ...process.env,
        DATABASE_URL: SCRATCH_URL,
        PATH: `${path.join(ROOT, '.pixi/envs/native/bin')}:${process.env['PATH'] ?? ''}`,
      },
    });
    pool = new pg.Pool({ connectionString: SCRATCH_URL });
  });

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
    if (pgUp) {
      execFileSync(PS, [ADMIN_URL, '-qc', `DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`], {
        stdio: 'ignore',
      });
    }
  });

  it('row_hash recomputes equal from the SELECTed row (ms timestamptz + jsonb canonicalization survive)', async () => {
    const { createDb, auditLogs } = await import('@accessbase/identity/db');
    const { rowHash } = await import('@accessbase/audit');
    const db = createDb(SCRATCH_URL);

    const requestBody = { email: 'seal-roundtrip@example.com', password: 'pw' };
    const timestamp = new Date('2026-09-28T12:00:00.123Z');
    const d1 = {
      tenantId: '00000000-0000-0000-0000-000000000001',
      userId: 'anonymous',
      action: 'CREATE',
      resourceType: 'auth',
      resourceId: 'unknown',
      requestBody,
      responseStatus: 401,
      requestId: 'roundtrip-req-1',
      ip: '127.0.0.1',
      userAgent: 'vitest',
    };

    // Mirror of the GREEN write() mapping (scratch URL): Date OBJECT in,
    // node-pg serializes the timestamptz.
    await db.insert(auditLogs).values([
      {
        ...d1,
        createdAt: timestamp,
        rowHash: rowHash({ ...d1, createdAt: timestamp }),
      },
    ]);

    const sel = await pool.query<{
      row_hash: string | null;
      created_at: Date;
      request_body: unknown;
    }>('SELECT row_hash, created_at, request_body FROM audit_logs WHERE request_id = $1', [
      'roundtrip-req-1',
    ]);
    expect(sel.rows).toHaveLength(1);
    const row = sel.rows[0];
    expect(row.row_hash).not.toBeNull();

    // Recompute FROM THE STORED ROW: timestamptz → Date (ms) and jsonb →
    // object (key order canonicalized) must reproduce the stored hash.
    expect(
      rowHash({
        ...d1,
        requestBody: row.request_body as Record<string, unknown>,
        createdAt: row.created_at,
      }),
    ).toBe(row.row_hash);

    // Cleanup: close the drizzle pool BEFORE the FORCE drop (email-templates
    // precedent) — dropping under a live conn emits an unhandled socket error
    // even with WITH (FORCE). Marker-row delete kept for hygiene.
    await pool.query("DELETE FROM audit_logs WHERE request_id = 'roundtrip-req-1'");
    const { closeDb } = await import('@accessbase/identity/db');
    await closeDb(db);
    await pool.end();
  });
});
