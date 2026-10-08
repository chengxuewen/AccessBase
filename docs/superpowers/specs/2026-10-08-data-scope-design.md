# Data-Scope Batch — Design Spec (rev.3 — dual-Momus absorbed; rulings RATIFIED 2026-10-08, user-adjudicated one by one: A1-A6 all = recommended A)

Date: 2026-10-08 · Ladder: post-logout-coherence · Origin: R1 plan DG-6d (FGA middle path: self/dept/all
row-scope into the permission funnel, NO relation engine). Dept source RATIFIED: **groups with kind='department'**.

**rev.2 change log** — absorbed BLOCKERS B1[B2]-B6 × FLOWS R1-R9 (both APPROVE-WITH-FIXES).
Cross-hits (double evidence): R1×B1 DELETE code (users:delete), R2×B1 apikey seam, B2 erase escalation,
B3×R-projection read-back site, R3 /import creation arm, R4×B-both dead twin setRolePermissions,
R5 empty-list mechanism. Facts corrected §2 (:90 export not sessions; invite :406; cache cite 1-68).

## 0. Rulings — RATIFIED by user 2026-10-08 via adjudication-walkthrough (one-by-one, all A)

- **A1 = per-binding** `role_permissions.data_scope`. **A2 = users surface only** (v1). **A3 = create/invite/import require `all`**
  (import arm added by R3). **A4 = one UI Select fanning users:* codes** (B5 mixed-state disclosure added).
  **A5 = kind editable; SCIM always 'group'.**
- **A6 [NEW, B2] — erase arm.** DELETE /users/:id with `eraseAudit:true` (RTBF lock 727242, legalBasis mandate,
  cross-table audit scrub — users.ts:596-660) is a compliance act, not subordinate management.
  Recommend: **erase requires data_scope 'all' even when users:delete is dept-scoped**; plain delete honors the
  binding scope. Alt: erase follows users:delete scope (then §7 records the residue explicitly). Deny check runs
  BEFORE routeTx/lock acquisition.

## 1. Scope

IN: `groups.kind`, `role_permissions.data_scope`, effective-permission scope widening (widest wins),
caller-dept resolution, UserManager predicate + `isWithinScope`, users routes wiring (list/export/detail/
update/status/roles/force-logout/reset = code-routed scope; create/import/invite = A3 gate; delete = B1/B2),
apikey short-circuit, Roles PUT `permissionScopes` + groups kind passthrough, 403 `DATA_SCOPE`,
Groups kind UI + Roles scope Select + i18n, migration 0013 + dual SENTINELS + ops 14, docs wave.
OUT (ledger): LDAP department->group auto-sync (attributeMapping.department stays a dead column until the
full-sync ladder item — flows-confirmed), SCIM machine lane (apikey→all per R2), audit dept filtering (A2-alt),
FGA engine (non-goal), stats tenant-wide aggregates (B6 note: dashboard user-count card stays coarse).

## 2. Interface facts (rev.2 — corrected per dual review; all verified 2026-10-08)

| Fact | Evidence |
| --- | --- |
| `role_permissions` junction (roleId, permissionId) composite PK, NO scope column | `packages/identity/src/db/schema.ts:108-121` |
| `groups` NO kind column, unique(tenantId,name); `group_users`/`group_roles` composite + tenantId | `schema.ts:358-378` |
| **[R4]** TWO `setRolePermissions`: PermissionManager public (:221, `(roleId, permissionIds)` — **zero src callers, dead API with NO tenant/partition funnel**) vs RoleManager private (:625, `(roleId, permissionIds, tenantId, db?)` — the LIVE funnel reached via create/update). New `scopes` param lands ONLY on the private one; the dead twin gets a deprecation NOTE line (removal = backlog). Tests must target the RoleManager path. | `PermissionManager.ts:221`, `RoleManager.ts:625` |
| **[B1/R1]** `routePermissions` maps `DELETE:/api/v1/users` -> **`users:delete`** (seed code exists); longest-prefix trim sends `/users/:id/force-logout` -> POST:/api/v1/users -> users:write | `packages/identity/src/hooks/authorize.ts:33`; `apps/server/src/routes/permissions-seed.ts:18` |
| requirePermission (apps/server side, the live guard): JWT path -> code check via hasPermission; **apikey path -> BYPASSES the code check entirely** (scope-gated separately) — row guard must short-circuit apikey (R2) | `apps/server/src/utils/permission.ts:30+` |
| getUserEffectivePermissions: `seen.set(p.id,p)` last-wins; `resolveInheritedPermissions` internal dedup ALSO last-wins (child pushed before parents, parent overwrites — order-dependent) — **widest-wins must replace BOTH sites** (rank total-order all>dept>self) | `PermissionManager.ts:165-170`; `RoleManager.ts:396-416` |
| **[B3]** `getRolePermissions` (RoleManager.ts:601-615) maps a FIXED field set (id/resource/action/description/createdAt) over permissions×rolePermissions — junction columns never surface; optional `Permission.dataScope?` is tsc-invisible if unset -> silent enforcement no-op (batch-E webauthn projection family) | cited |
| Cache = in-process `Permission[]` 30s `perm:{t}:{u}`; publish hook carries KEYS only (values never serialize to redis) -> scope rides free; `RoleManager.update` invalidates tenant-wide (:259) + Q2c broadcast — scope edits propagate immediately | `permission-cache.ts:1-68`; `RoleManager.ts:252-260` |
| `UserManager.findAll(params, tenantId)` conditions = `[eq(users.tenantId, tenantId)] + pushes + and(...)`; **total uses the SAME where -> list meta is in-scope by construction** | `UserManager.ts:152-184` |
| Users route anchors [CORRECTED per flows]: :46 list, :90 **GET /export** (NOT 'sessions list'), :142 GET /me-adjacent list?, :172 detail (404-first posture: `findById(id, tenantId)` -> NOT_FOUND), :220 create, **:292 POST /import** (bulk-create lane, today ungated by A3), :370 reset-password, :406 invite, :454 force-logout (out-of-tenant=404 precedent), :486 update, :544 PATCH status, :596 DELETE (+erase arm) | `apps/server/src/routes/users.ts` |
| drizzle-orm 0.45.3 `inArray(column, values \| SQLWrapper)` — **subquery form typed** (conditions.d.ts:169-171); empty VALUE arrays = degenerate SQL -> conversion must precede (B4/R5) | node_modules types |
| roles PUT = fastify JSON-schema body posture (enum precedent exists users.ts:58/544) — `permissionScopes` enum at route + **manager-funnel clamp** (identity-direct callers bypass route schema) | `routes/roles.ts:133-156` |
| groups detail GET /roles/:id returns Permission[] objects with ids (UI fanning surface exists); L′-T5 findAll count path untouched by projection change | `routes/roles.ts:50`; `RoleManager.ts:176-194` |
| GroupManager.addMember tenant-validates group AND user BEFORE insert (:166-176) -> group_users.tenantId consistent by construction; dept subquery keying on caller-tenant ids is safe, BOTH-tables predicates remain defense-in-depth | `GroupManager.ts:166-176` |
| SCIM separate routes (own bearer preHandler :224, POST /Users :400) — users.ts wiring cannot regress it | `routes/scim.ts` |
| /auth/me projects permission NAMES (`${resource}:${action}`, shared.ts:212-216) — widest-wins changes value selection not list membership -> /me shape safe | flows CONFIRMED |
| chain: 13 files 0000..0012 on disk; SENTINELS 10 entries w/ dual 0012×2; `"groups"` quoted-probe shape proven at 0008 — 0013 kind probe MUST copy it; ops expectations 13->14 | `scripts/migrate.sh:108-119` |
| roles UI: Transfer ~:290-299, save payload built handleSubmit ~:81-91 `{...values, permissionIds}` — spec anchors updated | `apps/admin-ui/src/pages/Roles.tsx` |

## 3. Design (rev.2)

### 3.1 Migration 0013 (T0)
- `role_permissions.data_scope TEXT NOT NULL DEFAULT 'all'`; `groups.kind TEXT NOT NULL DEFAULT 'group'`.
- SENTINELS dual: `0013|SELECT data_scope FROM role_permissions LIMIT 1` + `0013|SELECT kind FROM \"groups\" LIMIT 1`.
- ops 13→14 + legacy assertion pair; values enum-validated at the funnel (DB CHECK-free, repo style).

### 3.2 Identity layer (T-IDENTITY)
- `Permission.dataScope?: 'all'|'dept'|'self'`; **[B3 PIN]** `getRolePermissions` SELECTs
  `rolePermissions.dataScope` and maps `?? 'all'` — without this the whole feature is a silent no-op.
  ROUND-TRIP unit RED (set {perm:'dept'} -> `getUserDataScope` returns 'dept' through real projection, not persistence).
- Widest-wins rank `{all:3,dept:2,self:1}` at BOTH dedup sites (RoleManager.resolveInheritedPermissions +
  PermissionManager.getUserEffectivePermissions) — order-independent lattice; ties no-op.
- `RoleManager.setRolePermissions(..., db?, scopes?: Record<permId, scope>)` private funnel — insert values carry
  `dataScope: clamp(scopes?.[permId])`; **[clamp]** manager throws on out-of-enum values (direct-identity callers
  bypass route JSON-schema). create/update forward `data.permissionScopes`. Dead PermissionManager twin: deprecation
  note line only.
- `PermissionManager.getUserDataScope(userId, permission, tenantId): 'all'|'dept'|'self'|null` — same widened cache.
- `GroupManager.getDepartmentIdsForUser(userId, tenantId)`: group_users×groups join, `kind='department'` AND
  tenant predicates on BOTH tables.
- `UserManager.findAll(params.scope?: ScopeFilter)` where `ScopeFilter = {kind:'all'} | {kind:'self', userId} |
  {kind:'dept', userId, groupIds[]}` — **[B4/R5 MECHANISM]** the UTIL (below) never constructs dept with empty
  groupIds (converts to self upstream); findAll additionally self-guards `dept && groupIds.length===0 -> self arm`
  (belt); dept predicate = `or(eq(users.id, userId), inArray(users.id, db.select({id: groupUsers.userId}).from(groupUsers).where(inArray(groupUsers.groupId, ids))))`
  — subquery-in-inArray (typed, 0.45.3), NO raw-sql array interpolation (flows: `IN (${ids})` spread would bind one param = corrupt).
- `UserManager.isWithinScope(targetUserId, scope)`: single-SQL mirror of the same arms (self: id=; dept: id= OR
  EXISTS gu×g kind=dept AND gu.tenant+g.tenant tenant-scoped; all: true).

### 3.3 Server wiring (T-SERVER)
- `apps/server/src/utils/data-scope.ts`:
  `resolveUserRowScope(request, code: 'users:read'|'users:write'|'users:delete')` — **[R1/B1 fix]** per-route code.
  **[R2 apikey]** if `request.user.type === 'apikey'` -> `{kind:'all'}` short-circuit BEFORE any getUserDataScope
  call (machine lanes = tenant-wide; matches guard's existing apikey bypass + ledger).
  JWT: `getUserDataScope(sub, code, tenantId)`; null (code absent) = unreachable via guarded routes (preHandler
  403s first — true for the JWT lane now that apikey short-circuits); dept adds `getDepartmentIdsForUser`,
  **[B4]** `kind:'dept', ids.length===0 -> {kind:'self'}`.
- users routes wiring: list/export pass `scope` into `findAll`; detail/update/PATCH status/roles-view/setRoles/
  force-logout/reset-password guard via `isWithinScope` -> 403 `DATA_SCOPE` envelope (conflict-mapper not used;
  plain forbidden). **[flows oracle decision]** in-scope-not-found stays 404; out-of-scope = 403 (existence leak
  limited to users:read holders inside the same tenant — acceptable, force-logout precedent; uuid ids unguessable).
- create/invite/import: `scope.kind==='all'` else 403 DATA_SCOPE (**[R3] import explicitly included**, same code
  users:write, same gate loop).
- **[B2] delete arm:** plain delete guarded by users:delete scope; `eraseAudit===true` additionally requires
  `users:delete` scope === 'all' — checked BEFORE routeTx/lock (denied erase never touches 727242).
- roles PUT: fastify schema `permissionScopes: { patternProperties/enum ['all','dept','self'] }` ->
  forward to update -> private funnel (clamp double-protects). groups POST/PUT kind enum passthrough
  (validation route-side; default 'group').

### 3.4 Frontend (T-UI)
- Groups page kind column/switch (A5 editable) + i18n en/zh.
- Roles page: when selected ids include users:* -> one Select (全部/本部门/仅本人); **[B5]** if hydration map shows
  DIVERGENT users:* scopes, render a disabled '混合' sentinel state + tooltip disclosing that save unifies.
  GET /roles/:id projection extended with `permissionScopes` (users:* entries only; honest for API-set divergence).
- Users page zero delta (transparent).

### 3.5 Docs wave (T-DOCS, controller)
- reality catalog: 403 `DATA_SCOPE` (emitters users routes incl. erase gate).
- openapi regen (roles/groups payload additions; path count stays 103).
- headers: database.md + auth-provider/rbac doc rows; CHANGELOG/status/conventions (Phase data-scope block:
  scope-at-funnel+projection-pin+apikey-short-circuit+erase-escalation checks), AGENTS baseline if counts move.

## 4. Tasks & lanes
- **T0** controller: migration 0013 + dual SENTINELS (quoted `"groups"` probe form) + ops 14 + schema columns + db:push. RED via ops-migrate.
- **T-IDENTITY** deep lane: §3.2 (B3 projection pin + round-trip RED + both-dedup widening + getUserDataScope +
  getDepartmentIdsForUser + findAll scope arms + isWithinScope) + unit tests. Owns the 4 managers/types + tests.
- **T-SERVER** deep lane (after T-IDENTITY): §3.3 incl. R1 code arms + R2 apikey + R3 import + B2 erase +
  route tests + reality-catalog row.
- **T-UI** lane: §3.4 + e2e (mock roster unchanged; no new /login-shell probes) + api type deltas.
- **T-DOCS** controller.
- File-mutex honest: T-SERVER owns routes/roles.ts AND routes/groups.ts; T-UI depends on the §3.3 frozen
  payload contract (`permissionScopes` / `kind`). T-IDENTITY/T-SERVER sequential (API dependency).

## 5. Test net (RED-first)
- identity: **[B3]** scope round-trip through getUserDataScope (real projection, not persistence spy);
  widest-wins BOTH dedup sites; setRolePermissions persists scopes + update() tenant invalidation (cache drop
  observable); getDepartmentIdsForUser both-table tenant predicates; findAll SQL-shape spies (dept = inArray-subquery
  arm w/ self-union; empty->self NEVER via dropped condition [B4]); isWithinScope matrix.
- server: each surface governed by ITS OWN code's scope [R1] (delete-by-users:write-scope-mismatch RED);
  apikey caller on users routes -> all [R2]; import 403 under dept [R3]; eraseAudit+dept-scope -> 403 BEFORE tx [B2];
  plain delete dept-scoped within-scope -> works; out-of-scope 403 DATA_SCOPE + audit row; in-scope-missing 404
  unchanged; roles PUT fan-out -> manager receives permissionScopes; groups kind roundtrip; SCIM zero-regression.
- integration real-PG: dept list = members+self exactly; second dept invisible; multi-dept union; empty-dept
  dept-scope caller sees ONLY self; cross-tenant stacking; erase-under-dept denied at gate.
- e2e: kind tag, scope Select (+ mixed sentinel), users list transparent. Flakes: b34d986 poll, PIT-083 remoteAddress.

## 6. Gates
Full vitest PG-UP 0 failed (1447 + new; cool-down between runs per PIT-083); 4×tsc; eslint 0-error 0-new;
e2e full re-run (admin-ui delta); ops 14; openapi path count unchanged.

## 7. Ledger / residues
- LDAP department sync (full-sync ladder item); SCIM scope semantics beyond apikey→all; audit/events dept
  filtering (A2-alt); PermissionManager.setRolePermissions dead-twin removal (backlog); stats cards stay
  tenant-coarse [B6]; erase escalation per A6 final ruling.
