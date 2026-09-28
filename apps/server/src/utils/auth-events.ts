/**
 * R1-T3 auth.* domain events — fire-and-forget telemetry over the shared
 * authDb() pool (plan 2026-09-28-batch-r1 §Task 3).
 *
 * SANCTIONED EXCEPTION to the events.ts "NEVER swallow emit errors" rule
 * (Momus R5): auth events pair with NO mutation — a login/logout is already
 * settled by the time we emit, and a failed telemetry insert must never fail
 * (or delay) the response. The whole body is therefore try/catch-wrapped (sync
 * throws such as an authDb() boot failure) AND the floating insert promise
 * carries a .catch → logger.warn. There is no trail guarantee to void here:
 * the audit log remains the security record of choice; events here are
 * webhook/subscription telemetry.
 *
 * Payload discipline: { email, method } (+ userId where known, + reason on
 * failure) — never passwords, tokens, or flow material.
 */
import { emitEvent } from '@accessbase/identity';
import { logger } from '@accessbase/logging';
import { authDb } from './managers.js';

/** Sign-in surfaces wired in R1-T3 (oauth/saml/webauthn/ldap/sms/magic = R-schedule). */
export type AuthEventMethod = 'password' | 'totp' | 'admin-wizard';
export type AuthEventReason = 'bad_credentials' | 'locked' | 'suspended' | 'other';

export interface AuthEventInput {
  type: 'auth.login.success' | 'auth.login.failure' | 'auth.logout';
  tenantId: string;
  /** Omitted on failure arms with no resolved user row (bad_credentials/locked pre-lookup). */
  userId?: string;
  email: string;
  method: AuthEventMethod;
  reason?: AuthEventReason;
}

export function emitAuthEvent(input: AuthEventInput): void {
  try {
    const payload: Record<string, unknown> = { email: input.email, method: input.method };
    if (input.userId !== undefined) payload['userId'] = input.userId;
    if (input.reason !== undefined) payload['reason'] = input.reason;
    void emitEvent(authDb(), {
      tenantId: input.tenantId,
      type: input.type,
      payload,
    }).catch((err: unknown) => {
      logger.warn({ err, type: input.type }, 'auth event failed');
    });
  } catch (err) {
    logger.warn({ err, type: input.type }, 'auth event failed');
  }
}
