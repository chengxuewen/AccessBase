# Task 1 report — identity hardening (L′)

## Delivered (all 9 plan bullets)
1. NEW services/permission-partition.ts — TENANT_BINDABLE(9)/PLATFORM_ONLY(12)/PERMISSION_NOT_BINDABLE tag/TENANT_BINDABLE_SET; DEFAULT_TENANT_ID re-exported from TenantManager; exports wired in identity index.ts.
2. RoleManager.setRolePermissions — X1 funnel: non-DEFAULT tenant + any resolved name outside bindable → throw `PERMISSION_NOT_BINDABLE: <name>` BEFORE the delete+insert (binding never touched). Unknown ids fall through to FK (unchanged).
3. checkInheritanceCycle — X3: now receives optional roleId; reaching roleId in the ancestor walk = new edge closes a cycle; self-parent detected via first hop. setParent passes roleId.
4. setParent — R6 moat: isSystem → ROLE_PROTECTED before any write.
5. assignToUser — G-1: .onConflictDoNothing() (composite-PK replay safety).
6. password-policy — G-3: PasswordPolicyCallsite + DEFAULTS extended with 'user_create' (register profile).
7. TenantManager — G-5: Tenant.isDefault (projection in mapToTenant; data-driven default-tenant flag for frontend).
8. permissions-seed.ts — strict kernel bindPermissions(db, roleId, names): ensure 21 → select-by-name → missing→throw → additive bind → count!==names→throw. seedBuiltinPermissions = thin best-effort wrapper (wizard/init/selfHeal never-throws contract preserved). RESOURCES/ACTIONS readback arrays deleted (name-based now).
9. conflict-mapper — PERMISSION_NOT_BINDABLE third tag → 409 (literal mirrored from identity per K discipline; header docblock updated).

## Tests (RED-first where behavior new)
- NEW packages/identity/src/__tests__/RoleManager.lprime.test.ts: 11 cases — funnel reject/allow/default-skip(2-select proof)/unknown-passthrough/create-path; setParent isSystem/self/mutual/legit-chain; assignToUser onConflict spy; partition counts+disjoint; user_create policy; isDefault true/false.
- NEW apps/server/src/__tests__/permissions-seed-lprime.test.ts: 5 cases — partition union==BUILTIN-21 invariant (X2 gate), strict missing-names throw, count-divergence throw, success, wrapper swallow+logger.error.
- permissions-seed.test.ts mockDb upgraded to new query shape (name readback + count assert; alternation) — behavior contract (21 codes, bind all, idempotent, no-throw) unchanged.
- cache-invalidation.test.ts: makeChain gained onConflictDoNothing (mock lag, not weakening).
- tenants.test.ts + api-keys.test.ts: two static-source assertions of the REMOVED RESOURCES array re-targeted to partition-list membership (same double-registration intent; batch-C incident class still pinned).

## Gates
- vitest packages/identity + apps/server: 798 passed / 0 failed (22+45 files)
- tsc root: 0 errors; identity dist rebuilt (pnpm --filter @accessbase/identity build)
- eslint changed surface: 0 errors; 7 warnings all pre-existing import()-type style in touched-but-untouched-line regions

## Notes for downstream
- T2 consumes: bindPermissions(db, roleId, TENANT_BINDABLE_PERMISSIONS), TENANT_BINDABLE_PERMISSIONS/PERMISSION_NOT_BINDABLE from '@accessbase/identity', roles.ts PUT/POST already funnel-covered via manager (no route change needed for X1)
- create() early-return returns raw DB row (pre-existing `as unknown as Role` cast) — untouched; bootstrap uses it only for .id
- route tests mocking '@accessbase/identity': mapper needs the new tag as LITERAL (it does — no import)
