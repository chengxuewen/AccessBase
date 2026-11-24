/**
 * 4A T2 — audit exporter unit battery (spec rev.4 §3 T2; P-4=A gap-aware
 * cursor, F-12 HMAC envelope, PH-2 erased marker, sec M-1 GREATEST guard).
 * Scripted query seam; the HMAC sink recomputes the signature to prove the
 * envelope contract.
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { startAuditExporter, type AuditExporterDeps } from '../utils/audit-exporter.js';

const SECRET = 'test-hmac-secret';

interface DestRow {
  id: string;
  url: string;
  secret_encrypted: string;
  active: boolean;
  last_delivered_seq: string | number;
  skipped_seq: unknown;
}

interface AuditRow {
  id: string;
  seq: string;
  tenant_id: string | null;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  response_status: number | null;
  request_id: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  decision: { decision: string; matchedCode: string; scope?: string } | null;
  erased: boolean;
  row_hash: string | null;
}

function destRow(overrides: Partial<DestRow> = {}): DestRow {
  return {
    id: 'dest-1',
    url: 'https://siem.example/audit',
    secret_encrypted: SECRET, // bare passthrough — decryptSecret accepts bare
    active: true,
    last_delivered_seq: 5,
    skipped_seq: [],
    ...overrides,
  };
}

function auditRow(seq: number, overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: `row-${seq}`,
    seq: String(seq),
    tenant_id: '00000000-0000-4000-8000-000000000001',
    user_id: '00000000-0000-4000-8000-000000000002',
    action: 'CREATE',
    resource_type: 'user',
    resource_id: 'r1',
    response_status: 201,
    request_id: `req-${seq}`,
    ip: '10.0.0.9',
    user_agent: 'vitest',
    created_at: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
    decision: { decision: 'allow', matchedCode: 'users:write' },
    erased: false,
    row_hash: `hash-${seq}`,
    // requestBody deliberately ABSENT — the exporter must never carry it (PH-2/M5).
    ...overrides,
  };
}

interface Harness {
  exporter: { runOnce: () => Promise<void> };
  fetches: Array<{ url: string; headers: Record<string, unknown>; body: string }>;
  updates: Array<{ text: string; params: unknown[] }>;
}

function harness(
  destinations: DestRow[],
  auditRows: AuditRow[],
  opts: { fetch?: (url: string) => Promise<{ status: number }> } = {},
): Harness {
  const fetches: Array<{ url: string; headers: Record<string, unknown>; body: string }> = [];
  const updates: Array<{ text: string; params: unknown[] }> = [];
  const deps: AuditExporterDeps = {
    query: {
      query: async (text: string, params?: unknown[]) => {
        // Route on stable substrings (the SQL spans lines — match loosely).
        if (text.includes('row_hash FROM audit_logs')) {
          return auditRows.map((r) => ({ id: r.id, row_hash: `hash-${r.seq}` }));
        }
        if (text.includes('FROM audit_logs') && text.includes('seq >')) return auditRows;
        if (text.includes('FROM audit_export_destinations')) return destinations;
        updates.push({ text, params: params ?? [] });
        return [];
      },
    },
    fetchImpl: async (url, init) => {
      const headers = (init['headers'] ?? {}) as Record<string, unknown>;
      fetches.push({ url, headers, body: String(init['body']) });
      if (opts.fetch) return opts.fetch(url);
      return { status: 200 };
    },
    logger: { info: () => undefined, warn: () => undefined },
    decrypt: (blob: string) => blob, // bare passthrough — the secret IS the test HMAC key
    dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }], // delivery-time SSRF leg: public
    bootDelayMs: 60_000, // the timer must never race the direct driver
    intervalMs: 60_000,
  };
  const exporter = startAuditExporter(deps);
  return { exporter, fetches, updates };
}

const lastUpdate = (h: Harness): { text: string; params: unknown[] } => {
  const u = h.updates.at(-1);
  if (!u) throw new Error('expected an UPDATE stamp');
  return u;
};

/** Throw-guard first element (no non-null assertions — repo lint doctrine). */
const firstOf = <T>(arr: T[]): T => {
  const v = arr[0];
  if (v === undefined) throw new Error('expected at least one element');
  return v;
};

describe('audit exporter (P-4=A gap-aware cursor)', () => {
  it('contiguous delivery: envelope + HMAC verify at sink + GREATEST advance', async () => {
    const dest = destRow(); // cursor 5
    const h = harness([dest], [auditRow(6), auditRow(7)]);
    await h.exporter.runOnce();

    expect(h.fetches).toHaveLength(1);
    const f = firstOf(h.fetches);
    const envelope = JSON.parse(f.body) as {
      schemaVersion: number;
      destinationId: string;
      watermarkSeq: number;
      rows: Array<Record<string, unknown>>;
    };
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.destinationId).toBe(dest.id);
    expect(envelope.watermarkSeq).toBe(7);
    expect(envelope.rows).toHaveLength(2);

    // F-12: transport auth is the per-destination HMAC over the FULL body.
    const expectedSig = `sha256=${createHmac('sha256', SECRET).update(f.body).digest('hex')}`;
    expect(f.headers['x-accessbase-audit-signature']).toBe(expectedSig);

    // PH-2/M5: highest-PII field never exported; decision + erased marker do.
    expect(JSON.stringify(f.body)).not.toContain('requestBody');
    expect(firstOf(envelope.rows)['decision']).toEqual({
      decision: 'allow',
      matchedCode: 'users:write',
    });

    // GREATEST advance to the watermark (sec M-1).
    const u = lastUpdate(h);
    expect(u.text).toContain('GREATEST');
    expect(Number(u.params[1])).toBe(7);
  });

  it('gap held: missing seq recorded into skipped_seq, cursor frozen, NOTHING past the gap sent', async () => {
    const dest = destRow({ skipped_seq: [] });
    const h = harness([dest], [auditRow(7)]); // seq 6 missing → gap at 6
    await h.exporter.runOnce();

    expect(h.fetches).toHaveLength(0);
    const u = lastUpdate(h);
    expect(u.text).toContain('skipped_seq');
    expect(JSON.parse(String(u.params[1]))).toEqual([6]);
    // NO cursor advance stamp after the skip (held).
  });

  it('second sighting of a recorded gap: walks THROUGH, delivers post-gap rows', async () => {
    const dest = destRow({ skipped_seq: [6] }); // 6 conclusively skipped
    const h = harness([dest], [auditRow(7), auditRow(8)]);
    await h.exporter.runOnce();

    expect(h.fetches).toHaveLength(1);
    const envelope = JSON.parse(firstOf(h.fetches).body) as { watermarkSeq: number };
    expect(envelope.watermarkSeq).toBe(8);
    const u = lastUpdate(h);
    expect(Number(u.params[1])).toBe(8);
  });

  it('receiver failure: cursor NOT advanced (at-least-once — rows re-deliver next tick)', async () => {
    const h = harness([destRow()], [auditRow(6)], { fetch: async () => ({ status: 500 }) });
    await h.exporter.runOnce();
    expect(h.updates.filter((u) => u.text.includes('GREATEST'))).toHaveLength(0);
  });

  it('PH-2: erased rows export in scrubbed form with erased:true', async () => {
    const row = auditRow(6, { erased: true, user_id: '[ERASED]' });
    const h = harness([destRow()], [row]);
    await h.exporter.runOnce();
    const envelope = JSON.parse(firstOf(h.fetches).body) as {
      rows: Array<{ erased: boolean; actor: { user_id: string } }>;
    };
    const erasedRow = firstOf(envelope.rows);
    expect(erasedRow.erased).toBe(true);
    expect(erasedRow.actor.user_id).toBe('[ERASED]');
  });
});
