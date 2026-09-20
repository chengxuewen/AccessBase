# Task 2 report — bootstrap endpoint + belt + force-logout scoping (L′)

## Delivered
- routes/tenants.ts: POST /:id/bootstrap per spec D2 nine-step order — belt FIRST (403 TENANT_PLATFORM_ONLY, no state leak), default-target 409, exists/active checks, email replay-arm (user ∈ tenant → re-run stamp+bind+assign → 200 alreadyBootstrapped; other-tenant → 409 EMAIL_EXISTS), route-layer user_create policy (400 WEAK_PASSWORD), roleManager.create find-or-create + UNCONDITIONAL direct-SQL isSystem stamp (B6), strict bindPermissions(9) BEFORE user create (X4 order), assignToUser. platformBelt also wired on POST/PUT/DELETE mutations (B3, closes '*'-scope key class).
- routes/users.ts: force-logout tenant gate — findById(id, request.tenantId ?? DEFAULT) → 404 before revoke (B5).
- NEW tenants-bootstrap.test.ts: 14 cases — happy path full order (role create args, stamp UPDATE set({isSystem:true}), bind called with TENANT_BINDABLE_PERMISSIONS identity, user create in TARGET tenant, assign), X4 abort-before-create, belt-first (findById NOT called), default 409, 404, suspended 409, EMAIL_EXISTS 409 + no writes, weak pw 400 + no writes, replay 200 (+skips policy), belt×3 mutations, platform happy path unaffected.
- users-import.test.ts: UserManager mock gained findById (B5 gate); +2 cases (cross-tenant 404 revokes NOTHING; lookup-before-revoke order).

## Decisions/deviations
- name optional in schema (spec) → falls back to email when absent (UserManager requires name). Documented in code comment; T4 modal always sends name.
- 400 policy envelope code 'WEAK_PASSWORD' (wizard vocabulary reused; spec allowed AUTH_REG_002 pattern — chose wizard's string for UI i18n reuse).
- T4 contract pinned beyond D2: bootstrap REPLAY response is 200 (not 201) — T4 mock table says `alreadyBootstrapped:true` → 200.
- belt covers POST/PUT/DELETE /tenants* (B3) — T6 V-list should note apikey '*' construction is belt-tested only via JWT claim injection (true apikey live-fire in T6 curl with key row insert).

## Gates (actuals)
- vitest apps/server: 46 files / 518 passed / 0 failed
- root tsc: 0 errors
- eslint changed surface: 0 errors (4 warnings = pre-existing import()-type idiom in test mocks)
- files: apps/server/src/routes/{tenants,users}.ts + __tests__/{tenants-bootstrap.test.ts (new), users-import.test.ts}
