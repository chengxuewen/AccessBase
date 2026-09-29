/**
 * R-audit A4: audit-chain anchor worker (spec 2026-09-28 D2/D6, plan task A4).
 *
 * Every `intervalSeconds` (default 300): open ONE transaction; FIRST statement
 * is `pg_try_advisory_xact_lock(727242)` (B2: xact-scoped — a session lock on
 * a pooled connection would strand and self-deadlock; commit auto-releases,
 * so the loser's follow-up tick just wins). Loser exits silently with zero
 * writes. Winner:
 *
 *   1. BACKFILL (D6, before the fold so freshly hashed rows anchor promptly):
 *      `row_hash IS NULL AND erased_at IS NULL` rows, oldest-first, batches of
 *      1000, hashed over CURRENT column values (baseline-trust posture —
 *      tamper-evidence starts when evidence collection starts). Rows with
 *      `erased_at NOT NULL` are skipped FOREVER (B6: hashing scrubbed content
 *      without a receipt would fake provenance) — they classify
 *      `erasedLegacyUnhashed` in the verifier (A6).
 *   2. FOLD (D2): unanchored hashed rows older than the grace window, ordered
 *      `ORDER BY audit_logs.created_at, audit_logs.id` — this exact string is
 *      the chain lockstep contract with the A6 verifier's re-fold. Rolls of
 *      ~5000 rows per anchor (day = UTC date of the roll's FIRST created_at,
 *      seq = max(seq)+1 within the day, first/last ids, row count, root =
 *      foldRoot(row_hashes), prev_root = previous anchor's root else GENESIS).
 *      Anchor INSERT and the rows' anchor_id marking ride the SAME tx — a
 *      crash rolls back both; an anchor never half-exists.
 *   3. AFTER commit (outside the tx): export self-heal (B4) — when
 *      `exportPath` is configured, read the file's tail line to find the last
 *      exported (day, seq), then append `day seq root` for every anchor after
 *      that position (chain-head scan when the file is missing/empty). The
 *      gap-free guarantee: crash between commit and append loses only the
 *      export line, not the anchor; the next tick's tail-check re-appends it.
 *      Appends are the crash point — a torn final line is impossible (append
 *      of one whole line via appendFileSync) unless the OS dies mid-write.
 *
 * Errors never crash the process: a 40P01 deadlock (serialized away with the
 * A5 erasure tx on the same key — retryable, plan B2) is caught and skipped
 * with a warn; every other error warns and lets the next tick retry. Metric
 * reporting via `recordResult` is guarded — an instrument must never kill the
 * tick.
 *
 * DI shape clones the webhook dispatcher: `query` test seam takes precedence
 * over `makeDb` (lazy prod handle owned here, closed by stop()); timers are
 * unref'd; NODE_ENV=test registration is the app.ts wiring's job, never this
 * module's.
 */
import { sql, type SQL } from 'drizzle-orm';
import { auditLogs } from '@accessbase/identity/db';
import { appendFileSync, readFileSync } from 'node:fs';
import { rowHash, foldRoot, GENESIS } from '@accessbase/audit';

/** B2: shared with the A5 erasure tx's FIRST statement (routes/users.ts). */
export const AUDIT_ADVISORY_LOCK_KEY = 727242;

const FOLD_BATCH = 5000;
const BACKFILL_BATCH = 1000;
const EXPORT_HEAD_LIMIT = 10_000;

/** Query seam: drizzle execute (raw db or a tx handle). */
export interface AnchorTxLike {
  execute: (q: SQL) => Promise<unknown>;
}

export interface AnchorDbHandle extends AnchorTxLike {
  transaction: <T>(fn: (tx: AnchorTxLike) => Promise<T>) => Promise<T>;
}

export interface AuditAnchorDeps {
  /** Test seam: full handle — takes precedence over makeDb, never closed here. */
  db?: AnchorDbHandle;
  /** Lazy production handle; created on first tick, closed by stop(). */
  makeDb?: () => AnchorDbHandle;
  /** Default 300 (AUDIT_ANCHOR_INTERVAL_SECONDS). */
  intervalSeconds?: number;
  /** Default 90 (AUDIT_ANCHOR_GRACE_SECONDS). */
  graceSeconds?: number;
  /** Optional D7/D8 export surface: `day seq root\n` lines, tail-check self-heal. */
  exportPath?: string;
  /** Prod: prom gauge setter (accessbase_audit_anchor_last_root_ok); guarded. */
  recordResult?: (ok: boolean) => void;
  log: { info: (o: unknown, m: string) => void; warn: (o: unknown, m: string) => void };
  /** Test-only boot-delay override (default 30_000, sweeper-aligned). */
  bootDelayMs?: number;
}

export interface AuditAnchorWorker {
  stop: () => Promise<void>;
  /** Public driver for units/integration; the timers call the same function. */
  runOnce: () => Promise<void>;
}

interface PendingRow {
  id: string;
  row_hash: string;
  created_at: Date | string;
}

interface LegacyRow {
  id: string;
  tenant_id: string | null;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  request_body: unknown;
  response_status: number | null;
  request_id: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: Date | string;
}

/** pg int8/bigserial arrives as string through the raw seam — Number() it. */
const num = (v: unknown): number => Number(v);

function is40P01(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '40P01'
  );
}

export function startAuditAnchor(deps: AuditAnchorDeps): AuditAnchorWorker {
  const intervalSeconds = deps.intervalSeconds ?? 300;
  const graceSeconds = deps.graceSeconds ?? 90;
  let stopped = false;
  let running = false; // one tick at a time
  let owned: AnchorDbHandle | undefined;
  const db = (): AnchorDbHandle => {
    if (deps.db) return deps.db;
    if (!owned) {
      if (!deps.makeDb) throw new Error('audit anchor: neither db nor makeDb provided');
      owned = deps.makeDb();
    }
    return owned;
  };
  const recordSafe = (ok: boolean): void => {
    try {
      deps.recordResult?.(ok);
    } catch {
      // gauge bookkeeping must never kill the tick
    }
  };

  const tick = async (): Promise<void> => {
    const handle = db();
    await handle.transaction(async (tx) => {
      // B2: FIRST statement — non-blocking try-lock, key shared with the erasure tx.
      const lock = (await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(727242) AS locked`,
      )) as unknown as { rows?: Array<{ locked?: unknown }> };
      if (!lock.rows?.[0]?.locked) return; // loser: commit the empty tx, exit silently

      // ---- D6 backfill (BEFORE the fold) ----
      for (;;) {
        const legacy = (await tx.execute(sql`
          SELECT id, tenant_id, user_id, action, resource_type, resource_id,
                 request_body, response_status, request_id, ip, user_agent, created_at
          FROM audit_logs
          WHERE row_hash IS NULL AND erased_at IS NULL
          ORDER BY ${auditLogs.createdAt}, ${auditLogs.id}
          LIMIT ${BACKFILL_BATCH}
        `)) as unknown as { rows?: LegacyRow[] };
        const rows = legacy.rows ?? [];
        if (rows.length === 0) break;
        for (const r of rows) {
          await tx.execute(sql`
            UPDATE audit_logs SET row_hash = ${rowHash({
              tenantId: r.tenant_id ?? '',
              userId: r.user_id ?? '',
              action: r.action,
              resourceType: r.resource_type ?? '',
              resourceId: r.resource_id ?? '',
              requestBody: (r.request_body ?? {}) as Record<string, unknown>,
              responseStatus: r.response_status ?? undefined,
              requestId: r.request_id ?? '',
              ip: r.ip ?? '',
              userAgent: r.user_agent ?? '',
              createdAt: new Date(r.created_at),
            })}
            WHERE id = ${r.id}
          `);
        }
        if (rows.length < BACKFILL_BATCH) break; // drained
      }

      // ---- D2 fold ----
      for (;;) {
        const pending = (await tx.execute(sql`
          SELECT id, row_hash, created_at FROM audit_logs
          WHERE anchor_id IS NULL AND row_hash IS NOT NULL
            AND created_at < now() - make_interval(secs => ${graceSeconds})
            ORDER BY ${auditLogs.createdAt}, ${auditLogs.id}
          LIMIT ${FOLD_BATCH}
        `)) as unknown as { rows?: PendingRow[] };
        const rows = pending.rows ?? [];
        if (rows.length === 0) break;
        const hashes = rows.map((r) => r.row_hash);
        const first = rows[0] as PendingRow;
        const last = rows[rows.length - 1] as PendingRow;
        const firstCreated = new Date(first.created_at);
        const day = firstCreated.toISOString().slice(0, 10); // UTC date of the roll's first row

        const prev = (await tx.execute(sql`
          SELECT root FROM audit_chain_anchors
          ORDER BY day DESC, seq DESC LIMIT 1
        `)) as unknown as { rows?: Array<{ root: string }> };
        const prevRoot = prev.rows?.[0]?.root ?? GENESIS;

        const seqRow = (await tx.execute(sql`
          SELECT COALESCE(max(seq), 0) AS seq FROM audit_chain_anchors WHERE day = ${day}
        `)) as unknown as { rows?: Array<{ seq: unknown }> };
        const seq = num(seqRow.rows?.[0]?.seq) + 1;

        const ins = (await tx.execute(sql`
          INSERT INTO audit_chain_anchors (day, seq, first_id, last_id, row_count, root, prev_root)
          VALUES (${day}, ${seq}, ${first.id}, ${last.id}, ${rows.length}, ${foldRoot(hashes)}, ${prevRoot})
          RETURNING id
        `)) as unknown as { rows?: Array<{ id: unknown }> };
        const anchorId = num(ins.rows?.[0]?.id);

        await tx.execute(sql`
          UPDATE audit_logs SET anchor_id = ${anchorId}
          WHERE id IN ${rows.map((r) => r.id)}
        `);
        deps.log.info(
          { day, seq, rowCount: rows.length, anchored: anchorId },
          'audit chain anchored',
        );
        if (rows.length < FOLD_BATCH) break; // drained
      }
    });
  };

  const runOnce = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      await tick();
      if (deps.exportPath) await exportMissing(deps.exportPath, db());
    } catch (err) {
      running = false; // a failed tick must never wedge the one-at-a-time gate
      if (is40P01(err)) {
        deps.log.warn({ err }, 'audit anchor tick hit a 40P01 deadlock — skipped, retries next interval');
      } else {
        deps.log.warn({ err }, 'audit anchor tick failed (next pass continues)');
      }
      recordSafe(false);
      return;
    }
    running = false;
    recordSafe(true); // commit + export ok (no-op tick also ok — chain is healthy)
  };

  /**
   * B4 tail-check: last file line's (day, seq) is the export frontier; anchors
   * AFTER it are re-appended. Missing/empty file → full chain-head scan.
   */
  async function exportMissing(path: string, handle: AnchorDbHandle): Promise<void> {
    let frontier: { day: string; seq: number } | null = null;
    try {
      const content = readFileSync(path, 'utf8');
      const last = content.split('\n').filter((l) => l !== '').pop();
      if (last) {
        const [d, s] = last.split(' ');
        frontier = { day: d as string, seq: num(s) };
      }
    } catch {
      frontier = null; // missing file → export from chain head
    }
    const tail = frontier
      ? await handle.execute(sql`
          SELECT day, seq, root FROM audit_chain_anchors
          WHERE (day, seq) > (${frontier.day}, ${frontier.seq})
          ORDER BY day, seq LIMIT ${sql.raw(String(EXPORT_HEAD_LIMIT))}
        `)
      : await handle.execute(sql`
          SELECT day, seq, root FROM audit_chain_anchors
          ORDER BY day, seq LIMIT ${sql.raw(String(EXPORT_HEAD_LIMIT))}
        `);
    const rows = (tail as unknown as { rows?: Array<{ day: string; seq: unknown; root: string }> })
      .rows ?? [];
    for (const r of rows) {
      appendFileSync(path, `${r.day} ${num(r.seq)} ${r.root}\n`);
    }
  }

  const bootTimer = setTimeout(() => {
    void runOnce();
  }, deps.bootDelayMs ?? 30_000);
  bootTimer.unref();
  const interval = setInterval(() => {
    void runOnce();
  }, intervalSeconds * 1000);
  interval.unref();

  return {
    runOnce,
    stop: async () => {
      stopped = true;
      clearTimeout(bootTimer);
      clearInterval(interval);
      if (!owned) return;
      try {
        const mod = (await import('@accessbase/identity/db')) as unknown as Record<string, unknown>;
        const close = mod['closeDb'];
        if (typeof close === 'function') {
          await (close as (d: AnchorDbHandle) => Promise<void>)(owned);
        }
      } catch {
        // partial mock / already closed — best-effort teardown (sweeper precedent)
      }
      owned = undefined;
    },
  };
}
