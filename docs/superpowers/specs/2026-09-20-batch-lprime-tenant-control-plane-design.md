# Batch L′ — Multi-Tenant Control Plane (Design)

**Date**: 2026-09-20
**Status**: DRAFT for dual-Momus review
**Depends on**: Batch G (tenants schema/claim/injection/isolation), Batch K (RBAC moat), Batch C (Clients/ApiKeys page precedents)

## 1. Problem

Batch G shipped the multi-tenant *data plane* (tenant columns, JWT tenantId claims,
request.tenantId injection, manager-level scoping, read-side isolation) but left the
*control plane* missing. A freshly created tenant is a dead island:

- `POST /v1/tenants` inserts a row and nothing else — there are no roles and no users
  inside the tenant, so nobody can ever be provisioned there.
- There is no Tenants management UI (api/tenants.ts has only a list helper; no route,
  no menu entry, despite `tenants:read/write/delete` being seeded + dual-registered).
- `/auth/me` does not expose the caller's tenantId/tenantName, so the UI cannot show
  which tenant a session belongs to.
- The RBAC config surface has three small tails: roles PUT ignores `parentId`
  (RoleManager.setParent exists, unwired), the Roles form has no parent-role selector,
  and the roles list shows no permission count (Role.findAll already returns the full
  `permissions[]` — frontend-only change).

## 2. Goals

- G1: A platform admin can create a tenant AND its first administrator end-to-end
  from the UI (bootstrap flow), with no manual SQL.
- G2: The tenant administrator can log in and see ONLY tenant-scoped capabilities —
  critically, NOT `tenants:*`, NOT `options:*`, NOT `clients:*`, NOT
  `permissions:write/delete` (the permissions table is global; letting a tenant
  define new permissions pollutes every tenant).
- G3: The session's tenant is visible in the admin UI (`/auth/me` + top bar).
- G4: The three RBAC tails close (PUT parentId via existing setParent, parent selector,
  count column) — same page surface as G1, batched for review-net economy.
- G5: Pre-existing dead-island tenants (created before this batch) are repaired by the
  same bootstrap action (row action, no data migration).

## 3. Non-goals (explicit)

- Cross-tenant user creation/listing by platform admins (`POST /v1/users` keeps
  stripping tenantId from the body; `request.tenantId` remains the single source).
  Bootstrap + the tenant admin's own user page cover provisioning; anything beyond is
  YAGNI until a real operator complains.
- Permission-definition CRUD (seed-only stays; value questionable).
- Audit write-side tenant attribution (Batch K backlog item, separate batch).
- Per-tenant OIDC clients (oidcClients is a global table by design today).
- Tenant-scoped options (options table is global; `options:*` becomes platform-only).

## 4. Design

### D1: Platform-only vs tenant-bindable permission sets

`BUILTIN_PERMISSIONS` (21 codes) is partitioned into two exported lists:

```
PLATFORM_ONLY_PERMISSIONS (10): tenants:read/write/delete, options:read/write,
                                clients:read/write, permissions:write/delete
TENANT_BINDABLE_PERMISSIONS (11): users:read/write/delete, roles:read/write/delete,
                                  permissions:read, audit:read, stats:read
```

`seedBuiltinPermissions(db, roleId)` behavior is UNCHANGED (binds all 21 to the
default-tenant admin role — platform admin keeps everything). A new optional third
parameter `bindNames?: string[]` restricts which permission rows are bound to the
role; the global insert-21-on-conflict-do-nothing step always runs. Rationale:
one function, one truth list, no copy-paste drift between the 21-code table and a
second seed path.

Enforcement model: permission rows are global; role→permission binding
(rolePermissions) is tenant-scoped. requirePermission checks effective permissions,
so a tenant admin WITHOUT the tenants:* binding cannot pass the `tenants:write`
route gate even though the route only keys off the code. No authorize.ts change.

### D2: `POST /v1/tenants/:id/bootstrap` (the cold-start endpoint)

- Gate: `tenants:write` via routePermissions longest-prefix (already covers sub-paths;
  no mapping change). Caller identity check inside the handler:
  **`request.tenantId === DEFAULT_TENANT` required** — a non-default-tenant caller
  403 (they cannot pass tenants:write per D1 anyway; belt + braces, because API keys
  or future grants could change the code surface without changing this rule).
- Body: `{ email, name?, password }` (additionalProperties false; password policy
  validated by the SAME options-driven policy used by user creation — batch C call
  site; weak password → 400 WEAK-PASSWORD-family error envelope as users POST emits).
- Steps (transactional expectations below):
  1. Tenant exists (404 NOT_FOUND via existing sendTenantError shape) and
     `status === 'active'` (suspended → 409 TENANT_PROTECTED-tagged shape).
  2. `tenantId === DEFAULT_TENANT` → 409 (default tenant is bootstrapped by the
     wizard; prevents a second platform admin via this path).
  3. Email globally free (`userManager.findByEmail` → 409 EMAIL_EXISTS style, mirrors
     wizard ADMIN_EXISTS).
  4. Find-or-create role `admin` (isSystem:true) in tenant — same catch-'Role already
     exists in this tenant' fallback shape as setup.ts, BUT via
     `roleManager.findAll({search:'admin'}, tenantId)` exact-name match (no fixed
     UUID trick — tenant role ids are random).
  5. `seedBuiltinPermissions(db, roleId, TENANT_BINDABLE_PERMISSIONS)` — idempotent.
  6. `userManager.create({email, name, password}, tenantId)` — password policy +
     history run inside UserManager.
  7. `roleManager.assignToUser(userId, roleId, tenantId)`.
  8. 201 `{ success, data: { userId, roleId, tenantId } }`; audit via the standard
     middleware (POST route, body contains password → verify audit redact covers it —
     login password redaction precedent, PIT: add `password` redact path if absent).
- **Idempotency / retry semantics**: the endpoint is safe to re-invoke after a
  mid-way failure: step 4 find-or-create, step 5 conflict-do-nothing bindings,
  step 6 email-exists → 409 (operator fixes password and retries with different
  email; no automatic rollback). No explicit transaction wrapper (manager-level
  operations, matches setup wizard precedent). A `ponytail:` note names the
  upgrade path (single-tx service method) if partial-state incidents appear.
- Self-lockout analysis: bootstrap cannot suspend/lock itself; the tenant admin's
  11 codes contain no path back to tenants/options/clients. The LAST_ADMIN guard
  (batch K) operates per-tenant via the shared predicate — a bootstrapped tenant
  admin becomes that tenant's last-admin and gains the same 409 protection.

### D3: isSystem stamping interaction (documented behavior, no code)

Batch K `selfHealSeed` stamps `roles SET is_system WHERE name='admin'` with NO
tenant filter. After bootstrap, the tenant's admin role is therefore also stamped
→ immutable + protected by the RBAC moat. This is intended: the tenant admin role
must not be editable into a permission-less shell by its own admin. The 11-bound
set is the ceiling. Spec records it so implementers don't "fix" it.

### D4: `/auth/me` tenant exposure

Add `tenantId` (from the user row / request.tenantId) and `tenantName` (single
`tenantManager.findById` lookup, cached-path negligible) to the /me data payload.
Frontend `MeResponse` type gains both; `<AppLayout>` top-bar renders tenant name
as a small Tag next to the user dropdown only when `tenantName` differs from
'Default' (platform admins stay visually uncluttered; tenant admins always know
where they are). i18n: reuse existing common keys if present, else one new key.

### D5: Tenants page (`pages/Tenants.tsx`) + api layer

Clients.tsx/ApiKeys.tsx five-piece precedent (list + search + create modal +
row actions + delete-confirm). Columns: name / slug / status Tag / users hint /
created / actions. Row actions:

- **Init admin** (bootstrap modal: email/name/password + policy hints — reuse the
  UserCreate password-hint component pattern): shown for all non-default active
  tenants; after success → success toast + action becomes hidden-on-next-load? No
  state tracking: always show (re-invoke is a clean 409 EMAIL_EXISTS if already
  done; the modal makes retrying cheap and G5 dead-island repair explicit).
- **Edit name/slug** (PUT; default-tenant row renders edit/delete DISABLED —
  TENANT_PROTECTED 409 already backend-side, mirror batch K Lock precedent).
- **Suspend / Activate** (PUT status). Suspend of a tenant with users = allowed
  (login-side pending/suspended gates were wired in batch A/G).
- **Delete** (soft = suspend; keep both? ONE action row: Delete → confirm →
  DELETE endpoint (suspends). Suspend/Activate is the status control; Delete is
  kept as-is from API but UI shows only non-default rows. ponytail: same
  semantics today, drop Delete button if it confuses — keep, zero extra cost).

Default tenant row: visible, all destructive actions locked (isDefault detection =
id === '00000000-0000-0000-0000-000000000001' literal via new frontend constant,
mirrors backend keep-list; comment links conventions).

Routes/menu: `<Route path="tenants" element={<PrivateRoute permission="tenants:read">...` +
menu item with TeamOutlined (batch C menu pattern). api/tenants.ts gains
createTenant/updateTenant/deleteTenant/bootstrapTenant.

### D6: RBAC tails (G4)

- roles PUT schema adds `parentId: { type: 'string', format: 'uuid', nullable }`;
  handler: when `parentId !== undefined` call `roleManager.setParent(id, parentId,
  tenant)` AFTER the field update (setParent already validates same-tenant + cycle;
  ROLE_PROTECTED/LAST_ADMIN tags flow through sendConflictError unchanged).
  K-T2 immutability: setParent on an isSystem role throws ROLE_PROTECTED — parent
  selector therefore disabled for admin rows (matches batch K T3 UI lock precedent).
- Roles.tsx create/edit modal: parent Select (options = current tenant roles minus
  self; fetch reuse of existing roles list state — zero new endpoint).
- Roles.tsx list: permissions count column = `record.permissions?.length ?? 0`
  (findAll already batch-resolves `permissions[]` — batch B achievement). No
  backend change.

## 5. Success criteria

1. `POST /v1/tenants/:id/bootstrap` happy path: 201; tenant now has role admin
   (isSystem stamped at next selfHeal, or immediately via direct bind) + 1 user +
   11 rolePermissions rows; that user can log in and `/auth/me` shows tenantId +
   tenantName + exactly the 11 tenant codes (NOT tenants:*/options:*/clients:*/
   permissions:write/delete).
2. Bootstrap guards: default tenant → 409; suspended tenant → 409; duplicate email
   → 409; weak password → 400 policy envelope; non-default-tenant caller → 403
   (route-level 403 via missing code + handler-level belt).
3. Tenants page: platform admin (tenants:read) sees list; create → init-admin modal
   → login as new tenant admin → tenants/options/clients menu entries + routes
   absent (no codes); /403 reachable on direct URL.
4. Tenant admin can manage their own users/roles end-to-end (users list scoped to
   their tenant via claim — batch G path, assert no regression).
5. Roles list shows permission count; parent selector persists parentId; PUT with
   parentId cycle/self → 409; ROLE_PROTECTED admin row cannot get a parent.
6. `/me` shape change is additive (old consumers unaffected); frontend
   auth-store/e2e mocks updated accordingly.
7. Gates: vitest (new: bootstrap route suite + seed partition unit + me fields +
   roles PUT parentId), root+admin tsc, eslint changed-surface 0 error,
   e2e +6..8 mock-route tests green at workers=1, no regression on the 126.

## 6. Risk ledger (for reviewers)

- R-A: 21→(11+10) partition drift — both lists must always union to BUILTIN_PERMISSIONS;
  unit test asserts partition invariant (no overlap, union = 21).
- R-B (RESOLVED at spec time; pin with a test): ensureSeedForAdmin binds the 21-code seed ONLY to
  the default-tenant admin role (`and(name='admin', tenantId=DEFAULT_TENANT)` — verified at HEAD),
  while the isSystem stamp is deliberately global (moat for every tenant's admin). Tenant admin
  roles never receive platform codes. Pin: test that a bootstrap-bound tenant role holds exactly 11
  codes even after a selfHealSeed run.
- R-C (RESOLVED at spec time): audit logger redactFields recursively redacts `password`
  (packages/audit/types.ts redact field list) — bootstrap request bodies never persist secrets.
- R-D: e2e GlobalGuard/auth mocks need the extended /me fields; batch-G precedent
  "readonly column + failure-cache short-circuit" for tenant lookup in /me must not
  crash when tenants row absent (tenant deleted? soft-delete only; row exists).
- R-E: apikey-authenticated callers on tenant routes — requirePermission apikey
  branch + scopes (batch H): bootstrap via API key requires tenants:write scope AND
  now also request.tenantId from the key row — a tenant-scoped key must be default
  tenant to bootstrap. Assert both branches in tests.
- R-F: password policy function call site parity with users POST (batch C 5-dim,
  options-driven) — reuse exactly; no inline literal copy.
