/**
 * R-audit Task A6: verify service unit tests (spec D7).
 *
 * Scripted fake db (no PG): the service receives the drizzle handle and the
 * fake dispatches on real table identity + PgDialect-rendered WHERE text
 * (same proven pattern as helpers/tenant-where.ts). The B1 discipline is the
 * core lock — rows are fetched BY anchor_id membership, never by date-range,
 * and NULL-hash rows inside an anchored span classify `pending-backfill`,
 * never `row-mismatch`. Real-PG tamper detection lives in the integration
 * lane (T-3/T-4/T-11); this suite pins the report logic.
 */
import { describe, it, expect, vi } from 'vitest';
import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core/dialect';
import { rowHash, foldRoot, receiptHash, GENESIS } from '@accessbase/audit';
import { auditLogs, auditChainAnchors, auditErasures } from '@accessbase/identity/db';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

import { verifyAuditChain } from '../utils/audit-verify.js';

// --- fake-db plumbing -------------------------------------------------------

interface FakeRow {
  id: string;
  tenantId: string;
  userId: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  requestBody: unknown;
  responseStatus: number | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  rowHash: string | null;
  anchorId: number | null;
  erasedAt: Date | null;
  erasureId: string | null;
}

interface FakeAnchor {
  id: number;
  day: string;
  seq: number;
  rowCount: number;
  root: string;
  prevRoot: string | null;
  prunedAt: Date | null;
}

interface Script {
  anchors: FakeAnchor[];
  rowsByAnchor: Record<number, FakeRow[]>;
  rowsByErasure: Record<string, FakeRow[]>;
  /** Presumed ledger receipt_hash per erasure id (key present = ledger row exists). */
  erasureReceipts: Record<string, string>;
  unanchoredOldHashed: number; // watchdog count result
  totalHashed: number; // partial-flag count result
}

function makeRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    tenantId: '00000000-0000-0000-0000-000000000001',
    userId: 'u-1',
    action: 'POST /api/v1/users',
    resourceType: 'user',
    resourceId: 'u-9',
    requestBody: { email: 'x@y.z' },
    responseStatus: 201,
    requestId: 'req-1',
    ip: '10.0.0.1',
    userAgent: 'UA',
    createdAt: new Date('2026-09-28T10:00:00Z'),
    rowHash: null,
    anchorId: null,
    erasedAt: null,
    erasureId: null,
    ...overrides,
  };
}

/** Hash a row exactly the way the writer (app.ts sealAuditEntries) does. */
function seal(row: FakeRow): string {
  return rowHash({
    tenantId: row.tenantId,
    userId: row.userId,
    action: row.action,
    resourceType: row.resourceType ?? '',
    resourceId: row.resourceId ?? '',
    requestBody: row.requestBody ?? {},
    responseStatus: row.responseStatus ?? undefined,
    requestId: row.requestId ?? '',
    ip: row.ip ?? '',
    userAgent: row.userAgent ?? '',
    createdAt: row.createdAt,
  });
}

function scriptFrom(anchors: FakeAnchor[], rows: FakeRow[]): Script {
  const rowsByAnchor: Record<number, FakeRow[]> = {};
  const rowsByErasure: Record<string, FakeRow[]> = {};
  for (const r of rows) {
    if (r.anchorId !== null) (rowsByAnchor[r.anchorId] ??= []).push(r);
    if (r.erasureId) (rowsByErasure[r.erasureId] ??= []).push(r);
  }
  return { anchors, rowsByAnchor, rowsByErasure, erasureReceipts: {}, unanchoredOldHashed: 0, totalHashed: rows.length };
}

const dialect = new PgDialect();

function renderWhere(where: unknown): { sql: string; params: unknown[] } {
  if (where == null) return { sql: '', params: [] };
  return dialect.sqlToQuery(where as SQL);
}

function fakeDb(script: Script) {
  const log: string[] = [];
  const db = {
    select: vi.fn(() => ({
      from: (table: unknown) => {
        const tName = getTableName(table as never);
        const run = (where: unknown): Promise<Record<string, unknown>[]> => {
          const { sql, params } = renderWhere(where);
          log.push(`${tName}: ${sql}`);
          if (tName === 'audit_chain_anchors') {
            return Promise.resolve(script.anchors as unknown as Record<string, unknown>[]);
          }
          if (tName === 'audit_erasures') {
            const wanted = params.filter((p): p is string => typeof p === 'string');
            const found = wanted
              .filter((id) => script.erasureReceipts[id] !== undefined)
              .map((id) => ({ id, receiptHash: script.erasureReceipts[id] as string }));
            return Promise.resolve(found as unknown as Record<string, unknown>[]);
          }
          // audit_logs
          if (sql.includes('anchor_id') && sql.includes('is null')) {
            return Promise.resolve([{ n: script.unanchoredOldHashed }]);
          }
          if (sql.includes('erasure_id')) {
            const eid = params.find((p): p is string => typeof p === 'string') ?? '';
            const rows = script.rowsByErasure[eid] ?? [];
            return Promise.resolve(rows.map((r) => ({ rowHash: r.rowHash })) as unknown as Record<string, unknown>[]);
          }
          if (sql.includes('anchor_id')) {
            const id = params.find((p): p is number => typeof p === 'number') ?? -1;
            return Promise.resolve((script.rowsByAnchor[id] ?? []) as unknown as Record<string, unknown>[]);
          }
          return Promise.resolve([{ n: script.totalHashed }]);
        };
        return {
          where: (where?: unknown) => {
            const rowsP = run(where);
            return Object.assign(rowsP, {
              orderBy: () => rowsP,
            });
          },
        };
      },
    })),
    _log: log,
  };
  return db;
}

const DAY = '2026-09-28';

function anchor(id: number, over: Partial<FakeAnchor> = {}): FakeAnchor {
  return { id, day: DAY, seq: 1, rowCount: 0, root: GENESIS, prevRoot: null, prunedAt: null, ...over };
}

describe('verifyAuditChain', () => {
  it('B1 membership: rows are fetched by anchor_id, never by date-range', async () => {
    const r1 = makeRow({ id: 'r1' });
    r1.rowHash = seal(r1);
    r1.anchorId = 1;
    const a = anchor(1, { rowCount: 1, root: foldRoot([r1.rowHash]) });
    const db = fakeDb(scriptFrom([a], [r1]));

    await verifyAuditChain(db as never, { from: DAY, to: DAY, graceSeconds: 90 });
    const logCalls = db._log as string[];
    const logQueries = logCalls.filter((l) => l.startsWith('audit_logs'));
    expect(logQueries.length).toBeGreaterThan(0);
    // The anchor MEMBERSHIP fetch must not carry a created_at range predicate
    // (B1: a backdated row would slip between range boundaries). The budget/
    // watchdog COUNT queries legitimately filter by time — excluded here.
    const membershipFetches = logQueries.filter((q) => q.includes('anchor_id') && !q.includes('is null'));
    expect(membershipFetches.length).toBeGreaterThan(0);
    for (const q of membershipFetches) {
      expect(q).not.toMatch(/created_at.*(>=|<=|between)/i);
    }
  });

  it('green report: consistent anchor folds → chainOk true', async () => {
    const r1 = makeRow({ id: 'r1' });
    r1.rowHash = seal(r1);
    r1.anchorId = 1;
    const r2 = makeRow({ id: 'r2', createdAt: new Date('2026-09-28T10:01:00Z') });
    r2.rowHash = seal(r2);
    r2.anchorId = 1;
    const ordered = [r1, r2]; // fixture: created_at asc == list order
    const a = anchor(1, { rowCount: 2, root: foldRoot(ordered.map((r) => r.rowHash ?? '')) });
    const db = fakeDb(scriptFrom([a], ordered));

    const report = await verifyAuditChain(db as never, { from: DAY, to: DAY, graceSeconds: 90 });
    expect(report.chainOk).toBe(true);
    expect(report.firstFailure).toBeNull();
    expect(report.anchorsChecked).toBe(1);
    expect(report.rowsChecked).toBe(2);
    expect(report.rowsErased).toBe(0);
    expect(report.prunedAnchors).toBe(0);
    expect(report.prunedFrom).toBeNull();
    expect(report.unanchoredRows).toBe(0);
    expect(report.partial).toBe(false);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.from).toBe(DAY);
    expect(report.to).toBe(DAY);
  });

  it('row-mismatch: tampered row content → firstFailure row-mismatch with rowId+day+seq', async () => {
    const r1 = makeRow({ id: 'tampered-row' });
    r1.rowHash = seal(r1);
    r1.anchorId = 1;
    r1.action = 'DELETE /api/v1/users/9'; // tamper AFTER sealing
    const a = anchor(1, { rowCount: 1, root: foldRoot([r1.rowHash]) });
    const db = fakeDb(scriptFrom([a], [r1]));

    const report = await verifyAuditChain(db as never, { from: DAY, to: DAY, graceSeconds: 90 });
    expect(report.chainOk).toBe(false);
    expect(report.firstFailure?.kind).toBe('row-mismatch');
    expect(report.firstFailure?.rowId).toBe('tampered-row');
    expect(report.firstFailure?.day).toBe(DAY);
    expect(report.firstFailure?.seq).toBe(1);
  });

  it('anchor-mismatch: stored root differs from re-fold of intact rows', async () => {
    const r1 = makeRow({ id: 'r1' });
    r1.rowHash = seal(r1);
    r1.anchorId = 1;
    const a = anchor(1, { rowCount: 1, root: 'f'.repeat(64) }); // forged root
    const db = fakeDb(scriptFrom([a], [r1]));

    const report = await verifyAuditChain(db as never, { from: DAY, to: DAY, graceSeconds: 90 });
    expect(report.chainOk).toBe(false);
    expect(report.firstFailure?.kind).toBe('anchor-mismatch');
    expect(report.firstFailure?.day).toBe(DAY);
    expect(report.firstFailure?.seq).toBe(1);
  });

  it('orphan-erasure: erased_at set but no matching ledger row', async () => {
    const r1 = makeRow({
      id: 'orphan-row',
      erasedAt: new Date(),
      erasureId: 'eeeee000-0000-4000-8000-000000000001',
    });
    r1.rowHash = seal(r1);
    r1.anchorId = 1;
    const a = anchor(1, { rowCount: 1, root: foldRoot([r1.rowHash]) });
    // erasure id referenced but NO ledger row scripted (erasureReceipts empty)
    const db = fakeDb(scriptFrom([a], [r1]));

    const report = await verifyAuditChain(db as never, { from: DAY, to: DAY, graceSeconds: 90 });
    expect(report.chainOk).toBe(false);
    expect(report.firstFailure?.kind).toBe('orphan-erasure');
    expect(report.firstFailure?.rowId).toBe('orphan-row');
  });

  it('forged erased_at without erasureId → orphan-erasure (no receipt resolves)', async () => {
    const r1 = makeRow({ id: 'forged', erasedAt: new Date() }); // NO erasureId
    r1.rowHash = seal(r1);
    r1.anchorId = 1;
    const a = anchor(1, { rowCount: 1, root: foldRoot([r1.rowHash]) });
    const db = fakeDb(scriptFrom([a], [r1]));

    const report = await verifyAuditChain(db as never, { from: DAY, to: DAY, graceSeconds: 90 });
    expect(report.chainOk).toBe(false);
    expect(report.firstFailure?.kind).toBe('orphan-erasure');
  });

  it('erased rows with valid ledger pass and count rowsErased (receipt recomputes equal)', async () => {
    const r1 = makeRow({
      id: 'e1',
      erasedAt: new Date(),
      erasureId: 'eeeee000-0000-4000-8000-000000000002',
    });
    r1.rowHash = seal(r1);
    r1.anchorId = 1;
    const rows = [r1];
    // erased rows stay in the anchor fold (row_hash survives D4 scrubbing and
    // is the receipt's provenance) — anchor root covers them like any row
    const a = anchor(1, { rowCount: 1, root: foldRoot(rows.map((r) => r.rowHash ?? '')) });

    const script = scriptFrom([a], rows);
    script.erasureReceipts[r1.erasureId as string] = receiptHash(rows.map((r) => r.rowHash ?? ''));
    const db = fakeDb(script);

    const report = await verifyAuditChain(db as never, { from: DAY, to: DAY, graceSeconds: 90 });
    expect(report.chainOk).toBe(true);
    expect(report.rowsErased).toBe(1);
  });

  it('erasure receipt mismatch (ledger receipt stale) → orphan-erasure', async () => {
    const r1 = makeRow({
      id: 'e2',
      erasedAt: new Date(),
      erasureId: 'eeeee000-0000-4000-8000-000000000003',
    });
    r1.rowHash = seal(r1);
    r1.anchorId = 1;
    const a = anchor(1, { rowCount: 1, root: foldRoot([r1.rowHash]) });

    const script = scriptFrom([a], [r1]);
    // ledger row EXISTS but its receipt_hash does not match the recomputed one
    script.erasureReceipts[r1.erasureId as string] = 'b'.repeat(64);
    const db = fakeDb(script);

    const report = await verifyAuditChain(db as never, { from: DAY, to: DAY, graceSeconds: 90 });
    expect(report.chainOk).toBe(false);
    expect(report.firstFailure?.kind).toBe('orphan-erasure');
    expect(report.firstFailure?.rowId).toBe('e2');
  });

  it('B1: NULL-hash rows inside an anchored span classify pending-backfill, NOT row-mismatch', async () => {
    const r1 = makeRow({ id: 'hashed-1' });
    r1.rowHash = seal(r1);
    r1.anchorId = 1;
    const legacy = makeRow({ id: 'legacy-null', rowHash: null, anchorId: 1 });
    const r2 = makeRow({ id: 'hashed-2', createdAt: new Date('2026-09-28T10:02:00Z') });
    r2.rowHash = seal(r2);
    r2.anchorId = 1;
    // anchor folded ONLY the hashed rows (fold filter row_hash IS NOT NULL)
    const a = anchor(1, { rowCount: 2, root: foldRoot([r1.rowHash ?? '', r2.rowHash ?? '']) });
    const db = fakeDb(scriptFrom([a], [r1, legacy, r2]));

    const report = await verifyAuditChain(db as never, { from: DAY, to: DAY, graceSeconds: 90 });
    expect(report.chainOk).toBe(true);
    expect(report.firstFailure).toBeNull();
    expect(report.legacyPreChain).toBe(1);
  });

  it('pruned anchors skipped; prunedFrom = min pruned day; rows not fetched', async () => {
    const a1 = anchor(1, { day: '2026-09-20', prunedAt: new Date() });
    const a2 = anchor(2, { day: '2026-09-21', prunedAt: new Date() });
    const r3 = makeRow({ id: 'live-1' });
    r3.rowHash = seal(r3);
    r3.anchorId = 3;
    const a3 = anchor(3, { day: '2026-09-28', rowCount: 1, root: foldRoot([r3.rowHash ?? '']) });
    const db = fakeDb(scriptFrom([a1, a2, a3], [r3]));

    const report = await verifyAuditChain(db as never, {
      from: '2026-09-20',
      to: DAY,
      graceSeconds: 90,
    });
    expect(report.chainOk).toBe(true);
    expect(report.prunedAnchors).toBe(2);
    expect(report.prunedFrom).toBe('2026-09-20');
    expect(report.rowsChecked).toBe(1);
    expect(report.anchorsChecked).toBe(1); // only un-pruned anchors count
  });

  it('unanchored watchdog: hashed rows older than grace with no anchor → FAIL unanchored', async () => {
    const db = fakeDb({ ...scriptFrom([], []), unanchoredOldHashed: 3 });

    const report = await verifyAuditChain(db as never, { from: DAY, to: DAY, graceSeconds: 90 });
    expect(report.chainOk).toBe(false);
    expect(report.firstFailure?.kind).toBe('unanchored');
    expect(report.unanchoredRows).toBe(3);
  });

  it('partial flag when total hashed rows exceed maxRows (default 100k)', async () => {
    const db = fakeDb({ ...scriptFrom([], []), totalHashed: 100_001 });

    const report = await verifyAuditChain(db as never, { from: DAY, to: DAY, graceSeconds: 90 });
    expect(report.partial).toBe(true);
  });

  it('under the cap: clean chain stays green and partial stays false', async () => {
    const db = fakeDb({ ...scriptFrom([], []), totalHashed: 99_999 });

    const report = await verifyAuditChain(db as never, {
      from: DAY,
      to: DAY,
      graceSeconds: 90,
      maxRows: 100_000,
    });
    expect(report.partial).toBe(false);
    expect(report.chainOk).toBe(true);
  });
});
