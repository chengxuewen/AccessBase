/**
 * Drain flag (Q2a F — rev.2 F-F4): set by index.ts shutdown BEFORE app.close()
 * so /health/ready can fail fast while the close chain runs. Named module
 * instead of an index.ts global — routes importing the entry would cycle.
 * Honest limit: the flag's practical window is the onClose hook-chain
 * duration; load-balancer drain windows are the preStop-sleep story (Q2 ops
 * doc), not this code.
 */
let draining = false;

export function setDraining(): void {
  draining = true;
}

export function isDraining(): boolean {
  return draining;
}

/** Test seam (per-file isolation makes this safe). */
export function _resetDrainingForTest(): void {
  draining = false;
}
