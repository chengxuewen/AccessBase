/**
 * 4A T3 — AuthZEN subject-bound resolution (spec rev.4 §3 T3; rulings
 * D-4=B / F-07 / S3-3 / PH-9). This module is deliberately ISOLATED from
 * utils/data-scope.ts: that module is CALLER-bound and fail-SOFT (null
 * binding → tenant-wide all — correct for the platform's own routes, where
 * requirePermission has already 403'd unknown codes and a cache race must
 * never brick a legitimate admin). The PDP answers to EXTERNAL callers with
 * a credential that can query any user in the tenant — here, absence of
 * information must mean DENY:
 *
 *   1. identifier hygiene — resource.type / action.name containing ':' are
 *      rejected outright (they would forge multi-segment codes; S3-3).
 *   2. code whitelist — the composed `type:name` must exist in the seeded
 *      permission catalog; unknown codes are FALSE, never best-effort.
 *   3. subject existence — findById scoped to the CALLER's tenant; unknown
 *      or cross-tenant subjects are FALSE (never the fail-soft tenant-wide
 *      fallback — F-07 is BANNED here, enforced by this module not importing
 *      data-scope.ts at all).
 *   4. code-level permission — hasPermission miss → FALSE.
 *   5. users-surface row check — governed codes (users:*) with a resource.id
 *      resolve the SUBJECT's data-scope binding: null binding → FALSE
 *      (fail-CLOSED), then the row must sit inside the subject's scope
 *      (self/dept/all — dept resolves groups here, not in the caller).
 *
 * Every dependency is injected; units script the whole matrix without a DB.
 */
import type { UserScopeFilter } from '@accessbase/identity';

export interface AuthZenResolutionDeps {
  /** Tenant-scoped subject existence (UserManager.findById). */
  findSubject: (subjectId: string, tenantId: string) => Promise<unknown>;
  hasPermission: (userId: string, code: string, tenantId: string) => Promise<boolean>;
  /** 'self' | 'dept' | 'all' | null (PermissionManager.getUserDataScope). */
  getUserDataScope: (
    userId: string,
    code: string,
    tenantId: string,
  ) => Promise<'self' | 'dept' | 'all' | null>;
  getDepartmentIdsForUser: (userId: string, tenantId: string) => Promise<string[]>;
  /** Row-arm predicate (UserManager.isWithinScope — users table only). */
  isWithinScope: (targetUserId: string, scope: UserScopeFilter) => Promise<boolean>;
  /** Seeded permission catalog (BUILTIN_PERMISSIONS names). */
  knownCodes: ReadonlySet<string>;
}

export interface AuthZenEvalParams {
  subjectId: string;
  resourceType: string;
  actionName: string;
  resourceId?: string | undefined;
  tenantId: string;
}

export interface AuthZenEvalResult {
  decision: boolean;
  /** Machine-readable deny reason — NEVER echoed into the response body
   * (deny-cause disclosure would let a caller enumerate the catalog). */
  reason:
    | 'invalid-identifier'
    | 'unknown-code'
    | 'unknown-subject'
    | 'permission-denied'
    | 'no-scope-binding'
    | 'row-out-of-scope'
    | 'ok';
}

/** Codes whose rows the v1 data-scope surface governs (data-scope.ts A2). */
const USERS_SURFACE_PREFIX = 'users:';

export async function evaluateAuthZen(
  deps: AuthZenResolutionDeps,
  params: AuthZenEvalParams,
): Promise<AuthZenEvalResult> {
  // 1. identifier hygiene (S3-3): ':' in either half would forge
  //    multi-segment codes ('users:read:write' → code 'users:read:write').
  if (
    params.resourceType.includes(':') ||
    params.actionName.includes(':') ||
    params.resourceType.length === 0 ||
    params.actionName.length === 0
  ) {
    return { decision: false, reason: 'invalid-identifier' };
  }
  const code = `${params.resourceType}:${params.actionName}`;
  // 2. catalog whitelist — unknown codes are FALSE.
  if (!deps.knownCodes.has(code)) {
    return { decision: false, reason: 'unknown-code' };
  }
  // 3. subject existence, tenant-scoped — unknown/cross-tenant → FALSE.
  const subject = await deps.findSubject(params.subjectId, params.tenantId);
  if (subject === null || subject === undefined) {
    return { decision: false, reason: 'unknown-subject' };
  }
  // 4. code-level permission.
  if (!(await deps.hasPermission(params.subjectId, code, params.tenantId))) {
    return { decision: false, reason: 'permission-denied' };
  }
  // 5. users-surface row check (F-07: null binding → FALSE — never fail-soft).
  if (code.startsWith(USERS_SURFACE_PREFIX) && params.resourceId !== undefined) {
    const binding = await deps.getUserDataScope(params.subjectId, code, params.tenantId);
    if (binding === null) {
      return { decision: false, reason: 'no-scope-binding' };
    }
    let filter: UserScopeFilter;
    if (binding === 'self') {
      filter = { kind: 'self', userId: params.subjectId };
    } else if (binding === 'dept') {
      const groupIds = await deps.getDepartmentIdsForUser(params.subjectId, params.tenantId);
      filter =
        groupIds.length > 0
          ? { kind: 'dept', userId: params.subjectId, groupIds }
          : { kind: 'self', userId: params.subjectId };
    } else {
      filter = { kind: 'all' };
    }
    const rowOk = await deps.isWithinScope(params.resourceId, filter);
    return rowOk
      ? { decision: true, reason: 'ok' }
      : { decision: false, reason: 'row-out-of-scope' };
  }
  return { decision: true, reason: 'ok' };
}
