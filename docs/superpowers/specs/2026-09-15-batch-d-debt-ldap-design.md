# Batch D Design — Audit Actor Attribution Fix + Real LDAP Provider

**Status**: Approved 2026-09-15 (user confirmed via "按推荐" — two-workflow scope from P2 decomposition)
**Origin**: Batch C final-review pre-existing debt (audit actor 'anonymous') + gap-analysis P1 carryover (LdapProvider 75-line stub, identity-sdd §2.1 design exists, error codes AUTH_063-065 pre-reserved)
**Execution**: Batch A/B/C protocol — subagent-driven, per-task review, team adversarial review before dispatch

## 1. Scope — two independent workflows

### D1: Audit actor attribution fix (pre-existing debt package)

Current state (verified): packages/audit/src/middleware.ts has FOUR `user?.id || 'anonymous'`
sites (:86/:124/:130/:157). JWT payload carries only `sub` (no `id`) → every generic
audit write records actor 'anonymous'. Batch C's CSV export made this visible: actor
column all-anonymous, actor filter parameter effectively unusable.

Change:
- All four sites → `user?.id ?? user?.sub ?? 'anonymous'` (JWT→sub, API key→keyId,
  system jobs→system semantics preserved where 'system' literal already used).
- Audit package tests: update/extend the four assertions (sub preferred, id fallback,
  anonymous fallback, apikey keyId as sub).
- Consumer side (audit.ts actor ilike filter, CSV actor column) inherits automatically — zero changes.
- Historical rows keep 'anonymous' (no migration — forward-fix only).
- Companion debt: e2e/auth-session.spec.ts carries 1 `test.fail()` (conventions require
  zero outstanding). Executor judges: if the bug it pins is fixed, remove the marker and
  let the test go green (D114); if genuinely still broken, fix the bug in this batch.

### D2: Real LDAP provider (largest single feature gap)

Current state (verified): LdapProvider.ts is a 75-line all-stub (every method throws
'Not implemented'). identity-sdd §2.1 pre-designs Admin Bind mode: connect → admin bind →
search user → user bind → sync attributes → auto-provision → auth result. Error codes
AUTH_063/064/065 pre-reserved. No LDAP client library in dependencies.

Deliverables:
1. Add `ldapts` (modern ESM LDAP client) — the batch's ONLY new dependency.
2. LdapProvider five methods, real: connect (ldapts Client), admin bind, searchUser
   (uid filter), user-bind verification, syncAttributes (mail/displayName mapping),
   autoProvision (inserts users row, status='active' — LDAP is a trusted source).
3. LdapConfig type completion: url, baseDn, bindDn, bindPassword, userFilter, attributeMap.
4. Config channel: options-table keys (ldap_url, ldap_base_dn, ldap_bind_dn,
   ldap_bind_password, ldap_user_filter) with env fallbacks — same pattern as C2 password
   policy; bind_password auto-matches SENSITIVE_KEY_PATTERN (zero new masking machinery).
5. Login route: POST /api/v1/auth/ldap/login {username, password} → provider.authenticate →
   issueTokenPair WITH status claim — Batch A disable semantics (suspend→revoke) apply to
   LDAP users automatically.
6. Error codes: AUTH_063 (connection failure, 500), AUTH_064 (auth failure, 401),
   AUTH_065 (attribute sync failure, 500).
7. Testing: ldapts fully mocked (no real LDAP server needed); unit chain per step +
   three error branches + route 401/500 semantics; one mock-API e2e login flow.

## 2. Testing and acceptance

- D1: four middleware assertions (sub preferred / id fallback / anonymous fallback /
  apikey keyId); audit package build; test.fail disposition documented in report.
- D2: unit full chain (mocked ldapts per step), three error-code branches, route
  auth-failure/connection-failure semantics, e2e login happy path.
- Global gates: vitest full / tsc ×2 / e2e baseline zero new failures.

## 3. Explicit non-goals

- No SAML SP, no groups/tenants (Batch E candidates).
- No LDAP group→role mapping (attributeMap v1 = mail/displayName only).
- No LDAPS certificate management UI, no connection pooling.
- No SMS / magic link / SCIM.
- No migration of historical 'anonymous' audit rows.

## 4. Risks

- ldapts version pinning (current stable, lockfile committed).
- LDAP bind config contains a secret → options keys auto-masked by SENSITIVE_KEY_PATTERN.
- parallel: D1 (audit package + e2e) and D2 (identity package + server routes) have
  disjoint file surfaces — dispatchable in parallel with explicit path boundaries.
