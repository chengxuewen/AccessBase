/**
 * 4A T3 — minimal AuthZEN PDP (spec rev.4 §3 T3; rulings D-4=B / F-07 /
 * F-15 / S3-3 / PH-9). Mounted at /api/v1/authzen (P1 host-root-unreachable
 * precedent) exposing the AuthZEN Authorization API 1.0 evaluation surface:
 *
 *   POST /access/v1/evaluation    single {subject,resource,action} → boolean
 *   POST /access/v1/evaluations   batch (hard cap 50, request-order replies)
 *   GET  /.well-known/authzen-configuration  discovery — advertises the REAL
 *                                 nested URLs + discloses ≤30s policy-cache
 *                                 freshness (F-15)
 *
 * Caller model (fixed day one — Keycloak's mid-stream tightening is the
 * lesson): MACHINE-TO-MACHINE ONLY. JWT bearers are 403'd; ab_ API keys must
 * carry `authzen:evaluate` (or `*`). The scope gate is PLUGIN-LOCAL (SCIM
 * precedent, scim.ts) — authzen:evaluate is deliberately NOT in
 * routePermissions, so the global permission engine never sees it. Missing
 * scopes arrays DENY here (no `?? ['*']` default — the authenticate-level
 * default keeps existing keys working on data-plane routes, but a PDP
 * credential that never explicitly opted in must not silently become an
 * oracle; sec M-3).
 *
 * Every evaluation is audited: the handler stashes an identifier-free
 * decision ({decision, matchedCode:'authzen:evaluate'}) that the audit
 * middleware seals into the row (PH-9 — PDP rows never have NULL decisions).
 * Batch requests audit COARSE (one row, decision = allow iff all items
 * allowed); per-item rows need the storage seam and ride the integration
 * battery (owed ledger, F-23).
 *
 * Rate limiting: per-key 120/min windowed counter, in-process (multi-node
 * deployments get a per-node limit — documented; F-15). No search endpoints
 * (Keycloak parity — client-triggered backlog).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { GroupManager } from '@accessbase/identity';
import { config } from '../config.js';
import { getPermissionManager } from '../utils/permission.js';
import { getUserManager } from '../utils/managers.js';
import { BUILTIN_PERMISSIONS } from './permissions-seed.js';
import {
  evaluateAuthZen,
  type AuthZenResolutionDeps,
  type AuthZenEvalResult,
} from '../utils/authzen-resolve.js';
import { DEFAULT_TENANT } from '../utils/constants.js';

const BATCH_CAP = 50;
const RATE_LIMIT_PER_MIN = 120;
const POLICY_CACHE_FRESHNESS_SECONDS = 30;

// ---------------------------------------------------------------------------
// deps wiring (lazy memo — one GroupManager, no per-request pools; PIT-081)
// ---------------------------------------------------------------------------
let gm: GroupManager | null = null;
function getGroupManager(): GroupManager {
  gm ??= new GroupManager();
  return gm;
}

async function authZenDeps(): Promise<AuthZenResolutionDeps> {
  const um = await getUserManager();
  const pm = getPermissionManager();
  const groupManager = getGroupManager();
  return {
    findSubject: (id, tenantId) => um.findById(id, tenantId),
    hasPermission: (userId, code, tenantId) => pm.hasPermission(userId, code, tenantId),
    getUserDataScope: (userId, code, tenantId) => pm.getUserDataScope(userId, code, tenantId),
    getDepartmentIdsForUser: (userId, tenantId) =>
      groupManager.getDepartmentIdsForUser(userId, tenantId),
    isWithinScope: (targetUserId, scope) => um.isWithinScope(targetUserId, scope),
    knownCodes: new Set(BUILTIN_PERMISSIONS.map((p) => p.name)),
  };
}

// Test seam: script the resolution matrix without a DB (api-keys precedent).
let injectedDeps: AuthZenResolutionDeps | undefined;
export function setAuthZenDepsForTest(deps: AuthZenResolutionDeps): void {
  injectedDeps = deps;
}
export function resetAuthZenDepsForTest(): void {
  injectedDeps = undefined;
}

// ---------------------------------------------------------------------------
// per-key rate limit (F-15) — in-process windowed counter, key id scoped
// ---------------------------------------------------------------------------
const rateBuckets = new Map<string, { windowStart: number; count: number }>();
function allowRate(keyId: string): boolean {
  const now = Date.now();
  // Opportunistic sweep (review #4): expired buckets for departed keys would
  // otherwise grow the map monotonically; sweep when it gets bulky.
  if (rateBuckets.size > 1024) {
    for (const [k, b] of rateBuckets) {
      if (now - b.windowStart >= 60_000) rateBuckets.delete(k);
    }
  }
  const bucket = rateBuckets.get(keyId);
  if (!bucket || now - bucket.windowStart >= 60_000) {
    rateBuckets.set(keyId, { windowStart: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_PER_MIN;
}
export function resetAuthZenRateLimitForTest(): void {
  rateBuckets.clear();
}

function err(code: string, message: string): { success: false; error: { code: string; message: string } } {
  return { success: false, error: { code, message } };
}

/** Plugin-local caller gate — machine-to-machine only (see header). */
async function gate(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const user = request.user as { type?: string; scopes?: unknown; sub?: string } | undefined;
  if (!user?.sub) {
    await reply.status(401).send(err('AUTH_001', 'Authentication required'));
    return false;
  }
  if (user.type !== 'apikey') {
    await reply.status(403).send(
      err(
        'AUTHZEN_001',
        'AuthZEN evaluation is a machine-to-machine surface — use an API key with the authzen:evaluate scope',
      ),
    );
    return false;
  }
  // sec M-3: missing scopes arrays DENY here — no ['*'] default at this gate.
  const scopes = Array.isArray(user.scopes) ? (user.scopes as string[]) : [];
  if (!scopes.includes('authzen:evaluate') && !scopes.includes('*')) {
    await reply.status(403).send(
      err(
        'AUTHZEN_002',
        "Token scope does not permit AuthZEN evaluation (requires 'authzen:evaluate')",
      ),
    );
    return false;
  }
  if (!allowRate(user.sub)) {
    await reply.status(429).send(err('AUTHZEN_003', 'AuthZEN evaluation rate limit exceeded for this key'));
    return false;
  }
  return true;
}

function stashDecision(request: FastifyRequest, result: AuthZenEvalResult, code: string): void {
  (request as { auditDecision?: unknown }).auditDecision = {
    decision: result.decision ? 'allow' : 'deny',
    matchedCode: code,
  };
}

interface AuthZenSubject {
  id?: unknown;
  type?: unknown;
}
interface AuthZenResource {
  type?: unknown;
  id?: unknown;
}

export async function authzenRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // GET /.well-known/authzen-configuration — discovery advertises the REAL
  // nested URLs (D-4=B) + the policy-cache freshness disclosure (F-15).
  app.get('/.well-known/authzen-configuration', async (request, reply) => {
    const g = await gate(request, reply);
    if (!g) return;
    const base = `${config.oauthRedirectBase}/api/v1/authzen`;
    reply.header('x-request-id', request.id);
    return {
      policy_decision_point: `${config.oauthRedirectBase}/oidc`,
      authzen_evaluation_endpoint: `${base}/access/v1/evaluation`,
      authzen_evaluations_endpoint: `${base}/access/v1/evaluations`,
      policy_cache_freshness_seconds: POLICY_CACHE_FRESHNESS_SECONDS,
    };
  });

  // POST /access/v1/evaluation — single evaluation.
  app.post('/access/v1/evaluation', async (request, reply) => {
    const g = await gate(request, reply);
    if (!g) return;
    reply.header('x-request-id', request.id);
    const body = (request.body ?? {}) as {
      subject?: AuthZenSubject;
      resource?: AuthZenResource;
      action?: { name?: unknown };
    };
    const subjectId = typeof body.subject?.id === 'string' ? body.subject.id : undefined;
    const resourceType = typeof body.resource?.type === 'string' ? body.resource.type : undefined;
    const actionName = typeof body.action?.name === 'string' ? body.action.name : undefined;
    const resourceId = typeof body.resource?.id === 'string' ? body.resource.id : undefined;
    if (!subjectId || !resourceType || !actionName) {
      return reply
        .status(400)
        .send(err('AUTHZEN_004', 'subject.id, resource.type and action.name are required strings'));
    }
    const deps = injectedDeps ?? (await authZenDeps());
    const result = await evaluateAuthZen(deps, {
      subjectId,
      resourceType,
      actionName,
      resourceId,
      tenantId: request.tenantId ?? DEFAULT_TENANT,
    });
    stashDecision(request, result, 'authzen:evaluate');
    return { decision: result.decision, context: {} };
  });

  // POST /access/v1/evaluations — batch; hard cap; request-order replies.
  app.post('/access/v1/evaluations', async (request, reply) => {
    const g = await gate(request, reply);
    if (!g) return;
    reply.header('x-request-id', request.id);
    const body = (request.body ?? {}) as {
      subject?: AuthZenSubject;
      evaluations?: Array<{ resource?: AuthZenResource; action?: { name?: unknown } }>;
    };
    const subjectId = typeof body.subject?.id === 'string' ? body.subject.id : undefined;
    const items = Array.isArray(body.evaluations) ? body.evaluations : [];
    if (!subjectId || items.length === 0) {
      return reply
        .status(400)
        .send(err('AUTHZEN_004', 'subject.id and a non-empty evaluations array are required'));
    }
    if (items.length > BATCH_CAP) {
      return reply
        .status(400)
        .send(err('AUTHZEN_005', `evaluations batch exceeds the hard cap of ${BATCH_CAP}`));
    }
    const tenantId = request.tenantId ?? DEFAULT_TENANT;
    const deps = injectedDeps ?? (await authZenDeps());
    const results: Array<{ decision: boolean; context: Record<string, never> }> = [];
    let anyDeny = false;
    for (const item of items) {
      const resourceType = typeof item.resource?.type === 'string' ? item.resource.type : undefined;
      const actionName = typeof item.action?.name === 'string' ? item.action.name : undefined;
      const resourceId = typeof item.resource?.id === 'string' ? item.resource.id : undefined;
      const result = await evaluateAuthZen(deps, {
        subjectId,
        resourceType: resourceType ?? '',
        actionName: actionName ?? '',
        resourceId,
        tenantId,
      });
      if (!result.decision) anyDeny = true;
      results.push({ decision: result.decision, context: {} });
    }
    // COARSE batch provenance (F-23 honest note): one audit row per REQUEST —
    // deny iff any item denied. Per-item rows ride the integration battery.
    (request as { auditDecision?: unknown }).auditDecision = {
      decision: anyDeny ? 'deny' : 'allow',
      matchedCode: 'authzen:evaluations',
    };
    return { evaluations: results };
  });
}
