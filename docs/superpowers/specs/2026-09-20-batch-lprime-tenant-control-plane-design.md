# Batch L′ — Multi-Tenant Control Plane (Design) — rev.2

**Date**: 2026-09-20 (rev.2 absorbs dual-Momus addendum `2026-09-20-batch-lprime-tenant-control-plane-REVIEW-ADDENDUM.md`)
**Status**: REVISED after FLOWS-REJECT + BLOCKERS-APPROVE-WITH-FIXES; awaiting scoped re-review
**Depends on**: Batch G (tenants data plane), Batch K (RBAC moat), Batch C (page precedents)

## 1. Problem

Batch G shipped the multi-tenant *data plane* but left the *control plane* missing.
A freshly created tenant is a dead island: `POST /v1/tenants` inserts a row and nothing
else — no roles, no users, nobody can ever be provisioned. There is no Tenants UI
(api/tenants.ts is list-only; no route/menu despite tenants:* dual-registration).
`/auth/me` hides the session's tenant. Three RBAC config-surface tails remain
(PUT parentId unwired, no parent selector, no permission count column).

## 2. Goals

- G1: Platform admin creates a tenant AND its first administrator end-to-end from the UI.
- G2: The tenant administrator holds EXACTLY the 9 tenant-bindable codes and CANNOT
  self-elevate to any of the 12 platform-only codes — including through the
  roles:write → permissionIds binding path (D1a).
- G3: Session tenant visible in UI (/auth/me + top bar).
- G4: RBAC tails close, on top of a REAL cycle-check primitive (X3).
- G5: Pre-existing dead-island tenants repaired by the same bootstrap action.

## 3. Non-goals

- Cross-tenant user management by platform admins (users POST keeps request.tenantId).
- Permission-definition CRUD (seed-only).
- Audit write-side tenant attribution (Batch K backlog).
- Per-tenant OIDC clients; tenant-scoped options.
- Closing the pre-existing 15-min access-token residual after tenant suspend
  (login/refresh gates already cover; batch G design).
- Manager-level role.tenantId validation in setUserRoles/assignToUser (route-level
  unknownRoleId already blocks the reachable path; defense-in-depth → backlog).

## 4. Design

### D1: Permission partition (X2 — final counts)

`BUILTIN_PERMISSIONS` (21) partitions EXHAUSTIVELY into (exported from the identity
package, see D1a for why):

```
TENANT_BINDABLE_PERMISSIONS (9): users:read/write/delete, roles:read/write/delete,
                                 permissions:read, audit:read, stats:read
PLATFORM_ONLY_PERMISSIONS  (12): tenants:read/write/delete, options:read/write,
                                 clients:read/write, permissions:write/delete,
                                 apikeys:read/write/delete
```

Rationale for apikeys platform-only: API keys are created with `request.tenantId`
(= DEFAULT for every reachable creator), SCIM keys likewise platform-issued; a tenant
holding a `'*'`-scope key would pass every requirePermission gate (apikey branch
short-circuits on `scopes.includes('*')` — verified at HEAD) = skeleton key past the
partition. Invariant unit test: disjoint + union == BUILTIN names (21) — this test is
what X2 caught as unpassable-as-written; it must pass as-written now.

### D1a: Binding validation funnel (X1 — the escalation killer)

Permission rows are global; bindings (rolePermissions) are the enforcement point.
`RoleManager.setRolePermissions` — the sole choke through which both `create()` and
`update()` route permissionIds — gains:

```
if (tenantId !== DEFAULT_TENANT_ID) {
  resolve names of permissionIds; any name ∉ TENANT_BINDABLE_PERMISSIONS
  → throw `PERMISSION_NOT_BINDABLE: <name>`
}
```

- Lists + `DEFAULT_TENANT_ID` live in `packages/identity/src/services/permission-partition.ts`
  (identity cannot import apps/server; permissions-seed.ts re-exports/imports instead
  of redefining — single source).
- Routes/roles.ts POST+PUT map the tag to 409 via conflict-mapper (third tag alongside
  ROLE_PROTECTED / LAST_ADMIN_GUARD; tag literal duplicated by design per K convention).
- Bootstrap's seed path is server-controlled direct SQL and BYPASSES this funnel
  (it can only bind TENANT_BINDABLE by construction; D2 step 5 pins the list).
- RED: tenant-context `POST /v1/roles {permissionIds:[<tenants:write uuid>]}` → 409
  PERMISSION_NOT_BINDABLE; `PUT` replacing bindings with a platform code → 409;
  default-tenant context unaffected.
- Platform admin editing a TENANT's role is unreachable (update is tenant-scoped by
  request.tenantId → 404) — stated so nobody adds a bypass.

### D2: `POST /v1/tenants/:id/bootstrap`

Gate: route-level `tenants:write` via longest-prefix trim (verified: segments trim to
`POST:/api/v1/tenants`). Handler checks IN THIS ORDER (B7a — belt first, never leak
tenant existence/state to non-platform callers):

1. **Platform belt**: `request.tenantId !== DEFAULT_TENANT` → 403
   `TENANT_PLATFORM_ONLY`. (Also belt on POST/PUT/DELETE `/v1/tenants` mutations —
   B3: closes the `'*'`-scope-key class in ~3 lines.)
2. Target tenant exists → 404 `NOT_FOUND`; `status === 'active'` → else 409
   `TENANT_PROTECTED`.
3. Target `=== DEFAULT_TENANT` → 409 `TENANT_PROTECTED` (wizard owns platform admins).
4. Email check (`UserManager.findByEmail` — global, email is globally unique in schema):
   - taken AND that user ∈ target tenant AND holds target tenant's admin role →
     **200 idempotent replay** `{ userId, roleId, tenantId, alreadyBootstrapped: true }`
     (R4 convergence arm — post-step-6 crashes recover by same-email retry).
   - taken otherwise → 409 `EMAIL_EXISTS`.
5. Password policy AT ROUTE LAYER (R2 — corrected fact: UserManager.create only hashes;
   users POST only enforces schema minLength:8): before create, call
   `readPasswordPolicy` + `assertPasswordPolicy` with a dedicated call-site key
   (`'user_create'`, added to the options-driven policy call sites — C2 precedent,
   zero-break defaults). Failure → 400 in the register-family envelope (AUTH_REG_002
   pattern; exact code string copied from that call site).
6. Role find-or-create: `roleManager.create({ name:'admin', description, isSystem:true },
   tenantId)` — create() is ALREADY find-or-create on (name,tenantId) (RoleManager:42-54;
   X7/B6 — the findAll/ILIKE substring approach is RETRACTED). Then UNCONDITIONALLY
   stamp: `UPDATE roles SET is_system=true WHERE id=?` direct SQL (idempotent; closes
   the early-return-non-system window where the last-admin guard (keys on isSystem)
   would let a sole tenant admin self-suspend into an unrecoverable orphan tenant).
7. Strict bind: new exported `bindPermissions(db, roleId, TENANT_BINDABLE_PERMISSIONS)`
   — inserts global rows (conflict-do-nothing), binds, then ASSERTS bound count == 9,
   throws on any failure (X4 — the best-effort `seedBuiltinPermissions` swallow is NOT
   usable here; wizard keeps the wrapper, bootstrap calls the strict core).
8. `userManager.create({email, name, password}, tenantId)` → 201
   `{ userId, roleId, tenantId, alreadyBootstrapped: false }`.
9. `roleManager.assignToUser(userId, roleId, tenantId)`.

Partial-failure matrix (post-fix): any failure before step 8 leaves role(+bindings)
— retried by find-or-create + strict re-bind (both idempotent). Failure between 8 and 9
→ same-email retry converges via step 4 replay arm ONLY IF assignment succeeded;
if assignment failed, user exists WITHOUT role → step 4 falls to 409 EMAIL_EXISTS.
Absorbed: step 4's replay arm therefore matches on "user ∈ tenant" (NOT "holds admin
role") and RE-RUNS assignToUser (idempotent insert) before 200. One sentence in the
implementation brief pins this; test locks it.

Audit: route is NOT in the audit exclusion list (verified); `password` recursive
redaction holds (audit/types.ts sanitize fields). Actor = sub-first (batch D).

Error-code table (PINNED for T4 mock-first — PIT-033): 403 `TENANT_PLATFORM_ONLY` ·
404 `NOT_FOUND` · 409 `TENANT_PROTECTED` · 409 `EMAIL_EXISTS` · 409
`PERMISSION_NOT_BINDABLE` (roles routes) · 400 policy-family envelope. Frontend passes
server messages through (K-R6 apiErrorMessage), but mock envelopes MUST copy these
codes verbatim from this table.

### D3: isSystem stamping interaction (unchanged, verified)

selfHealSeed binds the 21-code seed ONLY to the DEFAULT-tenant admin role
(`permissions-seed.ts` and(name='admin', tenantId=DEFAULT) — verified at HEAD); its
isSystem stamp is deliberately global. Tenant admin roles = moat + 9-code ceiling.
Pin test: bootstrap-bound role holds exactly 9 codes even after a selfHealSeed run.

### D4: `/auth/me` tenant exposure

Add `tenantId` (user row; findById already tenant-scoped) and `tenantName` via the
EXISTING lazy `getTenantManager()` singleton in auth.ts (B7b — never per-request
`new TenantManager()`: pool accumulation precedent documented in permission.ts).
`TenantManager.findById` is an UNCACHED PK SELECT: cost = +1 SELECT per /me —
acceptable, no cache added (ponytail: add tenant cache if /me ever shows up in a
slow query). Lookup failure short-circuits `tenantName: undefined` (batch G readonly
pattern; /me must never 500 on tenant row absence). No response schema on /me →
no fast-json-stringify strip risk (verified; batch E trap not applicable).
Frontend: MeResponse gains both; top-bar Tag renders when `tenantId !== DEFAULT_TENANT`
(new frontend constant, NOT a name-string compare); locales one key.

### D5: Tenants page + api layer

Five-piece precedent (Clients/ApiKeys) + K-T3 LockOutlined for the default-tenant row.
Columns: name / slug / status Tag / createdAt / actions (NO users-hint column — no
backing endpoint, R9a). Actions: Init admin modal (email/name/password + policy hints,
200-replay and 409 EMAIL_EXISTS surfaced inline per UserCreate precedent), Edit
name/slug, Suspend/Activate, soft Delete (confirm states suspend semantics). Row-action
gates via `useAuthStore((s) => s.hasPermission)` (R9c — the real hook; no usePermission
exists). Default-row detection: id literal constant mirroring backend keep-list.
api/tenants.ts: createTenant/updateTenant/deleteTenant/bootstrapTenant.
Route/menu: `tenants` under `PrivateRoute permission="tenants:read"`, TeamOutlined.

### D6: RBAC tails — on a FIXED primitive (X3)

- **identity RoleManager cycle check is broken and gets fixed IN THIS BATCH**:
  `checkInheritanceCycle` never receives roleId → neither self-parent (A→A) nor
  mutual (A→B→A after A→B exists) cycles are detected; it only detects pre-existing
  cycles in the ancestor chain. Rewrite: walk ancestors from proposed parent; if
  `current === roleId` → cycle; direct `parentId === roleId` → reject; keep the
  same-tenant parent check. Tests: self RED, mutual RED, deep-chain green.
- setParent gains the isSystem guard → `ROLE_PROTECTED` (manager-funnel discipline;
  today only update() has it — spec v1's claim was wrong at the manager level).
- roles PUT wiring: body `parentId?: string | null`; when present call setParent
  FIRST (all validation before any write — v1's update-then-setParent ordered a
  partial-write on cycle rejection), then update() for field changes.
- Roles.tsx: parent Select (current tenant roles minus self, reuses list state —
  zero new endpoint); isSystem rows already UI-locked (K-T3) and now manager-locked.
- Count column: `record.permissions?.length ?? 0` (findAll batch-resolves
  `permissions[]` — verified). Zero backend change.
- T5 owns `packages/identity` + dist-rebuild note (`pnpm --filter @accessbase/identity
  build` before server typecheck — dist-sync convention).

## 5. Success criteria

1. Bootstrap happy path: 201; tenant has admin role (isSystem=true immediately,
   asserted), exactly **9** rolePermissions rows, one user holding it; that user
   logs in; `/auth/me` shows tenantId + tenantName + the 9 codes and none of the 12.
2. Guards: belt-first ordering (non-platform caller cannot distinguish 404/409 —
   always 403); default target → 409; suspended → 409; email taken-elsewhere → 409;
   weak password → 400 policy envelope; strict-bind failure → NOT a 201 (test seam:
   bind throws → route surfaces 5xx and creates NO user? — user creation happens
   AFTER bind, so nothing to roll back; assert order); same-email post-assign retry →
   200 `alreadyBootstrapped`.
3. **Escalation RED (X1)**: as tenant admin — GET /permissions → POST /roles binding
   any platform code → 409; PUT /roles replacing bindings with platform code → 409;
   assigned-role path unaffected. As tenant `'*'`-scope API key (constructed via
   direct row insert in test): tenants POST/PUT/DELETE + bootstrap → 403 despite
   gate pass.
4. force-logout tenant scoping: tenant admin revoking a DEFAULT-tenant user id → 404
   (B5); same-tenant id → works.
5. Tenants page E2E (mock): list/create/init-admin modal 201+replay-200/suspend/
   default-row locked/409 inline; platform admin sees menu, tenant admin doesn't;
   /403 reachable.
6. Roles: count column renders; parent Select persists parentId; self-parent → 409;
   mutual A→B then B→A → 409; isSystem row parent edit → 409 (manager guard) AND
   UI-locked.
7. `/me` additive; e2e GlobalGuard mock families updated in-T3; tenant singleton used.
8. Gates: vitest (+~30: partition invariant, funnel RED×2, bootstrap matrix,
   cycle self/mutual, me fields, roles wiring), root+admin tsc, identity rebuild,
   eslint changed-surface 0 error, e2e workers=1 +8~10 green atop 126, coverage PASS,
   `no_proxy` export per PIT-031 in all test invocations.

## 6. Absorption status of review findings

X1 D1a · X2 D1 · X3 D6 · X4 D2/7 · R2 D2/5 · R4 D2/4 · R6 D6 · R7 D2/6 · R8 D1/R-E note ·
B3 D2 belt extension · B5 criterion 4 · B6 D2/6 · B7a D2 order · B7b D4 · R9a-d D5/T6/plan ·
R10 plan citations · error-code pin D2 table. Deferred (documented, non-blocking):
§3 manager-level setUserRoles validation; 15-min token residual; SCIM per-tenant keys.
