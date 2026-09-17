# Batch H — SCIM 2.0 User Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Land SCIM 2.0 user provisioning: /api/v1/scim/v2 mount (RFC 7643/7644), api_keys scopes-based token isolation, UserManager provisioning mapping with suspension parity.

**Architecture:** Protocol mount (scim.ts plugin, scoped scim+json parser, own bearer preHandler — same pattern as SAML/oidc). User resource ↔ users table mapping via UserManager. Two new deps: scim2-parse-filter (filter AST) + scim-patch (RFC 7644 PATCH ops).

**Tech Stack:** Fastify 4 plugin-scoped addContentTypeParser (SAML precedent), scim2-parse-filter@0.3.0 + scim-patch@0.9.3, drizzle-kit generate 0003, vitest.

**Spec:** docs/superpowers/specs/2026-09-16-batch-h-scim-design.md + -REVIEW-ADDENDUM.md (R1–R10 binding; addendum overrides spec).

## Global Constraints

- R1 (security): authenticate apikey branch reads key.scopes from row (scim=['scim'], data=['*']); requirePermission apikey branch: scopes含'*'放行，仅['scim']→403. 存量key ['*']零回填
- R2 (schema): 复用 api_keys.scopes jsonb（['scim']|['*']），**不加 scope varchar 列**；migration 0003 = users.external_id only（nullable, 无唯一约束, correlation-only R6）
- R3: SCIM provisioning 租户 = request.tenantId（scim bearer 注入），**禁 DEFAULT_TENANT 字面量**
- R4: 测试 = vitest app.inject 集成（无 e2e）；PIT-056 probe 断言（门调用记录）
- R5: scoped scim+json parser **无条件注册**（SAML saml.ts:27 模式）
- R7: PATCH 多属性 = 顺序多 Manager 调用；未知属性 = 400 invalidPath
- R8: userName 查找 `lower(trim())` 归一化；R9: name 缺省取 userName
- PIT standing: 048/051/053/054/055(two-key mocks)/056(probe assertions); e2e precheck discipline; English comments; TDD red-first

---

## Task 0: identity deps + migration + scopes wiring

**Files:**
- Modify: `packages/identity/package.json` (add scim2-parse-filter + scim-patch to dependencies)
- Modify: `packages/identity/src/db/schema.ts` (users.external_id uuid nullable)
- Generate: migration 0003 (drizzle-kit generate — external_id only, verify no dirty diff)
- Modify: `apps/server/src/app.ts` (authenticate apikey branch: payload.scopes = key.scopes from row, replacing hardcoded ['*'])
- Modify: `apps/server/src/utils/permission.ts` (apikey branch: scopes含'*'放行，仅['scim']→403)
- Test: `apps/server/src/__tests__/scim-token-isolation.test.ts` (new)

**Interfaces:**
- Consumes: existing authenticate apikey branch (app.ts:135), requirePermission (permission.ts:33-50)
- Produces: scim-scope keys → data routes 403; data keys unchanged; app.ts authenticate reads row

- [ ] **Step 1: RED — token isolation test** (new file): data key (['*']) → GET /users 200 (regression); scim key (['scim']) → GET /users 403 (currently PASSes-then-fails after wiring — run pre-wiring to confirm 200); scim key → /scim/v2/Users 200 (auth passes); data key → /scim/v2/Users 403 (H2 middleware, tested in T1 scope — placeholder route 403 for now acceptable)
- [ ] **Step 2: migration + schema** — external_id column; generate; verify triple artifacts + zero dirty diff
- [ ] **Step 3: wire authenticate + requirePermission** → GREEN
- [ ] **Step 4: install deps + commit** — `feat(identity,server): SCIM token scope isolation + external_id column (H)`

## Task 1: SCIM protocol mount skeleton (parser + auth + discovery endpoints)

**Files:**
- Create: `apps/server/src/routes/scim.ts` + `apps/server/src/__tests__/scim.test.ts`
- Modify: `apps/server/src/app.ts` (register scimRoutes)

**Interfaces:**
- Consumes: T0 scopes wiring (bearer via app.authenticate? NO — scim does its OWN bearer preHandler reading api_keys.findByHash directly, per spec H2; NOT app.authenticate)
- Produces: plugin with scoped scim+json parser (unconditional R5); own bearer preHandler (findByHash → scopes must contain 'scim' → request.tenantId = key.tenantId; 401/403 envelopes); GET /ServiceProviderConfig + /Schemas + /ResourceTypes (static docs); all responses Content-Type application/scim+json

- [ ] **Step 1: RED** — tests: no token → 401; data-scope token → 403; scim token → 200; discovery endpoints return SCIM shapes with scim+json content-type; scim+json body parsed (POST echo test or config endpoint accepting body)
- [ ] **Step 2: Implement plugin skeleton** → GREEN
- [ ] **Step 3: gates + commit** — `feat(server): SCIM protocol mount skeleton with scoped parser + bearer auth (H)`

## Task 2: User provisioning (GET/POST/PUT/DELETE /Users + filter + pagination)

**Files:**
- Modify: `apps/server/src/routes/scim.ts` + test file

**Interfaces:**
- Consumes: T1 plugin skeleton + UserManager (findByEmail→lower(trim) normalized per R8, create, findById, findByIdAny, update, changeStatus+revokeAllUserSessions per H3 parity)
- Produces: GET /Users (ListResponse, startIndex 1-based↔page 0-based, filter userName eq / id eq via scim2-parse-filter→SQL push-down); GET /Users/:id; POST /Users (find-or-create, 409 uniqueness on existing, name↔userName fallback R9, password→policy+hash, provision into request.tenantId per R3); PUT /Users/:id (full replace minus immutable); DELETE /Users/:id (soft suspend + revoke, 204); all errors SCIM Error schema (uniqueness/notFound/invalidValue/invalidFilter)

- [ ] **Step 1: RED** — tests: provision happy (POST → 201 + User resource shape + meta), duplicate → 409 scimType uniqueness, name fallback R9, password policy reject → 400, filter userName eq → push-down SQL (spy assert email used), filter id eq, unsupported attribute → 400 invalidFilter, pagination startIndex=1/count=10 → page=0/pageSize=10 mapping (PIT-056: assert manager received converted values), GET by id/not-found 404, PUT full replace, DELETE → 204 + changeStatus called + revokeAllUserSessions called (PIT-056), content-type on responses
- [ ] **Step 2: Implement** → GREEN
- [ ] **Step 3: full gates + commit** — vitest 全绿 / 双 tsc / commit `feat(server): SCIM user provisioning — CRUD + filter + pagination (H)`

## Task 3: PATCH + full regression (final task)

**Files:**
- Modify: `apps/server/src/routes/scim.ts` + test file

**Interfaces:**
- Consumes: scim-patch lib (apply Operations to current SCIM representation) + T2 CRUD
- Produces: PATCH /Users/:id — fetch → map to SCIM representation → scim-patch apply → diff-map to Manager calls (active→changeStatus+revoke parity; name→update; per-attribute sequential R7; unknown→400 invalidPath R7); multi-attr → ordered calls

- [ ] **Step 1: RED** — PATCH matrix tests: replace active=false → changeStatus('suspended')+revokeAllUserSessions called (PIT-056); replace active=true → changeStatus('active') no revoke; replace name → update called with name; multi-attr (active+name) → BOTH called in order; unknown attr → 400 invalidPath; op on missing resource → 404
- [ ] **Step 2: Implement** → GREEN; full vitest (apps/server 全量 + identity)
- [ ] **Step 3: 双 tsc + root tsc (PIT-051) + commit** — `feat(server): SCIM PATCH operations with parity-mapped manager calls (H)`

## 验收清单

- [ ] scim token 与 data token 隔离双向成立（T0 RED 实证）
- [ ] SCIM 协议面：discovery ×3 + Users CRUD + filter push-down + pagination 1-based 转换 + SCIM Error schema
- [ ] PATCH 矩阵全绿（active/name/multi/unknown/missing）；停用 parity（changeStatus+revokeAllUserSessions）
- [ ] content-type scim+json 双向；scoped parser 无条件；app.ts 不变量
- [ ] migration 0003 单列干净；R3 key.tenantId（零 DEFAULT_TENANT 字面量在 scim.ts）
- [ ] vitest 全绿 / 双 tsc+根闸净
