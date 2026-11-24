/**
 * 4A T1 (P-3=B): CAEP/RISC revocation enqueue — manager-funnel discipline.
 *
 * Rows are inserted on the CALLER's transaction handle (emitEvent precedent,
 * Q4c §4): a suspend/delete invoked inside routeTx commits the delivery rows
 * ATOMICALLY with the mutation — a crash between the mutation and the enqueue
 * cannot silently void the revocation signal (sec L-3).
 *
 * Coverage is BY CONSTRUCTION: every suspend/delete path funnels through
 * UserManager.changeStatus / delete (SCIM PATCH active=false included —
 * panel run 2 PC-2 falsified the route-layer enumeration that missed both
 * PATCH arms). Future mutation paths inherit the enqueue automatically.
 *
 * oidc_clients is a PLATFORM-level table (no tenantId): deliveries target
 * every client that opted in via caep_endpoint_uri, tagged with the
 * subject's tenantId for traceability.
 */
import { randomUUID } from 'node:crypto';
import { isNotNull } from 'drizzle-orm';
import type { DbLike } from '../db/index.js';
import { caepDeliveries, oidcClients } from '../db/schema.js';

/** SSE/RISC wire URNs — the vocabulary stored on caep_deliveries rows. */
export const CAEP_EVENT_TYPES = {
  /** changeStatus → suspended (SCIM active=false included). */
  suspended: 'https://schemas.openid.net/secevent/risc/event-type/account-disabled',
  /** delete — hard delete emits account-purged (RISC). */
  deleted: 'https://schemas.openid.net/secevent/risc/event-type/account-purged',
} as const;

export type CaepEnqueueKind = keyof typeof CAEP_EVENT_TYPES;

export interface CaepEnqueueInput {
  tenantId: string;
  subjectId: string;
  kind: CaepEnqueueKind;
}

/**
 * Insert one pending delivery per opted-in client. Returns the number of
 * rows enqueued (0 = no CAEP receivers — the common case, zero cost).
 * jti is allocated here and NEVER changes (at-least-once dedup key).
 */
export async function enqueueCaepRevocations(
  d: DbLike,
  opts: CaepEnqueueInput,
): Promise<number> {
  const targets = await d
    .select({ id: oidcClients.id })
    .from(oidcClients)
    .where(isNotNull(oidcClients.caepEndpointUri));
  if (!targets.length) return 0;
  const now = new Date();
  await d.insert(caepDeliveries).values(
    targets.map((t) => ({
      tenantId: opts.tenantId,
      clientId: t.id,
      eventType: CAEP_EVENT_TYPES[opts.kind],
      subjectId: opts.subjectId,
      jti: randomUUID(),
      status: 'pending' as const,
      attempts: 0,
      nextAttemptAt: now,
    })),
  );
  return targets.length;
}
