/**
 * Q4c-T2 webhook dispatcher (spec 2026-09-24-q4c rev.2 §5 steps 0-7,
 * invariants 4/6/8/10). Retention-sweeper lifecycle clone (F3 premise):
 * lazy db, unref'd timers, stop() closes the owned pool, never throws.
 *
 * EVERY externality is injected (query handle, webhooksEnabled, fetch,
 * decrypt, logger, dials) — the module dials nothing at registration and
 * the unit suite drives a full tick over a scripted `query` seam, so call
 * ORDER and bound PARAMS are asserted, not inferred from a live DB.
 * app.ts wiring (kill-switch precedence, NODE_ENV=test gate per §5.7/B3)
 * is the controller's step, deliberately NOT here.
 *
 * Tick contract (§5 + R1-T4):
 *   0. age prune runs FIRST, before the kill-switch — a disabled
 *      deployment still bounds the events table (invariant 8).
 *   0.5 backlogStats probe runs right after the prune, BEFORE the
 *      kill-switch — a disabled dispatcher still exposes its backlog;
 *      metric deps are guarded and can never kill the tick (R1-T4).
 *   1. fan-out INSERT…SELECT (test events excluded R3, tenant-live
 *      predicate B7) + the vacuous terminalization UPDATE (§3).
 *   2. claim = the canonical §5.2 CTE verbatim (surrogate id, LIMIT 25,
 *      60s lease push, FOR UPDATE SKIP LOCKED) — invariant 4's
 *      no-double-claim lives or dies on this exact shape.
 *   3. HMAC-signed POST per claimed row; secrets decrypt ONCE per endpoint
 *      per tick (R4 — decryptSecret is 36ms of scrypt, never per-delivery);
 *      SSRF re-check (webhook-url.ts, fail-closed) BEFORE fetch.
 *   4. outcome stamps; backoff computed in JS (30s·2^n) to dodge the
 *      make_interval / `^`-on-doubles dialect traps flagged in §5.4.
 *
 * The `query` seam speaks raw SQL text + positional ($n) params — the
 * drizzle `sql` template is intentionally absent; the production adapter
 * (drizzle `.execute` or a pg pool) is the app.ts wiring step's choice.
 */
import { createHmac } from 'node:crypto';
import { DEFAULT_TENANT } from './constants.js';
import { assertWebhookUrl, resolveDeniedIps } from './webhook-url.js';

/** Minimal query seam: raw SQL text + positional params in, rows out. */
export interface WebhookQuery {
  query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;
  close?: () => Promise<void>;
}

export interface WebhookDispatcherDeps {
  /** Lazy production handle; created on first tick, closed by stop(). */
  makeDb?: () => WebhookQuery;
  /** Test seam: scripted handle — takes precedence over makeDb, never closed here. */
  query?: WebhookQuery;
  /** Kill-switch (§5.6): controller wires env WEBHOOKS_ENABLED > option > true. */
  webhooksEnabled: () => boolean;
  /** Prune horizon in days, default 7 (§3); prune by AGE ALONE. */
  retentionDays?: number;
  /** Decrypt a `v1:` envelope to plaintext (identity decryptSecret in prod). */
  decrypt: (blob: string) => string;
  /** Injected fetch (undici global in prod) — units/e2e dial NOTHING (invariant 6). */
  fetchImpl: (url: string, init: Record<string, unknown>) => Promise<{ status: number }>;
  logger: { info: (o: unknown, m: string) => void; warn: (o: unknown, m: string) => void };
  /** Default 60_000 — sweeper-aligned boot delay (§5.7). */
  bootDelayMs?: number;
  /** Default 5_000 — interval (§5.7 WEBHOOK_DISPATCH_INTERVAL_MS). */
  intervalMs?: number;
  /** Fan-out tenant pin; DEFAULT_TENANT in prod, injectable for tests. */
  defaultTenantId?: string;
  /** Optional DNS seam forwarded to the dispatch-time SSRF re-check. */
  dnsLookup?: (host: string, opts: { all: true }) => Promise<Array<{ address: string; family: number }>>;
  /** R1-T4: called once per settled delivery (2xx → 'ok'; failure below the
   *  10-attempt cap → 'retry'; at the cap → 'dead'). Prod: prom-counter inc.
   *  Optional — absent means zero behavior change; throwing never kills the tick. */
  recordDelivery?: (outcome: 'ok' | 'retry' | 'dead') => void;
  /** R1-T4: once-per-tick backlog probe (prod: ONE combined SELECT + gauge set,
   *  app.ts wiring). Called after the prune, before the kill-switch return, so a
   *  disabled dispatcher still reports. Return value is ignored here — the
   *  wiring closes over its own instruments. Throwing never kills the tick. */
  backlogStats?: () => Promise<{ count: number; oldestAgeSeconds: number | null } | null>;
}

export interface WebhookDispatcher {
  stop: () => Promise<void>;
  /** Public for the unit/integration drivers; the timers call the same function. */
  runOnce: () => Promise<void>;
}

const CLAIM_LIMIT = 25;
const LEASE_SECS = 60;
const MAX_ATTEMPTS = 10;
const FETCH_TIMEOUT_MS = 10_000;

interface ClaimedRow {
  id: number;
  event_id: number;
  endpoint_id: string;
  attempts: number;
}
interface EndpointRow {
  id: string;
  url: string;
  secret_encrypted: string;
}
interface EventRow {
  id: number;
  type: string;
  payload: unknown;
  created_at: Date | string;
}

/** §5.2 canonical claim CTE — verbatim. LIMIT/lease stay inlined: the spec locks this exact text. */
export const CLAIM_SQL = `WITH cte AS (
  SELECT id FROM webhook_deliveries
  WHERE status = 'pending' AND next_attempt_at <= now()
  ORDER BY event_id LIMIT ${CLAIM_LIMIT}
  FOR UPDATE SKIP LOCKED
)
UPDATE webhook_deliveries d
SET attempts = attempts + 1, next_attempt_at = now() + make_interval(secs => ${LEASE_SECS})
FROM cte WHERE d.id = cte.id
RETURNING d.id, d.event_id, d.endpoint_id, d.attempts`;

/** §3 vacuous terminalization: an event is terminal iff no pending delivery references it. */
export const TERMINALIZE_SQL = `UPDATE events e SET fanout_complete_at = now()
  WHERE e.fanout_complete_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM webhook_deliveries d WHERE d.event_id = e.id AND d.status = 'pending')`;

const FANOUT_SQL = `INSERT INTO webhook_deliveries (event_id, endpoint_id)
  SELECT e.id, w.id FROM events e
  JOIN webhook_endpoints w ON w.tenant_id = e.tenant_id AND w.active
  JOIN tenants t ON t.id = w.tenant_id AND (t.status = 'active' OR w.tenant_id = $1)
  WHERE e.fanout_complete_at IS NULL AND e.type <> 'webhook.test'
    AND ('*' = ANY(w.subscribed_events) OR e.type = ANY(w.subscribed_events))
  ON CONFLICT DO NOTHING`;

const PRUNE_SQL = `DELETE FROM events WHERE created_at < now() - make_interval(days => $1)`;

/**
 * Backoff after a failed attempt: 30s · 2^(attempts-1), attempts 1..10 ⇒
 * 30s … ~4.3h. The claim already burned the attempt counter, so `attempts`
 * is the POST-increment value (§5.2 RETURNING) — first failure waits 30s.
 */
export function nextAttemptAt(attempts: number, nowMs: number): Date {
  const exp = Math.min(Math.max(attempts, 1), 10) - 1;
  return new Date(nowMs + 30_000 * 2 ** exp);
}

/**
 * §5.5 dispatch-time SSRF re-check. assertWebhookUrl already fully decided
 * any literal IP (deny-set applied, no DNS needed); a hostname still needs
 * the resolver leg. `host` is the WHATWG-normalized (bracket-stripped) form.
 */
export async function dispatchUrlAllowed(
  rawUrl: string,
  dnsLookup?: WebhookDispatcherDeps['dnsLookup'],
): Promise<boolean> {
  const gate = assertWebhookUrl(rawUrl);
  if (!gate.ok) return false;
  const host = gate.hostname;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return true; // literal, already ruled
  const resolved = await resolveDeniedIps(host, dnsLookup);
  return resolved.ok;
}

export function startWebhookDispatcher(deps: WebhookDispatcherDeps): WebhookDispatcher {
  const retentionDays = deps.retentionDays ?? 7;
  const defaultTenantId = deps.defaultTenantId ?? DEFAULT_TENANT;
  let stopped = false;
  let running = false; // one tick at a time — a slow tick never overlaps the next
  let inFlight: Promise<void> | undefined; // the live tick promise, for stop() drain
  let owned: WebhookQuery | undefined;
  const q = (): WebhookQuery => {
    if (deps.query) return deps.query;
    if (!owned) {
      if (!deps.makeDb) throw new Error('webhook dispatcher: neither query nor makeDb provided');
      owned = deps.makeDb();
    }
    return owned;
  };
  // Metric hooks are observability-only: a throwing instrument must never
  // abort deliveries (same posture as the degraded-mode guards in metrics.ts).
  const recordSafe = (outcome: 'ok' | 'retry' | 'dead'): void => {
    try {
      deps.recordDelivery?.(outcome);
    } catch {
      // swallow — counter bookkeeping is not delivery state
    }
  };

  const runOnce = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      const db = q();
      // ---- step 0: age prune BEFORE the kill-switch (invariant 8) ----
      await db.query(PRUNE_SQL, [retentionDays]);
      // ---- step 0.5: backlog gauge — before the kill-switch (R1-T4) ----
      try {
        await deps.backlogStats?.();
      } catch {
        // metrics never kill the tick; next tick retries the probe
      }
      if (!deps.webhooksEnabled()) return;

      // ---- step 1: fan-out + terminalization ----
      await db.query(FANOUT_SQL, [defaultTenantId]);
      await db.query(TERMINALIZE_SQL);

      // ---- step 2: claim ----
      // pg returns int8/bigint columns as STRINGS (drizzle's bigserial
      // mode:'number' would parse them; the raw seam does not) — normalize
      // numerics so Map keys match the events select and `attempts >= 10`
      // compares numbers, not strings.
      const claimed = (await db.query<ClaimedRow>(CLAIM_SQL)).map((r) => ({
        ...r,
        id: Number(r.id),
        event_id: Number(r.event_id),
        attempts: Number(r.attempts),
      }));
      if (claimed.length > 0) {
        // Enrichment selects keep the claim CTE canonical (§5.2 verbatim).
        const endpointIds = [...new Set(claimed.map((c) => c.endpoint_id))];
        const endpoints = await db.query<EndpointRow>(
          `SELECT id, url, secret_encrypted FROM webhook_endpoints WHERE id = ANY($1::uuid[])`,
          [endpointIds],
        );
        const eventIds = [...new Set(claimed.map((c) => c.event_id))];
        const events = await db.query<EventRow>(
          `SELECT id::int4 AS id, type, payload, created_at FROM events WHERE id = ANY($1::bigint[])`, // int4: bigint would arrive as string (pg) and miss the Map keys
          [eventIds],
        );
        const endpointById = new Map(endpoints.map((e) => [e.id, e]));
        const eventById = new Map(events.map((e) => [e.id, e]));

        // Secrets + SSRF verdicts ONCE per endpoint per tick (R4 — never
        // per-delivery scrypt; an endpoint serves many claimed deliveries).
        const secrets = new Map<string, string>();
        const ssrfOk = new Map<string, boolean>();
        for (const c of claimed) {
          const ep = endpointById.get(c.endpoint_id);
          if (!ep) continue; // deleted mid-tick: cascade took the delivery, or the lease re-covers it
          if (!secrets.has(ep.id)) secrets.set(ep.id, deps.decrypt(ep.secret_encrypted));
          if (!ssrfOk.has(ep.id)) ssrfOk.set(ep.id, await dispatchUrlAllowed(ep.url, deps.dnsLookup));
        }

        // ---- steps 3-4: sign, POST, stamp outcome ----
        for (const c of claimed) {
          const ep = endpointById.get(c.endpoint_id);
          const ev = eventById.get(c.event_id);
          if (!ep || !ev) continue;
          let ok = false;
          let status: number | null = null;
          let error: string | null = null;
          if (ssrfOk.get(ep.id) !== true) {
            error = 'ssrf-denied'; // counts toward the 10-cap (bounded, §5.5)
          } else {
            const body = JSON.stringify({
              id: ev.id,
              type: ev.type,
              createdAt: ev.created_at instanceof Date ? ev.created_at.toISOString() : ev.created_at,
              data: ev.payload,
            });
            const signature = `sha256=${createHmac('sha256', secrets.get(ep.id) ?? '')
              .update(body)
              .digest('hex')}`;
            try {
              const res = await deps.fetchImpl(ep.url, {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  'user-agent': 'AccessBase-Webhooks/1',
                  'x-accessbase-event': String(ev.id),
                  'x-accessbase-type': ev.type,
                  'x-accessbase-signature': signature,
                },
                body,
                redirect: 'manual', // any 3xx is a FAILURE (§5.3)
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
              });
              ok = res.status >= 200 && res.status < 300;
              status = res.status;
              if (!ok) error = `http-${res.status}`;
            } catch (err) {
              error = String(err).slice(0, 500);
            }
          }
          const dead = !ok && c.attempts >= MAX_ATTEMPTS;
          await db.query(
            `UPDATE webhook_deliveries
             SET status = $1, last_error = $2, response_status = $3,
                 delivered_at = $4, next_attempt_at = $5
             WHERE id = $6`,
            [
              ok ? 'delivered' : dead ? 'dead' : 'pending',
              ok ? null : error,
              status,
              ok ? new Date() : null, // delivered_at ONLY on success — failures keep it NULL
              ok ? new Date() : nextAttemptAt(c.attempts, Date.now()),
              c.id,
            ],
          );
          // R1-T4: settlement mirrors the UPDATE status verbatim — no new
          // terminal logic, just telemetry of the one just stamped.
          recordSafe(ok ? 'ok' : dead ? 'dead' : 'retry');
        }

        // Terminality may have flipped during outcomes (invariant 8's
        // after-image): re-run the same vacuous rule.
        await db.query(TERMINALIZE_SQL);
      }
    } catch (err) {
      deps.logger.warn({ err }, 'webhook dispatcher tick failed (next pass continues)');
    } finally {
      running = false;
    }
  };

  // runOnce flips `running` synchronously before its first await, so a
  // was-false / now-true transition here means a fresh tick actually started.
  const runTracked = (): Promise<void> => {
    const wasRunning = running;
    const p = runOnce();
    if (!wasRunning && running) {
      inFlight = p.finally(() => {
        inFlight = undefined;
      });
    }
    return p;
  };

  const bootTimer = setTimeout(() => {
    void runTracked();
  }, deps.bootDelayMs ?? 60_000);
  bootTimer.unref();
  const interval = setInterval(() => {
    void runTracked();
  }, deps.intervalMs ?? 5_000);
  interval.unref();

  return {
    runOnce: runTracked,
    stop: async () => {
      stopped = true;
      clearTimeout(bootTimer);
      clearInterval(interval);
      // Drain: stop() mid-POST must never cut delivery half-way — the outcome
      // UPDATE lands before the pool closes, so shutdown is at-least-once, never drop.
      if (inFlight) await inFlight;
      if (!owned) return;
      try {
        await owned.close?.();
      } catch {
        // teardown is best-effort (sweeper precedent)
      }
      owned = undefined;
    },
  };
}
