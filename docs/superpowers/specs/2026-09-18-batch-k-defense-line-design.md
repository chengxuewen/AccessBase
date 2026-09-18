# Batch K — Defense-Line Pack (tenant read isolation + RBAC moat + CORS fail-fast)

**Date:** 2026-09-18
**Level:** full (three HIGH-severity clusters from the three-lens ops audit; dual-Momus mandatory)
**Provenance:** multi-tenant audit (audit/stats read side unfiltered), RBAC audit (isSystem dead guard, no last-admin protection), ops audit (CORS reflects any origin with credentials when unset)

## 1. Motivation — verified gaps

| # | Gap | Evidence | Severity |
|---|-----|----------|----------|
| G1 | Audit list + CSV export have NO tenant filter (`buildWhere` = action/actor/dates only; `grep tenantId routes/audit.ts` = 0) → any tenant admin with audit:read sees every tenant's logs | apps/server/src/routes/audit.ts:30,74,134 | HIGH leak |
| G2 | Dashboard stats count users/roles/sessions/audit globally, no tenant scope | apps/server/src/routes/stats.ts:35-41 | HIGH leak |
| G3 | RoleManager `isSystem` guards (update:207, delete:259) are dead code: create hardcodes `isSystem: false` (RoleManager.ts:76) and no path ever sets true → admin role editable to the point of disarming every admin (Roles.tsx even offers an empty-permissions confirm flow). Also no last-admin / self-demotion guard on role unassignment, user delete, user suspend | RoleManager.ts:76; grep last-admin = 0 hits | HIGH lockout |
| G4 | roles.ts has zero catch sites — even if the guard fired, generic Error → 500, not a mapped 409 envelope | grep catch roles.ts = 0 | MED (bundled into G3) |
| G5 | CORS: unset CORS_ORIGINS in production → `origin: true` + `credentials: true` reflects any origin. JWT_SECRET has prod fail-fast (config.ts:44); CORS does not | config.ts:64, cors.ts, app.ts:63-65 | HIGH prod footgun |

Out of scope (stays on backlog): tenant bootstrap/membership UI (L batch), /metrics + CI e2e + migration baseline (M batch), OIDC grant persistence (N batch).

## 2. Design

### K1 — Tenant read isolation

- `auditRoutes.buildWhere` gains a required `tenantId` condition. Policy: `tenant_id = :t OR (tenant_id = 'system' AND :t = DEFAULT_TENANT)`. Rationale: public-phase auth events (login failures, lockouts — no JWT yet, middleware writes 'system') carry emails and must NOT surface to non-default tenants, but the default-tenant (platform) admin keeps visibility of the auth log stream. Strict `eq` would hide the admin's own login audit trail — accepted trade flipped in favor of explicit platform visibility.
- `statsRoutes`: user/role/audit counts + recent activity gain `eq(tenantId, :t)` (same 'system'-visible-to-default rule for audit); `activeSessionCount` joins `users` on `sessions.userId` and filters `users.tenantId` (sessions has no tenant column). `request.tenantId ?? DEFAULT_TENANT` fallback shape (public-route convention — stats is auth-scoped so claim is present).
- No frontend change (pages consume the same envelope shapes).

### K2 — RBAC moat

- **Stamps:** `RoleManager.create` accepts `isSystem?: boolean` (default false); init.ts + setup.ts create the admin role with `isSystem: true`. Self-heal (`permissions-seed.ts` startup) additionally runs an idempotent stamp as **direct SQL with no tenant filter** — `UPDATE roles SET is_system = true WHERE name = 'admin'` — matching the existing seed code style (seedBuiltinPermissions already writes via direct SQL, so stamping does not re-enter RoleManager guards). NOT via `RoleManager.update` (its input does not accept isSystem and, once true, the guard would make re-stamping non-idempotent).
- **Error tags (TENANT_PROTECTED precedent):** identity exports `ROLE_PROTECTED` and `LAST_ADMIN_GUARD` message prefixes; RoleManager throws `ROLE_PROTECTED: ...` on system-role update/delete (replacing bare messages); roles.ts + users.ts gain a shared error mapper → 409 envelope with readable English message (mirrors tenants.ts sendTenantError).
- **Last-admin guard:** before an operation would leave a tenant with zero ACTIVE users holding the isSystem admin role, throw `LAST_ADMIN_GUARD: ...`. The predicate lives in a shared exported module (`packages/identity/src/services/last-admin-guard.ts`) — NOT a private helper, it spans two managers. Guard sites (all manager-level funnels, so every caller is gated): `RoleManager.setUserRoles` and `RoleManager.revokeFromUser` (when an isSystem admin role is being removed), `UserManager.delete`, and `UserManager.changeStatus` on transitions to suspended — the latter covers the admin UI AND the five SCIM direct-disable sites (scim.ts:422/449/499 + PATCH/PUT active→false), which a route-level check would leave wide open. Registration 'pending' transitions never fire the guard. Count predicate: users joined user_roles joined roles WHERE role.isSystem AND users.status='active' AND users.tenantId=:t.
- **API surface:** GET role list/detail expose `isSystem` (identity + @accessbase/types Role interfaces + mapToRole). Roles.tsx: isSystem rows render edit/delete disabled with a lock affordance; empty-permission confirm never reaches a protected role. No locales additions — the server 409 envelope carries a readable English message and `apiErrorMessage` displays the server message verbatim (there is no code→key i18n lookup mechanism; locale keys would be dead keys).

### K3 — CORS production fail-fast + startup-path wiring

- config.ts: alongside the JWT_SECRET prod throw — `NODE_ENV === 'production' && CORS_ORIGINS empty → throw` with the exact remediation hint (comma-separated allowlist). Dev/test behavior unchanged (reflect). Follow the existing JWT fail-fast test seam (config.test.ts resetModules+env+dynamic-import). **Same task, mandatory wiring:** shipped prod start paths set NODE_ENV=production WITHOUT CORS_ORIGINS (docker-compose.prod.yml:9; accessbase.sh container mode -e) — the fail-fast would crash-loop them. docker-compose.prod.yml gains `CORS_ORIGINS: ${CORS_ORIGINS:?CORS_ORIGINS required in production}` mirroring its JWT_SECRET pattern; .env.example's CORS_ORIGINS line gets a production-required note.

## 3. Acceptance

- vitest: audit list/export/stats queries carry the tenant predicate (structural mock-capture or inject-level two-tenant fixtures proving cross-tenant invisibility); ROLE_PROTECTED 409 mapping test; last-admin guard matrix (unassign-self-as-only-admin, delete-only-admin, suspend-only-admin, non-admin ops unaffected); config CORS throw test.
- Self-heal stamp is idempotent + runs in index.ts only (buildApp no-side-effect rule, conventions).
- e2e: existing suites zero new failures; one roles-crud.spec negative (admin row controls disabled).
- Gates: root tsc + admin-ui tsc + eslint changed files 0 error; batch-gate semantics 0 failed; e2e full run green.
