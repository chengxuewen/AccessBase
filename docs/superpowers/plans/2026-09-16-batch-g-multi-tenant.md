# Batch G — Multi-tenant Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the multi-tenant foundation: tenants table + TenantManager + CRUD + permission codes, tenantId claim on all issuance paths, request-context injection, DEFAULT_TENANT retirement in routes, read-only frontend column.

**Architecture:** Isolation pipeline already exists (Manager queries take tenantId; perm cache keyed `perm:{tenantId}:{userId}`). G wires it: tenants table + manager + routes; tenantId claim at 6 issuance points (R0); gate inside 4 issueTokenPair helpers + refresh door (R1); authenticate reads claim → request.tenantId (JWT claim / apikey key-row) with DEFAULT_TENANT fallback (R7); routes consume request.tenantId instead of the constant.

**Tech Stack:** Fastify 4, Drizzle (db:push dev + drizzle-kit generate 0002 chain per R5), vitest, Playwright mock-API e2e.

**Spec:** docs/superpowers/specs/2026-09-16-batch-g-multi-tenant-design.md + -REVIEW-ADDENDUM.md (R0–R9; addendum overrides spec; read addendum FIRST).

## Global Constraints

- Permission codes dual-registered (authorize.ts routePermissions + permissions-seed BUILTIN_PERMISSIONS + RESOURCES 'tenants'); seed count 18→21; conventions.md check commands updated to =21 in this batch
- DEFAULT_TENANT retirement convergence check (R3): `grep -rn "DEFAULT_TENANT" apps/server/src --include='*.ts' | grep -v __tests__ | grep -v constants.ts | grep -v permissions-seed.ts | grep -v setup.ts` → zero hits at batch end
- setup.ts + env-bypass initializeAdmin KEEP the constant (no JWT to read); they become tenant-row first-writers (R6: insert-before-user-create, onConflictDoNothing)
- Default-tenant protection: update/delete against DEFAULT_TENANT → 409 TENANT_PROTECTED (R8)
- Suspended-tenant gate lives INSIDE the 4 issueTokenPair helpers + refresh door; authenticate does NO per-request tenant DB check (R8); 15m live-token window documented (R2); TenantManager.update suspend branch calls invalidatePermissionCache(tenantId) (R2)
- MFA verify + change-password re-issuance go through the same helpers → covered automatically (R1)
- Migration: drizzle-kit generate ONLY (produces sql + meta journal + snapshot) — never hand-written SQL (R5)
- Frontend column: failure → '—', no toast, no console error, failure cached in module scope, no retry (R4)
- TDD red-first (D114); pino object-style; English comments/commits; identity build after package changes (PIT-048); root tsc final (PIT-051); `git branch --show-current` after every commit (PIT-053); e2e numbers workers=1 low-load window (PIT-054)
- e2e precheck: 5101→000 + no_proxy exports

---

## Task 0: tenantId claim at all issuance points (R0)

**Files:**
- Modify: `apps/server/src/routes/auth.ts` (issueTokenPair ~:63 — add tenantId to jwt.sign payload; ~:473 mfa/verify inline sign; ~:973 inline sign)
- Modify: `apps/server/src/routes/oauth.ts` (issueTokenPair ~:280), `apps/server/src/routes/saml.ts` (~:91), `apps/server/src/routes/webauthn.ts` (~:91)
- Test: `apps/server/src/__tests__/route-guard.test.ts` (or nearest existing JWT-shape assertion site — implementer greps for the existing token-shape test and extends it)

**Interfaces:**
- Consumes: issueTokenPair(request, user) signatures — all four take user with id/email/status; user rows carry tenantId (users table) — use `user.tenantId ?? DEFAULT_TENANT`
- Produces: every access token JWT carries `tenantId` claim; inline sign sites (mfa/verify :473, :973) add the same claim sourced from the verified user row

- [ ] **Step 1: RED** — extend the token-shape test: decode issued access token, assert claim `tenantId === DEFAULT_TENANT` (fails: claim absent)
- [ ] **Step 2: Implement** — 4 helpers + 2 inline sites add `tenantId: user.tenantId ?? DEFAULT_TENANT` to the sign payload (import constant where not already imported)
- [ ] **Step 3: GREEN** — full `pixi run npx vitest run apps/server` green (batch A legacy-token tests unaffected: authenticate tolerates absent claim, presence is additive)
- [ ] **Step 4: tsc + commit** — `feat(server): tenantId claim on all token issuance paths (G)`

## Task 1: tenants table + TenantManager + seed (R5/R6/R8)

**Files:**
- Modify: `packages/identity/src/db/schema.ts` (tenants table per spec G1)
- Create: `packages/identity/src/managers/TenantManager.ts` + `packages/identity/src/__tests__/TenantManager.test.ts`
- Modify: `packages/identity/src/index.ts` (export TenantManager)
- Modify: `apps/server/src/routes/permissions-seed.ts` (self-heal inserts DEFAULT_TENANT row, onConflictDoNothing — placed where admin-role-dependent logic is safe; row insert is independent of admin role)
- Modify: `apps/server/src/routes/setup.ts` (bootstrap: BEFORE userManager.create — explicit first-writer insert, onConflictDoNothing; also env-bypass initializeAdmin path gets the same insert)
- Generate: `packages/migration/drizzle/` 0002 chain via `pixi run npx drizzle-kit generate` (sql + journal + snapshot — verify all three exist)
- Modify: `.agents/memorys/conventions.md` (seed 18→21 check commands)

**Interfaces:**
- Produces: `TenantManager` — `create({name, slug})`, `findAll({page,pageSize,search?})` paginated, `findById(id)`, `update(id, {name?, slug?, status?})`, `suspend`/`delete` soft-refuse semantics: any update/delete against DEFAULT_TENANT throws `TENANT_PROTECTED`; suspend branch calls `invalidatePermissionCache(tenantId)` (R2); slug unique (409-style error result)
- Table: `tenants(id uuid pk default gen_random_uuid(), name varchar(200) notNull, slug varchar(64) notNull unique, status varchar(20) notNull default 'active', createdAt, updatedAt)`; seed row id = DEFAULT_TENANT literal, slug 'default', name 'Default'

- [ ] **Step 1: schema + generate migration** — add table; `drizzle-kit generate`; verify meta/0002 snapshot + journal entry idx=2 exist (R5)
- [ ] **Step 2: RED TenantManager tests** — create/findAll/findById/update/suspend-refuses-default/delete-refuses-default (TENANT_PROTECTED)/slug-duplicate-error/invalidatePermissionCache called on suspend (spy on permission-cache module)
- [ ] **Step 3: Implement manager** → GREEN; `pnpm --filter @accessbase/identity build`; index export
- [ ] **Step 4: seed + bootstrap inserts** (permissions-seed self-heal + setup bootstrap pre-create + initializeAdmin) — tests: seed idempotent (second call no-op), bootstrap inserts before user create
- [ ] **Step 5: commit** — `feat(identity): tenants table + TenantManager with default-tenant protection (G)`

## Task 2: CRUD routes + permission codes (dual registration)

**Files:**
- Create: `apps/server/src/routes/tenants.ts` + `apps/server/src/__tests__/tenants.test.ts`
- Modify: `apps/server/src/app.ts` (register tenantsRoutes), `packages/identity/src/hooks/authorize.ts` (routePermissions: GET/POST/PUT/DELETE /api/v1/tenants), `apps/server/src/routes/permissions-seed.ts` (3 codes + RESOURCES 'tenants' → 21)

**Interfaces:**
- Produces: GET /api/v1/tenants (tenants:read, paginated), GET /:id (tenants:read), POST (tenants:write), PUT /:id (tenants:write), DELETE /:id (tenants:delete → soft suspend semantics via manager; TENANT_PROTECTED on default → 409); all `{success,data}` envelopes; requirePermission preHandler wired like users.ts
- Error codes: 403 TENANT_PROTECTED mapped 409? — NO: TENANT_PROTECTED → HTTP 409, code `TENANT_PROTECTED`; suspended login gate is Task 3's AUTH_TENANT_001

- [ ] **Step 1: RED route tests** (mirror users.test.ts mocks) — CRUD happy paths + permission gating (403 without codes — reuse route-guard test static assertions pattern) + default-tenant delete → 409
- [ ] **Step 2: Implement** → GREEN; verify conventions checks: `grep -c "resource: '"` = 21; authorize diff-check passes
- [ ] **Step 3: tsc + full server vitest + commit** — `feat(server): tenants CRUD routes with permission codes (G)`

## Task 3: suspension gate + refresh door (R1)

**Files:**
- Modify: the 4 issueTokenPair helpers (auth.ts / oauth.ts / saml.ts / webauthn.ts) — after user-resolution, before sign: tenant status check via TenantManager.findById (status !== 'active' → throw/return 403 AUTH_TENANT_001 'Access denied'); keep the check INSIDE the helpers so all 8 call sites + mfa/password re-issuance inherit it (R1)
- Modify: `apps/server/src/routes/auth.ts` refresh endpoint — fail-closed tenant check before rotation (mirror batch A user-suspended refresh door)
- Test: `apps/server/src/__tests__/tenant-gate.test.ts` (new) — strategy per R8: tests insert a second suspended tenant row directly + a user row bound to it, then exercise login/refresh paths

**Interfaces:**
- Produces: login/ldap/webauthn/oauth-exchange/saml-exchange/magic-consume/mfa-verify/change-password/refresh ALL reject for suspended-tenant users with 403 `{code:'AUTH_TENANT_001'}`; default tenant can never suspend → default-user flows unaffected

- [ ] **Step 1: RED** — suspended-tenant user login → 403 AUTH_TENANT_001; refresh → 403; default-tenant user unaffected
- [ ] **Step 2: Implement helper-level gate + refresh door** → GREEN; full server vitest green
- [ ] **Step 3: tsc + commit** — `feat(server): tenant suspension gate on issuance helpers + refresh (G)`

## Task 4: request-context injection + DEFAULT_TENANT retirement (R3/R7)

**Files:**
- Modify: `apps/server/src/fastify.d.ts` (FastifyRequest.tenantId?: string), `apps/server/src/app.ts` (authenticate extension: after user resolution — JWT branch `request.tenantId = request.user.tenantId ?? DEFAULT_TENANT`; apikey branch `request.tenantId = key.tenantId` — NO overwrite/DEFAULT fallback on apikey)
- Modify: `apps/server/src/routes/roles.ts` ×5, `users.ts` ×14, `saml.ts` ×2, `oauth.ts` ×1, `api-keys.ts` ×3, `utils/permission.ts` ×1, `auth.ts` rolesOf/permissionsOf ×2 — replace DEFAULT_TENANT with `request.tenantId ?? DEFAULT_TENANT` (public-route issuance paths keep explicit resolution: saml/magic resolve DEFAULT_TENANT per spec G2)
- KEEP: constants.ts, permissions-seed.ts, setup.ts (bootstrap self-writes)

**Interfaces:**
- Consumes: Task 0 claim + Task 1 TenantManager
- Produces: authenticated-route tenant resolution from request context; convergence check (R3 grep) returns ZERO hits outside the keep-list

- [ ] **Step 1: RED** — authenticated request with a token whose claim tenantId = X reaches a Manager call with X (spy-level or route-level assertion; simplest: roles list route test asserting RoleManager received request.tenantId not constant — extend roles.test.ts)
- [ ] **Step 2: Implement** authenticate extension + fastify.d.ts + mechanical replacement across listed files
- [ ] **Step 3: Convergence check** — R3 grep zero-hit outside keep-list; full server vitest green; tsc 双闸
- [ ] **Step 4: commit** — `feat(server): request-context tenantId injection + DEFAULT_TENANT retirement (G)`

## Task 5: frontend read-only column + e2e mocks + full regression (R4)

**Files:**
- Modify: `apps/admin-ui/src/api/tenants.ts` (new — fetchTenants, ApiEnvelope-typed), `apps/admin-ui/src/pages/Users.tsx`, `apps/admin-ui/src/pages/Roles.tsx` (Tenant column: slug via module-scope cached lookup; failure → '—' cached, no retry, no toast, no console error)
- Modify: e2e specs touching Users/Roles pages (users-crud, roles-crud, users-import-export, auth-rbac-ui…) — add `/api/v1/tenants` mock returning the default-tenant array (B2/F per-spec precedent)
- Test: e2e — existing specs stay green (the new column degrades silently in specs without the mock? NO — unmocked → 500 → console net. EVERY spec that renders Users/Roles MUST get the mock; grep `goto('/users'|'/roles'` to enumerate)

**Interfaces:**
- Produces: Users/Roles tables show Tenant slug column (id → slug lookup); users without tenants:read see '—' (lookup 403s, caught)

- [ ] **Step 1: enumerate affected specs** (`grep -l "goto('/users'\|goto('/roles'" e2e/*.spec.ts`) + RED: run one without mock to confirm console-net failure mode is real (document)
- [ ] **Step 2: implement api + column + per-spec mocks** → targeted e2e green
- [ ] **Step 3: FULL gates** — `pixi run npx vitest run apps/server packages/identity packages/audit` green; `pixi run npx tsc --noEmit` root clean (PIT-051); e2e FULL `--workers=1` low-load window → 0 failed, report exact counts (PIT-054)
- [ ] **Step 4: commit** — `feat(admin-ui): read-only tenant column with graceful degradation (G)`

## 验收清单

- [ ] tenants 表 + 迁移三件套 + seed/bootstrap 双首写者幂等
- [ ] 权限码 21 双注册 + conventions 更新
- [ ] tenantId claim 六签发点 + helper 内挂起门 + refresh 门（AUTH_TENANT_001）
- [ ] request.tenantId 双分支（JWT claim / apikey key-row）+ fastify.d.ts
- [ ] DEFAULT_TENANT 收敛 grep 零命中（keep-list 外）
- [ ] TENANT_PROTECTED 409 / 挂起失效 perm 缓存 / 默认租户不可挂起删
- [ ] 前端列降级 '—' + 全部受影响 spec mock
- [ ] vitest 全绿 / tsc 双闸+根闸 / e2e 全量 0 新失败（workers=1 权威数）
