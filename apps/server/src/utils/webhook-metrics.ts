import { Counter, Gauge } from 'prom-client';

/**
 * R1-T4 (plan 2026-09-28-batch-r1): Prometheus instruments for the webhook
 * dispatcher. Module-level singletons follow the routes/metrics.ts precedent —
 * the module cache makes double-registration under repeated buildApp() (or a
 * repeated dispatcher gate pass) impossible, exactly like the http histogram.
 * Imported ONLY by the app.ts dispatcher wiring (dynamic import inside the
 * NODE_ENV !== 'test' gate), so test suites never instantiate them.
 */

export const webhookDeliveriesTotal = new Counter({
  name: 'accessbase_webhook_deliveries_total',
  help: 'Webhook deliveries settled by the dispatcher, by outcome (ok | retry | dead).',
  labelNames: ['outcome'] as const,
});

export const webhookPendingGauge = new Gauge({
  name: 'accessbase_webhook_pending_events',
  help: 'Events whose fan-out is not yet complete (true backlog; partial index idx_events_pending_fanout bounds the scan).',
});

export const webhookOldestAgeGauge = new Gauge({
  name: 'accessbase_webhook_oldest_pending_age_seconds',
  help: 'Seconds since the oldest pending-fan-out event was created (0 when the backlog is empty).',
});

/**
 * ONE combined SELECT behind both backlog gauges, executed at most once per
 * dispatcher tick (≤60s cadence — same accepted cost as the retention sweeper,
 * Momus R2: true count, not the claim-capped estimate). count(*) is int8 and
 * reaches pg clients as a string; the age is cast int4 — Number() both.
 */
export const WEBHOOK_BACKLOG_SQL = `SELECT count(*) AS c, COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at))),0)::int AS oldest FROM events WHERE fanout_complete_at IS NULL`;
