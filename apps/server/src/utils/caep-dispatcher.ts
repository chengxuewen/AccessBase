/**
 * 4A T1 — CAEP/RISC SET delivery drainer (spec rev.4 §3 T1; rulings P-1=C /
 * P-3=B / P-8 / F-05 / F-08). Deliberately NOT the webhook dispatcher: the
 * destination lives on oidc_clients.caep_endpoint_uri, the body is a signed
 * SET (utils/set-signer.ts), and the channel must survive the webhook
 * kill-switch and the events age-prune (F-08 — compliance signals cannot be
 * switched off or pruned away).
 *
 * Lifecycle clone of the retention-sweeper/webhook-dispatcher family: lazy db,
 * unref'd timers, stop() closes the owned pool, never throws, every externality
 * injected (query seam, signer, fetch, dns, logger) — units drive a full tick
 * over a scripted `query` seam and assert call order + bound params.
 *
 * Tick contract:
 *   1. claim = UPDATE..SELECT FOR UPDATE SKIP LOCKED (25 rows, 30s lease)
 *      LEFT JOIN oidc_clients for the endpoint — attempts increment INSIDE
 *      the claim so a crash after claim still counts the attempt.
 *   2. per-row classification, in order, cheapest first (P-8 / F-05 / F-14):
 *        a. client_id OR url NULL   -> dead 'client deleted' (P-8: evidence
 *           survives client deletion; SET NULL + dead-letter, never CASCADE)
 *        b. assertWebhookUrl fail   -> dead 'ssrf-denied-url'
 *        c. resolveDeniedIps deny   -> dead 'ssrf-denied-dns'
 *        d. sign failure            -> retry (transient key/file errors) with
 *                                      same jti; dead at the attempt cap
 *        e. 2xx                     -> delivered
 *        f. else                    -> retry with 30s·2^attempts backoff,
 *                                      dead 'max attempts' at the cap
 *   3. outcome stamps are single-row UPDATEs; backoff computed in JS (§5.4
 *      dialect trap precedent).
 *
 * SSRF posture (F-05): dispatch-time resolve + deny-set check here (same as
 * the webhook channel); a connect-time pin via undici Agent connect.lookup
 * (this module) ACTIVATES automatically once `undici` is added as a direct
 * dependency — until then the residual rebinding window matches the webhook
 * channel's documented posture and is called out in security.md (T6).
 */
import { promises as dnsPromises } from 'node:dns';
import { logger } from '@accessbase/logging';
import { assertWebhookUrl, isDeniedAddress, resolveDeniedIps } from './webhook-url.js';
import { signSet, logSetDelivery } from './set-signer.js';
import type { WebhookQuery } from './webhook-dispatcher.js';

export interface CaepDispatcherDeps {
  /** Lazy production handle; created on first tick, closed by stop(). */
  makeDb?: () => WebhookQuery;
  /** Test seam: scripted handle — takes precedence over makeDb, never closed. */
  query?: WebhookQuery;
  /** OIDC issuer — the SET `iss` and the iss_sub subject pair's iss. */
  issuer: string;
  /** SET private key PEM (JWT_SET_PRIVATE_KEY_PATH). Missing/invalid keys are
   * a config defect: claimed rows die 'signing-unconfigured' (loud), they are
   * NOT retried forever against a dead key. */
  signingKeyPem?: () => string | undefined;
  /** Injected fetch (global fetch in prod) — units dial NOTHING. */
  fetchImpl: (url: string, init: Record<string, unknown>) => Promise<{ status: number }>;
  logger?: { info: (o: unknown, m: string) => void; warn: (o: unknown, m: string) => void };
  bootDelayMs?: number;
  intervalMs?: number;
  /** DNS seam forwarded to resolveDeniedIps (units inject synthetic answers). */
  dnsLookup?: (
    host: string,
    opts: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>;
  /** Once per settled delivery (2xx→'ok'; below cap→'retry'; at cap or
   * terminal classify→'dead'). Prod: prom-counter. Throwing never kills tick. */
  recordDelivery?: (outcome: 'ok' | 'retry' | 'dead') => void;
}

export interface CaepDispatcher {
  stop: () => Promise<void>;
  /** Public for unit/integration drivers; timers call the same function. */
  runOnce: () => Promise<void>;
}

const CLAIM_LIMIT = 25;
const LEASE_SECS = 30;
const MAX_ATTEMPTS = 10;
const FETCH_TIMEOUT_MS = 10_000;
const BACKOFF_BASE_SECS = 30;

interface ClaimedSet {
  id: number;
  attempts: number;
  tenant_id: string;
  client_id: string | null;
  event_type: string;
  subject_id: string;
  jti: string;
  url: string | null;
}

// ---------------------------------------------------------------------------
// Connect-time pin (F-05) — ACTIVE only when `undici` is importable. The
// custom lookup RESOLVES then deny-checks then returns the validated address,
// so the socket can only reach a previously-validated IP (TOCTOU closed).
// ---------------------------------------------------------------------------
let denyAgent: unknown;
let denyAgentTried = false;

async function getDenyDispatcher(): Promise<unknown | undefined> {
  if (denyAgentTried) return denyAgent;
  denyAgentTried = true;
  try {
    const mod = (await import(
      /* webpackIgnore: true */ 'undici' as string
    )) as {
      Agent: new (o: unknown) => unknown;
    };
    const lookup = (
      hostname: string,
      _opts: unknown,
      cb: (err: Error | null, address?: string, family?: number) => void,
    ): void => {
      dnsPromises
        .lookup(hostname, { all: true })
        .then((addrs) => {
          const denied = addrs.find((a) => isDeniedAddress(a.address));
          if (denied) {
            cb(new Error(`caep-ssrf-denied:${denied.address}`));
            return;
          }
          const first = addrs[0];
          if (!first) {
            cb(new Error('caep-no-address'));
            return;
          }
          cb(null, first.address, first.family === 6 ? 6 : 4);
        })
        .catch((e: unknown) => cb(e instanceof Error ? e : new Error('lookup-failed')));
    };
    denyAgent = new mod.Agent({ connect: { lookup } });
    logger.info('CAEP dispatcher: undici connect-pin ACTIVE (TOCTOU closed)');
  } catch {
    denyAgent = undefined; // undici not a direct dep — dispatch-time gate remains
    logger.warn(
      'CAEP dispatcher: undici not importable — connect-pin inactive (dispatch-time SSRF gate only; add undici dependency to close the rebinding window)',
    );
  }
  return denyAgent;
}

export function startCaepDispatcher(deps: CaepDispatcherDeps): CaepDispatcher {
  const log = deps.logger ?? logger;
  let db: WebhookQuery | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const conn = async (): Promise<WebhookQuery> => {
    if (deps.query) return deps.query;
    db ??= deps.makeDb?.();
    if (!db) throw new Error('caep-dispatcher: no query handle');
    return db;
  };

  /** Single-row dead-letter stamp (P-8 reason-preserving; counter-safe). */
  const settleDeadFor = (
    q: WebhookQuery,
    row: ClaimedSet,
    reason: string,
    detail: string,
    status?: number,
  ): Promise<void> =>
    q
      .query(
        'UPDATE "caep_deliveries" SET "status"=\'dead\', "dead_reason"=$2, "last_error"=$3, "response_status"=$4 WHERE "id"=$1',
        [row.id, reason, detail, status ?? null],
      )
      .then(() => {
        deps.recordDelivery?.('dead');
        logSetDelivery(log, row.jti, 'dead', `${reason}: ${detail}`);
      });

  async function runOnce(): Promise<void> {
    try {
      const q = await conn();
      const rows = await q.query<ClaimedSet>(
        `WITH claimed AS (
           UPDATE "caep_deliveries"
              SET "attempts" = "attempts" + 1,
                  "next_attempt_at" = now() + make_interval(secs => $1::int)
            WHERE "id" IN (
              SELECT "id" FROM "caep_deliveries"
               WHERE "status" = 'pending' AND "next_attempt_at" <= now()
               ORDER BY "id" LIMIT $2
               FOR UPDATE SKIP LOCKED
            )
            RETURNING "id", "attempts"
         )
         SELECT c."id", c."attempts", c."tenant_id", c."client_id", c."event_type",
                c."subject_id", c."jti", o."caep_endpoint_uri" AS "url"
           FROM "claimed" c
           LEFT JOIN "oidc_clients" o ON o."id" = c."client_id"
          ORDER BY c."id"`,
        [LEASE_SECS, CLAIM_LIMIT],
      );
      for (const row of rows) {
        await deliverOne(q, row);
      }
    } catch (err) {
      log.warn({ err }, 'caep dispatcher tick failed');
    }
  }

  /** Classify + attempt ONE claimed row; stamps exactly one terminal outcome. */
  async function deliverOne(q: WebhookQuery, row: ClaimedSet): Promise<void> {
    // (a) P-8: orphaned row — evidence preserved, delivery impossible.
    if (row.client_id === null || row.url === null) {
      await settleDeadFor(q, row, 'client deleted', `clientId=${String(row.client_id)} url missing`);
      return;
    }
    // (b)/(c) F-05/F-14: fail-closed SSRF gate, structural then DNS leg.
    const verdict = assertWebhookUrl(row.url);
    if (!verdict.ok) {
      await settleDeadFor(q, row, 'ssrf-denied-url', `${row.url}: ${verdict.reason}`);
      return;
    }
    const dnsOk = await resolveDeniedIps(verdict.hostname, deps.dnsLookup);
    if (!dnsOk.ok) {
      await settleDeadFor(q, row, 'ssrf-denied-dns', `${verdict.hostname}: ${dnsOk.reason}`);
      return;
    }
    // (d) sign — config/shape errors here are loud; the row retries (a key
    // file mounted late should NOT void the notification) until the cap.
    const pem = deps.signingKeyPem?.();
    if (!pem) {
      await maybeDeadOrRetry(q, row, 'signing-unconfigured', 'JWT_SET_PRIVATE_KEY_PATH missing');
      return;
    }
    let set: string;
    try {
      set = await signSet(pem, {
        issuer: deps.issuer,
        audience: row.client_id,
        jti: row.jti,
        txn: String(row.id),
        subjectId: row.subject_id,
        eventType: row.event_type,
      });
    } catch (err) {
      await maybeDeadOrRetry(q, row, 'sign-failed', String(err));
      return;
    }
    // (e)/(f) deliver.
    const dispatcher = await getDenyDispatcher();
    try {
      const res = await deps.fetchImpl(row.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/secevent+jwt',
          accept: 'application/secevent+jwt',
        },
        body: set,
        redirect: 'manual', // any 3xx is a FAILURE (webhook §5.3 precedent)
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        dispatcher,
      });
      if (res.status >= 200 && res.status < 300) {
        await q.query(
          'UPDATE "caep_deliveries" SET "status"=\'delivered\', "delivered_at"=now(), "response_status"=$2, "last_error"=NULL WHERE "id"=$1',
          [row.id, res.status],
        );
        deps.recordDelivery?.('ok');
        return;
      }
      await maybeDeadOrRetry(q, row, `http ${res.status}`, `receiver answered ${res.status}`, res.status);
    } catch (err) {
      await maybeDeadOrRetry(q, row, 'fetch-failed', String(err));
    }
  }

  /** Retry with backoff while attempts < cap; dead-letter at the cap. */
  async function maybeDeadOrRetry(
    q: WebhookQuery,
    row: ClaimedSet,
    reason: string,
    detail: string,
    status?: number,
  ): Promise<void> {
    if (row.attempts >= MAX_ATTEMPTS) {
      await settleDeadFor(q, row, 'max attempts', `${reason}: ${detail}`, status);
      return;
    }
    const backoff = Math.min(BACKOFF_BASE_SECS * 2 ** Math.max(row.attempts - 1, 0), 3600);
    await q.query(
      'UPDATE "caep_deliveries" SET "next_attempt_at"=now()+make_interval(secs=>$2::int), "last_error"=$3 WHERE "id"=$1',
      [row.id, Math.round(backoff), `${reason}: ${detail}`],
    );
    deps.recordDelivery?.('retry');
  }

  const timerMs = deps.intervalMs ?? 5_000;
  timer = setTimeout(function tick() {
    void runOnce().finally(() => {
      if (!stopped) timer = setTimeout(tick, timerMs);
    });
  }, deps.bootDelayMs ?? 1_000);
  timer.unref();

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      try {
        await db?.close?.();
      } catch {
        // shared getWhDb pool family: another drainer may have ended it
        // first — stop() never throws (webhook-dispatcher parity).
      }
    },
    runOnce,
  };
}
