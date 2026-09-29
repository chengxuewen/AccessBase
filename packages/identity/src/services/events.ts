/**
 * Q4c durable events outbox (spec 2026-09-24-q4c rev.2 §4).
 *
 * ONE insert on the caller's handle: when the funnel was invoked inside a
 * caller-owned transaction (routeTx / UserManager.transaction), the event row
 * commits or rolls back ATOMICALLY with the mutation — the fail-closed
 * durable-trail rule. A funnel called WITHOUT a handle runs write+emit as two
 * autocommit statements (accepted window, same posture as bumpAuthState).
 *
 * NEVER swallow emit errors at call sites — a silent catch would void the
 * trail guarantee (spec §4, B4).
 */
import type { DbLike } from '../db/index.js';
import { events } from '../db/schema.js';

/** Event catalog (append-only strings — subscription filters are plain text). */
export type DomainEventType =
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'user.suspended'
  | 'role.changed'
  | 'tenant.created'
  | 'tenant.updated'
  | 'tenant.suspended'
  | 'tenant.deleted'
  | 'apikey.revoked'
  | 'group.changed'
  | 'webhook.test'
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.logout'
  // R-audit spec D5/U8: sanctioned-erasure broadcast (payload carries ids +
  // counts only — never legalBasis, never the subject email).
  | 'audit.erased';

export interface EmitEventInput {
  tenantId: string;
  type: DomainEventType;
  /** Non-secret projections only (id/email/name/slug/op/...) — never secrets, tokens, hashes. */
  payload: Record<string, unknown>;
}

export async function emitEvent(d: DbLike, ev: EmitEventInput): Promise<void> {
  await d.insert(events).values({ tenantId: ev.tenantId, type: ev.type, payload: ev.payload });
}
