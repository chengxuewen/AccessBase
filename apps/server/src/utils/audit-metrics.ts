import { Gauge } from 'prom-client';

/**
 * R-audit A4: audit anchor Prometheus instruments. Module-level singletons —
 * same posture as routes/metrics.ts and webhook-metrics.ts (module cache makes
 * registration idempotent; the only gate that instantiates them never runs
 * under NODE_ENV=test).
 */
export const auditAnchorLastRootOk = new Gauge({
  name: 'accessbase_audit_anchor_last_root_ok',
  help: '1 when the last anchor tick committed AND its root export (if configured) succeeded; 0 otherwise.',
});

export const auditAnchorLastRootTimestamp = new Gauge({
  name: 'accessbase_audit_anchor_last_root_timestamp_seconds',
  help: 'Unix seconds of the last successful anchor commit (AccessbaseAuditAnchorStalled alert input).',
});
