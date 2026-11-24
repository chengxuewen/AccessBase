/**
 * requirePermission — route-level permission enforcement (Task 9).
 *
 * Registered as a preHandler *after* app.authenticate, so request.user is
 * already populated by @fastify/jwt. Routes without a mapping in
 * getRequiredPermission pass through untouched (progressive enforcement,
 * same semantics as authorize.ts).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getRequiredPermission, PermissionManager } from '@accessbase/identity';
import type { AuditAuthzDecision } from '@accessbase/audit';
import { DEFAULT_TENANT } from './constants.js';

/**
 * 4A T2 (D-2=A): authorization provenance stash — read by the audit
 * middleware (packages/audit) at onResponse and sealed into the D1 row hash.
 * Four gate arms stash: JWT allow/deny, apikey allow/deny (F-11 — the apikey
 * arms were the pre-fix silent-NULL holes). Identifier-free shape ONLY
 * ({decision, matchedCode, scope?}) — extra fields would survive RTBF
 * erasure (S2-3). scope enrichment (users-surface binding) = ledger.
 */
type AuditDecisionCarrier = FastifyRequest & { auditDecision?: AuditAuthzDecision };
function stashDecision(request: FastifyRequest, decision: AuditAuthzDecision): void {
  (request as AuditDecisionCarrier).auditDecision = decision;
}

/** JWT access-token payload signed in routes/auth.ts issueTokenPair. */
interface TokenPayload {
  sub: string;
  email?: string;
  tenantId?: string;
}

/**
 * Lazy module-level singleton: PermissionManager's ctor builds a pg Pool per call
 * (connections are lazy, but pools pile up per request without reuse). One per
 * process mirrors the per-route-module instance convention (permissions.ts).
 */
let pm: PermissionManager | null = null; // lazy module singleton; pg pool is lazy — connects on first query
export function getPermissionManager(): PermissionManager {
  pm ??= new PermissionManager();
  return pm;
}
export function requirePermission() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const required = getRequiredPermission(request.method, request.url);
    if (!required) return;
    // API keys bypass permission checks in v1: scopes are ['*'] only, and keyId
    // is not a user id — hasPermission(sub, ...) would 403 every key request
    // (deadlock). Scope engine is a spec non-goal for now.
    const payload = request.user as TokenPayload & { type?: string; scopes?: string[] };
    if (payload.type === 'apikey') {
      // Carve-out: keys may not manage keys (self-proliferation would defeat
      // revocation-as-remediation). Management requires an interactive JWT.
      if (required.startsWith('apikeys:')) {
        request.log.warn(
          { userId: payload.sub, required },
          'API key denied on key-management route',
        );
        stashDecision(request, { decision: 'deny', matchedCode: required });
        await reply.status(403).send({
          success: false,
          error: { code: 'PERM_002', message: 'API keys cannot manage API keys' },
        });
        return;
      }
      const scopes = (payload as { scopes?: string[] }).scopes ?? ['*'];
      if (!scopes.includes('*')) {
        stashDecision(request, { decision: 'deny', matchedCode: required });
        await reply.status(403).send({
          success: false,
          error: { code: 'PERM_003', message: 'Insufficient token scope' },
        });
        return;
      }
      // F-11: the apikey ALLOW arm records provenance too — this was the
      // pre-fix silent-NULL hole (every apikey data-plane write audited with
      // a NULL decision, indistinguishable from legacy rows).
      stashDecision(request, { decision: 'allow', matchedCode: required });
      return; // allow on data-plane routes
    }
    const user = request.user as TokenPayload;
    const ok = await getPermissionManager().hasPermission(
      user.sub,
      required,
      user.tenantId ?? DEFAULT_TENANT,
    );
    if (!ok) {
      request.log.warn({ userId: user.sub, required }, 'Permission denied');
      stashDecision(request, { decision: 'deny', matchedCode: required });
      await reply.status(403).send({
        success: false,
        error: { code: 'PERM_001', message: 'Insufficient permissions' },
      });
      return;
    }
    stashDecision(request, { decision: 'allow', matchedCode: required });
  };
}
