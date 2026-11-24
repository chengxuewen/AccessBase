/**
 * 4A items 1 — real-PG integration batteries for the two NEW drainers
 * (CAEP SET push + audit export). Scratch-DB pattern per
 * webhook-dispatcher-integration.test.ts: full migrate.sh chain onto a
 * run-unique database, pgUp skipIf, 30s timeouts, plain pg.Pool seam.
 *
 * Proves what the scripted seams cannot:
 *   (a) CAEP end-to-end: seed client + pending row → claim → SIGNED SET →
 *       delivered stamp — with webhook tables staying EMPTY (mechanism
 *       independence, F-08 runtime proof), retry keeping the SAME jti, and
 *       orphaned rows dead-lettering with evidence (P-8).
 *   (b) Exporter end-to-end: seed destination (REAL encryptSecret roundtrip)
 *       + audit rows → contiguous delivery with HMAC + cursor advance, the
 *       gap two-tick dance on REAL seq values, and the erased-row marker.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import crypto, { generateKeyPairSync, createPublicKey, createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { jwtVerify } from 'jose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../../..');
const ADMIN_URL = 'postgresql://accessbase:accessbase@localhost:5432/postgres';
const SCRATCH = `accessbase_4adr_${Date.now().toString(36)}`;
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

// decryptSecret derives from JWT_SECRET AT CALL TIME; pin before any import.
process.env['JWT_SECRET'] = '4a-drainers-integration-secret';
const { encryptSecret, CAEP_EVENT_TYPES } = await import('@accessbase/identity');
const { startCaepDispatcher } = await import('../utils/caep-dispatcher.js');
const { startAuditExporter } = await import('../utils/audit-exporter.js');

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIV_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUB_KEY = createPublicKey(
  publicKey.export({ type: 'spki', format: 'pem' }).toString(),
);

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
}, 60_000);

afterAll(async () => {
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
    /* orphan scratch DBs reclaimed by the prefix sweep below */
  }
  try {
    const orphans = execSync(
      `"${PS}" "${ADMIN_URL}" -tAc "SELECT datname FROM pg_database WHERE datname LIKE 'accessbase_4adr_%'"`,
      { encoding: 'utf8' },
    ).trim();
    for (const name of orphans.split('\n').filter(Boolean)) {
      execSync(`"${PS}" "${ADMIN_URL}" -qc "DROP DATABASE IF EXISTS ${name}"`, { stdio: 'ignore' });
    }
  } catch {
    /* harmless */
  }
});

const seam = () => ({
  query: async <T>(text: string, params?: unknown[]): Promise<T[]> => {
    const r = await pool.query(text, params as never[]);
    return r.rows as T[];
  },
});

const uid = () => crypto.randomUUID();

async function mkClient(caepUri: string): Promise<{ id: string; clientId: string }> {
  const id = uid();
  const clientId = 'ab_' + id.slice(0, 12);
  await pool.query(
    `INSERT INTO oidc_clients (id, client_id, name, secret_encrypted, redirect_uris, grant_types, scope)
     VALUES ($1, $2, 'rp', 'v1:x', '["https://rp.example/cb"]'::jsonb, '["authorization_code"]'::jsonb, 'openid')`,
    [id, clientId],
  );
  await pool.query(`UPDATE oidc_clients SET caep_endpoint_uri = $1 WHERE id = $2`, [caepUri, id]);
  return { id, clientId };
}

async function mkCaepRow(clientId: string, subjectId: string): Promise<{ id: number; jti: string }> {
  const jti = uid();
  const r = await pool.query(
    `INSERT INTO caep_deliveries (tenant_id, client_id, event_type, subject_id, jti)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [TENANT, clientId, CAEP_EVENT_TYPES.suspended, subjectId, jti],
  );
  return { id: Number(r.rows[0]?.['id']), jti };
}

const caepDispatcher = (fetchImpl: (url: string, init: Record<string, unknown>) => Promise<{ status: number }>) =>
  startCaepDispatcher({
    query: seam(),
    issuer: 'https://idp.example/oidc',
    signingKeyPem: () => PRIV_PEM,
    fetchImpl,
    dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }], // public leg
    logger: { info: () => undefined, warn: () => undefined },
    bootDelayMs: 60_000,
    intervalMs: 60_000,
  });

describe.skipIf(!pgUp)('CAEP drainer real-PG (4A T1)', () => {
  it(
    'end-to-end: pending row → claim → SIGNED SET → delivered; webhook tables stay EMPTY (F-08)',
    { timeout: 30_000 },
    async () => {
      const client = await mkClient('https://receiver.example/caep');
      const subject = uid();
      const row = await mkCaepRow(client.id, subject);
      const fetchImpl = vi.fn(async () => ({ status: 202 }));
      await caepDispatcher(fetchImpl).runOnce();

      const d = await pool.query(
        `SELECT status, response_status, attempts, delivered_at FROM caep_deliveries WHERE id = $1`,
        [row.id],
      );
      expect(d.rows[0]?.['status']).toBe('delivered');
      expect(Number(d.rows[0]?.['response_status'])).toBe(202);
      expect(Number(d.rows[0]?.['attempts'])).toBe(1);
      expect(d.rows[0]?.['delivered_at']).not.toBeNull();

      // The SET verifies against the DEDICATED key with the shipped profile.
      const init = fetchImpl.mock.calls[0]?.[1] as { body: string; headers: Record<string, string> };
      const { payload, protectedHeader } = await jwtVerify(init.body, PUB_KEY);
      expect(protectedHeader.typ).toBe('secevent+jwt');
      expect(protectedHeader.kid).toBe('set-signing');
      // aud is the RECEIVER'S ab_-prefixed client_id (not the FK uuid).
      expect(payload.aud).toBe(client.clientId);
      expect(payload.jti).toBe(row.jti);
      expect(payload.txn).toBe(String(row.id));
      const events = payload.events as Record<string, { subject: { sub: string } }>;
      expect(Object.keys(events)).toEqual([CAEP_EVENT_TYPES.suspended]);
      const evtBody = events[CAEP_EVENT_TYPES.suspended];
      if (!evtBody) throw new Error('event body missing');
      expect(evtBody.subject.sub).toBe(subject);

      // F-08 runtime proof: NOTHING leaked into the webhook engine's tables.
      const w = await pool.query('SELECT count(*)::int AS n FROM webhook_deliveries');
      expect(w.rows[0]?.['n']).toBe(0);
      const e = await pool.query('SELECT count(*)::int AS n FROM events');
      expect(e.rows[0]?.['n']).toBe(0);
    },
  );

  it(
    'retry keeps the SAME jti on real rows (at-least-once dedup key never rotates)',
    { timeout: 30_000 },
    async () => {
      const client = await mkClient('https://retry.example/caep');
      const row = await mkCaepRow(client.id, uid());
      let calls = 0;
      const bodies: string[] = [];
      const d = caepDispatcher(async (_u, init) => {
        calls += 1;
        bodies.push(String(init['body']));
        return calls === 1 ? { status: 500 } : { status: 200 };
      });
      await d.runOnce();
      // pull the retry back into the claimable window, then deliver
      await pool.query(`UPDATE caep_deliveries SET next_attempt_at = now() - interval '1 minute' WHERE id = $1`, [row.id]);
      await d.runOnce();

      const st = await pool.query(`SELECT status FROM caep_deliveries WHERE id = $1`, [row.id]);
      expect(st.rows[0]?.['status']).toBe('delivered');
      const firstBody = bodies[0];
      const secondBody = bodies[1];
      if (!firstBody || !secondBody) throw new Error('expected two SET deliveries');
      const jti1 = (await jwtVerify(firstBody, PUB_KEY)).payload.jti;
      const jti2 = (await jwtVerify(secondBody, PUB_KEY)).payload.jti;
      expect(jti1).toBe(row.jti);
      expect(jti2).toBe(row.jti);
    },
  );

  it(
    'client deleted mid-flight → row dead-letters with evidence preserved (P-8)',
    { timeout: 30_000 },
    async () => {
      const client = await mkClient('https://gone.example/caep');
      const row = await mkCaepRow(client.id, uid());
      await pool.query(`DELETE FROM oidc_clients WHERE id = $1`, [client.id]); // FK SET NULL fires
      const fetchImpl = vi.fn(async () => ({ status: 200 }));
      await caepDispatcher(fetchImpl).runOnce();

      const d = await pool.query(
        `SELECT status, dead_reason FROM caep_deliveries WHERE id = $1`,
        [row.id],
      );
      expect(d.rows[0]?.['status']).toBe('dead');
      expect(d.rows[0]?.['dead_reason']).toBe('client deleted');
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});

async function mkDestination(url: string, secret: string): Promise<string> {
  const id = uid();
  await pool.query(
    `INSERT INTO audit_export_destinations (id, url, secret_encrypted) VALUES ($1, $2, $3)`,
    [id, url, encryptSecret(secret)],
  );
  return id;
}

async function mkAuditRow(opts?: { erased?: boolean; decision?: boolean }): Promise<number> {
  const r = await pool.query(
    `INSERT INTO audit_logs (tenant_id, user_id, action, response_status, decision, erased_at)
     VALUES ($1, $2, 'CREATE', 201,
             $3::jsonb,
             CASE WHEN $4::boolean THEN now() ELSE NULL END)
     RETURNING seq`,
    [TENANT, uid(), opts?.decision ? '{"decision":"allow","matchedCode":"users:write"}' : null, opts?.erased ?? false],
  );
  return Number(r.rows[0]?.['seq']);
}

const exporter = (fetchImpl: (url: string, init: Record<string, unknown>) => Promise<{ status: number }>) =>
  startAuditExporter({
    query: seam(),
    fetchImpl,
    dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
    logger: { info: () => undefined, warn: () => undefined },
    bootDelayMs: 60_000,
    intervalMs: 60_000,
  });

describe.skipIf(!pgUp)('audit exporter real-PG (4A T2)', () => {
  it(
    'end-to-end: real secret roundtrip → HMAC envelope → cursor advances; erased rows marked',
    { timeout: 30_000 },
    async () => {
      const secret = 'exp-' + uid();
      // isolate: earlier tests' destinations must not join this tick
      await pool.query(`UPDATE audit_export_destinations SET active = false`);
      const dest = await mkDestination('https://siem.example/audit', secret);
      const s1 = await mkAuditRow(); // plain
      const s2 = await mkAuditRow({ erased: true }); // scrubbed-form row (PH-2)
      const s3 = await mkAuditRow({ decision: true }); // decision passthrough
      const seqs = [s1, s2, s3].sort((a, b) => a - b);

      const fetchImpl = vi.fn(async () => ({ status: 200 }));
      await exporter(fetchImpl).runOnce();

      const c = await pool.query(`SELECT last_delivered_seq, skipped_seq FROM audit_export_destinations WHERE id = $1`, [dest]);
      expect(Number(c.rows[0]?.['last_delivered_seq'])).toBe(seqs[2]);
      expect(c.rows[0]?.['skipped_seq']).toEqual([]);

      const init = fetchImpl.mock.calls[0]?.[1] as { body: string; headers: Record<string, string> };
      const expected = `sha256=${createHmac('sha256', secret).update(init.body).digest('hex')}`;
      expect(init.headers['x-accessbase-audit-signature']).toBe(expected);
      const envelope = JSON.parse(init.body) as {
        schemaVersion: number;
        watermarkSeq: number;
        rows: Array<{ seq: number; erased: boolean; decision: unknown; row_hash: string | null }>;
      };
      expect(envelope.schemaVersion).toBe(1);
      expect(envelope.watermarkSeq).toBe(seqs[2]);
      expect(envelope.rows.map((r) => r.seq)).toEqual(seqs);
      const erasedRow = envelope.rows.find((r) => r.seq === s2);
      if (!erasedRow) throw new Error('erased row missing');
      expect(erasedRow.erased).toBe(true);
      const decisionRow = envelope.rows.find((r) => r.seq === s3);
      if (!decisionRow) throw new Error('decision row missing');
      expect(decisionRow.decision).toEqual({ decision: 'allow', matchedCode: 'users:write' });
      expect(envelope.rows.every((r) => r.row_hash === null)).toBe(true); // not yet anchored
    },
  );

  it(
    'gap two-tick dance on REAL seq values: hold → skipped_seq → deliver past',
    { timeout: 30_000 },
    async () => {
      // isolate: only THIS destination is active for the two-tick dance
      await pool.query(`UPDATE audit_export_destinations SET active = false`);
      const dest = await mkDestination('https://gap.example/audit', 'gap-' + uid());
      // PH-3: a destination created via the ROUTE starts at the current max;
      // this battery seeds rows directly, so mirror the same contract here.
      const before = await pool.query(
        `UPDATE audit_export_destinations SET last_delivered_seq = (SELECT COALESCE(max("seq"), 0) FROM audit_logs) WHERE id = $1 RETURNING last_delivered_seq`,
        [dest],
      );
      const cursorBefore = Number(before.rows[0]?.['last_delivered_seq']);
      const gA = await mkAuditRow();
      const gB = await mkAuditRow(); // will be DELETED (rollback hole)
      const gC = await mkAuditRow();
      const hole = [gA, gB, gC].sort((a, b) => a - b)[1];
      if (!(gA < gB && gB < gC) && !(gC < gB && gB < gA)) {
        throw new Error('unexpected seq ordering');
      }
      await pool.query(`DELETE FROM audit_logs WHERE seq = $1`, [hole]);

      const held = vi.fn(async () => ({ status: 200 }));
      await exporter(held).runOnce();
      // tick 1: gap at the hole → NOTHING delivered, hole recorded
      expect(held).not.toHaveBeenCalled();
      const mid = await pool.query(`SELECT last_delivered_seq, skipped_seq FROM audit_export_destinations WHERE id = $1`, [dest]);
      expect(Number(mid.rows[0]?.['last_delivered_seq'])).toBe(cursorBefore); // unchanged
      expect(mid.rows[0]?.['skipped_seq']).toEqual([hole]);

      const delivered = vi.fn(async () => ({ status: 200 }));
      await exporter(delivered).runOnce();
      // tick 2: hole conclusively skipped → both survivors delivered in ONE envelope
      expect(delivered).toHaveBeenCalledTimes(1);
      const init = delivered.mock.calls[0]?.[1] as { body: string };
      const envelope = JSON.parse(init.body) as { watermarkSeq: number; rows: Array<{ seq: number }> };
      expect(envelope.watermarkSeq).toBe(Math.max(gA, gC));
      expect(envelope.rows.map((r) => r.seq)).toEqual([Math.min(gA, gC), Math.max(gA, gC)]);
      const end = await pool.query(`SELECT last_delivered_seq, skipped_seq FROM audit_export_destinations WHERE id = $1`, [dest]);
      expect(Number(end.rows[0]?.['last_delivered_seq'])).toBe(Math.max(gA, gC));
      expect(end.rows[0]?.['skipped_seq']).toEqual([hole]); // forensic record kept
    },
  );
});
