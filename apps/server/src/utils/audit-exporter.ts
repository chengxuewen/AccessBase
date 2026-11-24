/**
 * 4A T2 — audit export drainer (spec rev.4 §3 T2; rulings P-1=C / P-4=A /
 * P-5=A). Ships audit rows to registered HTTP destinations in order, with a
 * per-destination cursor ON the destination row (no queue table — the
 * append-only audit_logs table IS the durable queue; zero double-write).
 *
 * Gap-aware cursor (P-4=A, panel run 2 PC-1): seq is allocated at INSERT and
 * visible at COMMIT — a slow transaction can hold seq=100 while 101 is
 * already delivered. A naive "advance to max seen" would strand 100 FOREVER.
 * The walk therefore advances ONLY through contiguous seq:
 *   - rows are read `seq > cursor ORDER BY seq ASC LIMIT batch`;
 *   - a gap (missing seq) is APPENDED to the destination's skipped_seq on
 *     first sight and the whole batch is HELD (nothing delivered, no
 *     advance — the contiguous prefix is delayed one tick, never lost);
 *   - on the NEXT sighting the missing seqs are already in skipped_seq →
 *     the walk advances THROUGH them (they are conclusively never coming —
 *     sequence values from rolled-back inserts) and delivery resumes past
 *     the gap. skipped_seq entries are the forensic record ("this seq was
 *     conclusively not delivered — rolled back"); they are the documented
 *     residual: a row whose transaction stays uncommitted across one full
 *     tick interval is skipped-and-logged, never silently lost twice.
 *   - DELIVERY-TIME SSRF (F-05, review #1): every tick re-runs the
 *     fail-closed structural + DNS gates on the destination URL — a URL
 *     that re-resolves into the deny-set after registration is refused
 *     (held, loud) before any fetch.
 *
 * Delivery (F-12 / sec L-1): the envelope {schemaVersion, destinationId,
 * watermarkSeq, timestamp, rows[]} is HMAC-signed with the destination's
 * secret — rowHash travels as chain provenance ONLY, never as transport auth.
 * Rows are OCSF-aligned projections; requestBody is deliberately NOT exported
 * (highest-PII field — receivers verify rows against the platform via
 * row_hash, T6 documents the consumer contract). Erased rows export in their
 * scrubbed form with `erased:true` (PH-2).
 *
 * Multi-instance safety (sec M-1): cursor advance uses GREATEST() so a slow
 * instance can never REGRESS the cursor (regression = re-export loops);
 * double-SEND remains possible under concurrent exporters — at-least-once
 * with seq-keyed dedup on the receiver is the contract.
 *
 * Lifecycle: retention-sweeper/dispatcher family (lazy pool, unref'd timers,
 * stop() closes, never throws, every externality injected).
 */
import { createHmac } from 'node:crypto';
import { logger } from '@accessbase/logging';
import { decryptSecret as identityDecryptSecret } from '@accessbase/identity';
import type { WebhookQuery } from './webhook-dispatcher.js';
import { assertWebhookUrl, resolveDeniedIps } from './webhook-url.js';

export const AUDIT_EXPORT_SCHEMA_VERSION = 1;
const BATCH_LIMIT = 500;
const FETCH_TIMEOUT_MS = 10_000;
const SKIPPED_FORENSICS_CAP = 1000;

export interface AuditExporterDeps {
  /** Lazy production handle; created on first tick, closed by stop(). */
  makeDb?: () => WebhookQuery;
  /** Test seam: scripted handle — takes precedence over makeDb, never closed. */
  query?: WebhookQuery;
  /** Injected fetch (global fetch in prod) — units dial NOTHING. */
  fetchImpl: (url: string, init: Record<string, unknown>) => Promise<{ status: number }>;
  /** Destination secret decrypt (identity v2/v1/bare envelope; injectable). */
  decrypt?: (blob: string) => string;
  /** DNS seam forwarded to the delivery-time SSRF re-check (units inject). */
  dnsLookup?: (
    host: string,
    opts: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>;
  logger?: { info: (o: unknown, m: string) => void; warn: (o: unknown, m: string) => void };
  bootDelayMs?: number;
  intervalMs?: number;
  /** Default 500 — max rows per delivery envelope. */
  batchLimit?: number;
  /** Exporter tick guard (sec M-3): audit-flood observability counter. */
  recordTick?: (outcome: 'delivered' | 'held' | 'failed', rows?: number) => void;
}

export interface AuditExporter {
  stop: () => Promise<void>;
  /** Public driver for units/integration; timers call the same function. */
  runOnce: () => Promise<void>;
}

interface DestinationRow {
  id: string;
  url: string;
  secret_encrypted: string;
  active: boolean;
  last_delivered_seq: string | number;
  skipped_seq: unknown;
}

interface AuditExportRow {
  id: string;
  seq: string | number;
  tenant_id: string | null;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  response_status: number | null;
  request_id: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: Date | string;
  decision: { decision: string; matchedCode: string; scope?: string } | null;
  erased: boolean | null;
  row_hash: string | null;
}

/** pg bigint arrives as string through the raw seam — Number() it. */
const num = (v: unknown): number => Number(v);

export function startAuditExporter(deps: AuditExporterDeps): AuditExporter {
  const log = deps.logger ?? logger;
  const batchLimit = deps.batchLimit ?? BATCH_LIMIT;
  let db: WebhookQuery | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const conn = async (): Promise<WebhookQuery> => {
    if (deps.query) return deps.query;
    db ??= deps.makeDb?.();
    if (!db) throw new Error('audit-exporter: no query handle');
    return db;
  };

  const runOnce = async (): Promise<void> => {
    try {
      const q = await conn();
      const destinations = await q.query<DestinationRow>(
        `SELECT id, url, secret_encrypted, active, last_delivered_seq, skipped_seq
           FROM audit_export_destinations WHERE active = true ORDER BY id`,
      );
      for (const dest of destinations) {
        await exportDestination(q, dest);
      }
    } catch (err) {
      log.warn({ err }, 'audit exporter tick failed');
    }
  };

  async function exportDestination(q: WebhookQuery, dest: DestinationRow): Promise<void> {
    const cursor = num(dest.last_delivered_seq);
    let secret: string;
    try {
      secret = (deps.decrypt ?? identityDecryptSecret)(dest.secret_encrypted);
    } catch (err) {
      log.warn({ err, destinationId: dest.id }, 'audit export: secret decrypt failed — held');
      deps.recordTick?.('held');
      return;
    }

    const rows = await q.query<AuditExportRow>(
      `SELECT id, seq, tenant_id, user_id, action, resource_type, resource_id,
              response_status, request_id, ip, user_agent, created_at,
              decision, (erased_at IS NOT NULL) AS erased, row_hash
         FROM audit_logs
        WHERE seq > $1
        ORDER BY seq ASC
        LIMIT $2`,
      [cursor, batchLimit],
    );
    if (rows.length === 0) return;

    const skipped = Array.isArray(dest.skipped_seq)
      ? (dest.skipped_seq as unknown[]).map(num)
      : [];
    const skipSet = new Set(skipped);

    // Gap-aware walk (P-4=A): deliver the contiguous prefix; hold at gaps.
    let expected = cursor;
    const deliverable: AuditExportRow[] = [];
    let holdReason: { missing: number[] } | null = null;
    for (const row of rows) {
      const seq = num(row.seq);
      if (seq === expected + 1) {
        expected = seq;
        deliverable.push(row);
        continue;
      }
      if (seq <= expected) continue; // already delivered-or-skipped
      // seq > expected + 1: a gap sits at [expected+1 .. seq-1]. Rows in the
      // gap that are ALREADY in skippedSeq are conclusively dead — walk
      // through them; NEW missing seqs are recorded and HOLD delivery.
      const missing: number[] = [];
      for (let m = expected + 1; m < seq; m += 1) {
        if (!skipSet.has(m)) missing.push(m);
      }
      if (missing.length > 0) {
        holdReason = { missing };
        break;
      }
      // walk through conclusively-skipped values; this row is deliverable
      expected = seq;
      deliverable.push(row);
    }
    // The walk-through branch above sets expected = row.seq for skipped gaps.

    if (holdReason) {
      // First sighting: record the missing seqs (forensic ledger) and HOLD —
      // nothing past the gap is delivered this tick, cursor does NOT move.
      const merged = [...new Set([...skipped, ...holdReason.missing])]
        .sort((a, b) => a - b)
        .slice(-SKIPPED_FORENSICS_CAP);
      await q.query('UPDATE "audit_export_destinations" SET "skipped_seq"=$2::jsonb WHERE "id"=$1', [
        dest.id,
        JSON.stringify(merged),
      ]);
      log.warn(
        { destinationId: dest.id, missing: holdReason.missing },
        'audit export: seq gap held (in-flight or rolled back) — cursor frozen until conclusive',
      );
      deps.recordTick?.('held');
      return;
    }
    if (deliverable.length === 0) return; // nothing contiguous to send

    // DELIVERY-TIME SSRF re-check (F-05, review #1): registration gates can
    // be stale by the time a URL re-resolves — refuse before any fetch.
    const verdict = assertWebhookUrl(dest.url);
    if (!verdict.ok) {
      log.warn({ destinationId: dest.id, reason: verdict.reason }, 'audit export: URL structurally denied at delivery time — held');
      deps.recordTick?.('held');
      return;
    }
    const dnsOk = await resolveDeniedIps(verdict.hostname, deps.dnsLookup);
    if (!dnsOk.ok) {
      log.warn({ destinationId: dest.id, reason: dnsOk.reason }, 'audit export: destination DNS resolved into the deny-set — held');
      deps.recordTick?.('held');
      return;
    }

    const watermark = expected;
    const envelope = {
      schemaVersion: AUDIT_EXPORT_SCHEMA_VERSION,
      destinationId: dest.id,
      watermarkSeq: watermark,
      timestamp: new Date().toISOString(),
      rows: deliverable.map((r) => ({
        seq: num(r.seq),
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
        tenant_id: r.tenant_id,
        actor: { user_id: r.user_id },
        src_endpoint: { ip: r.ip },
        activity: { action: r.action, resource: { type: r.resource_type, id: r.resource_id } },
        result: { status: r.response_status },
        decision: r.decision ?? null,
        request_id: r.request_id,
        user_agent: r.user_agent,
        erased: Boolean(r.erased),
        // Chain provenance ONLY — never transport auth (the HMAC below is,
        // F-12). Rides the main SELECT (no second query, no O(n²) join).
        row_hash: r.row_hash ?? null,
      })),
    };

    const body = JSON.stringify(envelope);
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    let ok = false;
    try {
      const res = await deps.fetchImpl(dest.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-accessbase-audit-signature': signature,
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      ok = res.status >= 200 && res.status < 300;
      if (!ok) {
        log.warn({ destinationId: dest.id, status: res.status }, 'audit export: receiver rejected — held');
      }
    } catch (err) {
      log.warn({ err, destinationId: dest.id }, 'audit export: delivery failed — held');
    }
    if (!ok) {
      deps.recordTick?.('failed');
      return; // no advance — the rows re-deliver next tick (at-least-once)
    }
    // GREATEST guard (sec M-1): a slow instance can never REGRESS the cursor.
    await q.query(
      'UPDATE "audit_export_destinations" SET "last_delivered_seq"=GREATEST("last_delivered_seq",$2::bigint) WHERE "id"=$1',
      [dest.id, watermark],
    );
    deps.recordTick?.('delivered', deliverable.length);
  }

  const timerMs = deps.intervalMs ?? 10_000;
  timer = setTimeout(function tick() {
    void runOnce().finally(() => {
      if (!stopped) timer = setTimeout(tick, timerMs);
    });
  }, deps.bootDelayMs ?? 2_000);
  timer.unref();

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      try {
        await db?.close?.();
      } catch {
        // shared-pool family: another drainer may have ended it first — the
        // "stop() never throws" contract holds (webhook-dispatcher parity).
      }
    },
    runOnce,
  };
}
