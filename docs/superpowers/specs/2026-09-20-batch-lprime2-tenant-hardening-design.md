# Batch L″ — Tenant Control-Plane Hardening Follow-ups (Design)

**Date**: 2026-09-20
**Status**: DRAFT (bounded scope — spec approved by "继续" after L′ closeout)
**Depends on**: Batch L′ (partition/funnel/belt/bootstrap), Batch K (moats)

## Problem (found in L′ closeout audit)

1. **bootstrap replay-arm hole**: `POST /v1/tenants/:id/bootstrap` step 4 treats
   "email exists ∈ target tenant" as full convergence (200 replay). If the first
   attempt died between role-create and a successful bind (or the tenant's 'admin'
   role exists unbound from a failed deploy), re-invoke re-runs bind — wait, it
   DOES re-run bind+assign. The actual hole: replay arm's `alreadyBootstrapped:true`
   response asserts success, but if bindPermissions throws mid-replay the caller
   gets 500 with NO self-heal distinction, AND — the sharper defect — an email that
   exists in the tenant as a PLAIN user (created via users POST, not bootstrap) also
   short-circuits to 200 replay, silently promoting them to tenant admin. The
   replay arm must be "user holds the tenant admin role" not "user ∈ tenant".
2. **change-password cross-tenant audit** (L′ carry-over): resolved by inspection —
   issuance goes through `issueTokenPair` → `assertTenantActive` fail-closed gate;
   old sessions die with every password change (revokeAll); no leak vector. Pin with
   ONE regression test (suspended tenant's admin attempting change-password → 403,
   no session minted) instead of a feature task.
3. **Tenants page users-hint was dropped** (R9a): acceptable; but the page shows no
   "has admin yet?" signal, so operators cannot tell bootstrapped from dead-island
   tenants. Cheap fix: `adminCount` per tenant is over-engineering; the tenants
   LIST projection already knows its own row — add `bootstrapped: boolean`
   (EXISTS users∈tenant ∧ admin-role) to the list projection via one aggregate
   SQL in TenantManager.findAll? NO — cross-table coupling in the wrong package.
   Lazy path: the page can derive it from GET /v1/users?pageSize=1 per row = N+1
   requests. Verdict: defer until a real operator asks (YAGNI), track in backlog.

## Goals

- G1: bootstrap replay arm requires admin membership; a plain same-tenant user no
  longer gets silently promoted. Divergent-email cases get precise errors.
- G2: suspended-tenant change-password regression test (audit item closed with
  evidence, zero production code change — verified safe by reading).
- G3: full gate re-run (vitest/tsc/eslint/e2e serial/coverage) + live-fire re-run
  of the bootstrap matrix on a throwaway DB.

## Design

### D1: replay-arm condition = membership, not existence

In `routes/tenants.ts` bootstrap:
- `existingUser && existingUser.tenantId !== id` → 409 EMAIL_EXISTS (unchanged).
- `existingUser ∈ tenant`:
  - query membership: `roleManager.getUserRoles(existingUser.id, id)` → any role
    named 'admin' (the tenant's admin role) → replay arm 200 (re-run stamp+bind+
    assign — idempotent, converges the half-failed case).
  - NO admin membership → **409 EMAIL_EXISTS** with message
    'Email already registered in this tenant without admin role — use a different
    email or promote via Users page'. No silent promotion.
- Test matrix delta (tenants-bootstrap.test.ts): +1 case plain-user-same-tenant →
  409 + no bind/assign calls; replay case updated to pre-seed getUserRoles →
  [adminRole]; update e2e tenants-crud replay mock only if its /me or flow
  assertions depend (they do not — it mocks bootstrap directly).

### D2: change-password suspended-tenant pin (tests only)

auth.ts test suite: tenant suspended → POST /auth/change-password (valid old pw) →
403 AUTH_TENANT_001, no tokens, sessions untouched. Single case, no production code
(read-verified: gate lives inside issueTokenPair which change-password calls).

## Non-goals

- bootstrapped-column UI affordance (deferred, backlog).
- anything M-batch (metrics/backup/health-pool/compose-dev-schema).

## Success criteria

1. plain-user-same-tenant bootstrap → 409, role/bind/assign untouched (assert
   call counts); full-convergence replay still 200 + re-binds.
2. change-password suspended-tenant test green against REAL gate path (mock tenant
   manager + real issueTokenPair wiring via route test).
3. Gates: vitest root 914+2 new green · double tsc 0 · eslint changed surface 0 ·
   e2e workers=1 unchanged 137+3 · live-fire V3/V7 battery re-run (fresh DB) PASS.
4. Memory: status line append (L″), no new decisions (fix within D118 envelope).

## Risk ledger

- getUserRoles on a tenant with no roles = [] (verified signature) — no throw risk.
- The 409 message must not leak user existence to non-platform callers — belt is
  BEFORE this code, unreachable for non-platform ✓.
- e2e tenants-crud init-admin replay case mocks 200 directly — unaffected.
