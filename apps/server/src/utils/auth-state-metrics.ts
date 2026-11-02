import { Counter } from 'prom-client';

/**
 * G1 (gap-map 2026-10-12): the Q3A revocation reader fails OPEN on DB errors
 * by ruling (a blip must never lock everyone out) — but a DEAD database would
 * silently disable ALL revocation checks while every surface stays green.
 * This counter makes that state visible. T2 of the gap-remediation batch.
 *
 * Import discipline (dual-Momus finding R3/B6): webhook-metrics.ts is imported
 * ONLY by the dispatcher wiring (conditional) and never registers under
 * NODE_ENV=test — this module is imported UNCONDITIONALLY by utils/auth-state.ts
 * so the series exists on /metrics in every environment.
 */

export const authStateReadErrorsTotal = new Counter({
  name: 'accessbase_authstate_read_errors_total',
  help: 'Auth-state reader DB failures (fail-open posture — each increment is a window where revocation checks were skipped).',
});
