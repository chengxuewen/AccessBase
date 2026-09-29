/**
 * Retention sweeper (Q2a E — gap-audit D4/D18). audit_logs had a dead
 * `retentionDays` config and no reaper; expired sessions rows were never
 * deleted. First pass at boot+60s (deploy cycles shorter than 24h must still
 * sweep — rev.2 R7), then every 24h. Errors logged, never thrown.
 *
 * The pool is created LAZILY on the first sweep and owned here (stop() ends
 * it) — buildApp must stay createDb-free for the health-pool.test premise,
 * and partial vi.mock('@accessbase/identity/db') factories never see a
 * closeDb access they don't define (guarded below).
 */
import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '@accessbase/identity/db';

const DAY_MS = 86_400_000;
const BOOT_DELAY_MS = 60_000;

/** Session rows are deleted this many days AFTER expiry (forensics buffer). */
export const SESSION_GRACE_DAYS = 30;

export interface RetentionSweeper {
  stop: () => Promise<void>;
}

/** env override wins; `configured` = the AuditStorage archive default. 0 disables. */
export function resolveRetentionDays(raw: string | undefined, configured: number | undefined): number {
  const n = raw !== undefined && raw !== '' ? Number(raw) : (configured ?? 365);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

export function startRetentionSweeper(
  makeDb: () => DrizzleDB,
  retentionDays: number,
  log: { info: (o: unknown, m: string) => void; warn: (o: unknown, m: string) => void },
): RetentionSweeper {
  let stopped = false;
  let db: DrizzleDB | undefined;
  const sweep = async (): Promise<void> => {
    if (stopped) return;
    try {
      db ??= makeDb();
      if (retentionDays > 0) {
        // R-audit B4 (spec D2): the audit DELETE now rides ONE transaction with
        // the anchor prune-mark — mark-first so a crash between mark and delete
        // leaves skip (anchor stays, verifier reports prunedFrom), never alarm;
        // crash after delete is impossible (mark is first). Both or neither.
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`UPDATE audit_chain_anchors SET pruned_at = now()
             WHERE pruned_at IS NULL
               AND day < (current_date - make_interval(days => ${retentionDays}))::date`,
          );
          const r = await tx.execute(
            sql`DELETE FROM audit_logs WHERE created_at < now() - make_interval(days => ${retentionDays})`,
          );
          const n = (r as unknown as { rowCount?: number }).rowCount ?? 0;
          if (n > 0) log.info({ deleted: n, retentionDays }, 'audit retention sweep');
        });
      }
      // R-audit A4: the session sweep rides a tx too — every statement goes
      // through the transactional handle (test contract: bare-handle execute
      // count stays 0; a retention-0 tick still wraps its only statement).
      await db.transaction(async (tx) => {
        const s = await tx.execute(
          sql`DELETE FROM sessions WHERE expires_at < now() - make_interval(days => ${SESSION_GRACE_DAYS})`,
        );
        const sn = (s as unknown as { rowCount?: number }).rowCount ?? 0;
        if (sn > 0) log.info({ deleted: sn }, 'expired-session sweep');
      });
    } catch (err) {
      log.warn({ err }, 'retention sweep failed (next pass in 24h)');
    }
  };
  const bootTimer = setTimeout(() => {
    void sweep();
  }, BOOT_DELAY_MS);
  bootTimer.unref();
  const interval = setInterval(() => {
    void sweep();
  }, DAY_MS);
  interval.unref();
  return {
    stop: async () => {
      stopped = true;
      clearTimeout(bootTimer);
      clearInterval(interval);
      if (!db) return;
      try {
        const mod = (await import('@accessbase/identity/db')) as unknown as Record<string, unknown>;
        const close = mod['closeDb'];
        if (typeof close === 'function') {
          await (close as (d: DrizzleDB) => Promise<void>)(db);
        }
      } catch {
        // partial mock / already closed — shutdown is best-effort teardown
      }
      db = undefined;
    },
  };
}
