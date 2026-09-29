/**
 * R-audit Task A6: audit chain verifier (spec D7).
 *
 * Read-only. Pages anchors in the window ordered (day, seq); per anchor the
 * rows are fetched BY ANCHOR MEMBERSHIP (`anchor_id = X`) — never by a
 * date-range (B1: a backdated row would slip between range boundaries). Per
 * row:
 *   - erased → erasure_id + ledger row required, receipt recomputed over the
 *     affected row-hash set (D5 procedure), mismatch = orphan-erasure FAIL;
 *   - NULL row_hash → pending-backfill / legacy count, NEVER row-mismatch
 *     (B1 — the backfill worker will hash them; absence is not tampering);
 *   - else rowHash() recomputed over stored columns vs stored row_hash →
 *     mismatch = row-mismatch FAIL.
 * Anchor root re-fold order = fold order = `ORDER BY created_at, id` (same
 * string the anchor writer uses — plan watchitem: drift = false alarms).
 * Watchdog AFTER the anchor pass: hashed rows older than the grace window
 * with anchor_id NULL = unanchored FAIL (B5 hole-closer + anchor-stall alarm).
 *
 * Fold/receipt contract (shared with the anchor writer, Task A4): inputs to
 * foldRoot are the `row_hash` values ordered `created_at ASC, id ASC` —
 * EXACTLY that ORDER BY string on both sides, drift = false alarms. Erasure
 * receipts use receiptHash over `row_hash` ordered the same way (D5).
 * firstFailure kind 'unanchored' carries day=from/seq=0 (no anchor context).
 */
import { and, asc, eq, gte, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import type { DrizzleDB } from '@accessbase/identity/db';
import { auditLogs, auditChainAnchors, auditErasures } from '@accessbase/identity/db';
import { rowHash, foldRoot, receiptHash } from '@accessbase/audit';

/** Default per-request row budget (spec R5: LIMIT + partial flag). */
export const DEFAULT_MAX_ROWS = 100_000;

export type VerifyFailureKind =
  | 'row-mismatch'
  | 'anchor-mismatch'
  | 'orphan-erasure'
  | 'unanchored';

export interface VerifyFailure {
  day: string;
  seq: number;
  kind: VerifyFailureKind;
  rowId?: string;
}

export interface VerifyReport {
  from: string;
  to: string;
  rowsChecked: number;
  rowsErased: number;
  erasedLegacyUnhashed: number;
  legacyPreChain: number;
  anchorsChecked: number;
  prunedAnchors: number;
  prunedFrom: string | null;
  unanchoredRows: number;
  chainOk: boolean;
  firstFailure: VerifyFailure | null;
  partial: boolean;
  durationMs: number;
}

export interface VerifyOptions {
  from: string; // ISO date 'YYYY-MM-DD', inclusive
  to: string; // ISO date 'YYYY-MM-DD', inclusive
  graceSeconds: number; // anchor grace window (route passes the config value)
  maxRows?: number;
}

export async function verifyAuditChain(
  db: DrizzleDB,
  opts: VerifyOptions,
): Promise<VerifyReport> {
  const started = Date.now();
  const fromTs = new Date(`${opts.from}T00:00:00Z`);
  const toTs = new Date(`${opts.to}T23:59:59.999Z`);
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;

  const report: VerifyReport = {
    from: opts.from,
    to: opts.to,
    rowsChecked: 0,
    rowsErased: 0,
    erasedLegacyUnhashed: 0,
    legacyPreChain: 0,
    anchorsChecked: 0,
    prunedAnchors: 0,
    prunedFrom: null,
    unanchoredRows: 0,
    chainOk: true,
    firstFailure: null,
    partial: false,
    durationMs: 0,
  };

  const fail = (f: VerifyFailure): void => {
    if (report.chainOk) {
      report.chainOk = false;
      report.firstFailure = f;
    }
  };

  // 0. Row budget (partial flag) — count hashed rows in the window.
  const [budget] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(
      and(
        gte(auditLogs.createdAt, fromTs),
        lte(auditLogs.createdAt, toTs),
        isNotNull(auditLogs.rowHash),
      ),
    );
  report.partial = (budget?.n ?? 0) > maxRows;

  // 1. Anchors in window, ordered (day, seq).
  const anchors = await db
    .select()
    .from(auditChainAnchors)
    .where(and(gte(auditChainAnchors.day, opts.from), lte(auditChainAnchors.day, opts.to)))
    .orderBy(asc(auditChainAnchors.day), asc(auditChainAnchors.seq));

  // Erasure receipts resolved lazily per erasure id and memoized (D5 (b):
  // recompute over the ORIGINAL row-hash set, compare to ledger.receipt_hash).
  const receiptCache = new Map<string, string | null>(); // erasureId → receipt|null (null = ledger miss or mismatch)

  const ledgerReceipt = async (erasureId: string): Promise<string | null> => {
    if (receiptCache.has(erasureId)) return receiptCache.get(erasureId) ?? null;
    const [ledger] = await db.select().from(auditErasures).where(eq(auditErasures.id, erasureId));
    if (!ledger) {
      receiptCache.set(erasureId, null);
      return null;
    }
    const rows = await db
      .select({ rowHash: auditLogs.rowHash })
      .from(auditLogs)
      .where(eq(auditLogs.erasureId, erasureId))
      .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));
    const computed = receiptHash(rows.map((r) => r.rowHash ?? ''));
    const ok = computed === ledger.receiptHash ? computed : null;
    receiptCache.set(erasureId, ok);
    return ok;
  };

  // 2. Per anchor: membership fetch + re-fold + row content checks.
  for (const a of anchors) {
    if (a.prunedAt !== null) {
      // Pruned span: rows are GONE by retention policy; the anchor row itself
      // is the proof-of-existence record. Skip content verification.
      report.prunedAnchors += 1;
      if (report.prunedFrom === null || a.day < report.prunedFrom) report.prunedFrom = a.day;
      continue;
    }
    report.anchorsChecked += 1;

    // B1 MEMBERSHIP fetch — never a date-range.
    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.anchorId, a.id))
      .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));

    const folded: string[] = [];
    for (const row of rows) {
      report.rowsChecked += 1;
      if (row.erasedAt !== null) {
        report.rowsErased += 1;
        if (row.rowHash !== null) {
          // row_hash SURVIVES erasure (D4 column split) and is both the
          // receipt's provenance and part of the anchor fold input — it must
          // re-fold like any other hashed row. Content recomputation is
          // MEANINGLESS here (PII columns were scrubbed) so we skip it and
          // resolve the erasure receipt instead.
          folded.push(row.rowHash);
        } else {
          // scrubbed legacy row — never hashed, never receipt-covered (D6 B6)
          report.erasedLegacyUnhashed += 1;
          continue;
        }
        if (!row.erasureId || (await ledgerReceipt(row.erasureId)) === null) {
          fail({ day: a.day, seq: a.seq, kind: 'orphan-erasure', rowId: row.id });
        }
        continue;
      }
      if (row.rowHash === null) {
        // B1: absence of a hash inside an anchored span is a backfill-pending
        // state, NOT tampering. Counted, never row-mismatch.
        report.legacyPreChain += 1;
        continue;
      }
      folded.push(row.rowHash);
      const recomputed = rowHash({
        tenantId: row.tenantId ?? '',
        userId: row.userId ?? '',
        action: row.action,
        resourceType: row.resourceType ?? '',
        resourceId: row.resourceId ?? '',
        requestBody: (row.requestBody as Record<string, unknown>) ?? {},
        responseStatus: row.responseStatus ?? undefined,
        requestId: row.requestId ?? '',
        ip: row.ip ?? '',
        userAgent: row.userAgent ?? '',
        createdAt: row.createdAt,
      });
      if (recomputed !== row.rowHash) {
        fail({ day: a.day, seq: a.seq, kind: 'row-mismatch', rowId: row.id });
      }
    }

    const recomputedRoot = foldRoot(folded);
    if (recomputedRoot !== a.root) {
      fail({ day: a.day, seq: a.seq, kind: 'anchor-mismatch' });
    }
  }

  // 3. Watchdog (B5): hashed-but-never-anchored rows older than the grace
  // window — backdated forged inserts AND anchor-worker stalls both land here.
  const cutoff = new Date(Date.now() - opts.graceSeconds * 1000);
  const [stale] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(
      and(
        isNotNull(auditLogs.rowHash),
        isNull(auditLogs.anchorId),
        lt(auditLogs.createdAt, cutoff),
      ),
    );
  report.unanchoredRows = stale?.n ?? 0;
  if (report.unanchoredRows > 0) {
    fail({ day: opts.from, seq: 0, kind: 'unanchored' });
  }

  report.durationMs = Date.now() - started;
  return report;
}
