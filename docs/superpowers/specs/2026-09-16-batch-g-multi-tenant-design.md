# Batch G — Multi-tenant Foundation (Design)

**Status**: Proposed 2026-09-16
**Origin**: Gap-analysis P2 final item (groups/tenants). Isolation pipeline already exists (all Manager queries take tenantId; 30s permission cache keyed `perm:{tenantId}:{userId}`; JWT carries tenantId claim) but is fed DEFAULT_TENANT everywhere (~25 sites).
**Execution**: Batch A–F protocol — dual-Momus adversarial review of this spec, plan, subagent-driven TDD.

## 0. Architecture ruling (user-confirmed)

Backend full chain, NO frontend tenant switcher. Tenant is fixed at login (JWT claim), never overridable per-request by the client. Admin cross-tenant operation = out of scope (backlog).

## 1. Scope

### G1: tenants table + TenantManager + CRUD + permission codes

- `tenants` table in identity schema: `id uuid pk default gen_random_uuid()`, `name varchar(200) notNull`, `slug varchar(64) notNull unique` (URL-safe identifier), `status varchar(20) notNull default 'active'`, `createdAt/updatedAt timestamps`. Index on slug (unique covers it).
- Seed: DEFAULT_TENANT row (`00000000-0000-0000-0000-000000000001`, name 'Default', slug 'default') inserted idempotently (ON CONFLICT DO NOTHING) by the permissions-seed self-heal path (it already seeds roles/permissions at startup) — the FK story: existing tenantId columns are bare UUIDs (no FK); G does NOT add FK constraints (existing dev DBs have rows; ALTER ADD CONSTRAINT would fail on any stray value; constraints = backlog after a data audit).
- `TenantManager` (identity): create/findAll(paginated)/findById/update/delete (delete = soft: status 'suspended' + refuse when non-default; hard delete never), slug uniqueness enforcement. Follows existing Manager conventions (constructor db, logger, paginated result shape).
- Routes `routes/tenants.ts`: CRUD under `/api/v1/tenants` + permission codes **tenants:read / tenants:write / tenants:delete** — dual-registered in authorize.ts routePermissions AND permissions-seed.ts BUILTIN_PERMISSIONS + RESOURCES array (18→21; conventions check commands updated: seed count = 21, diff check passes). Routes deny-by-default via requirePermission preHandler (same as users/roles).
- Suspension semantics: suspended tenant → login (all six issuance paths) rejects with 403 AUTH_TENANT_001 'Tenant suspended' via the authenticate chain: JWT already carries tenantId (oauth.ts:341); login issuance adds a tenant-status check before issueTokenPair in all six paths (login/ldap/webauthn/oauth-exchange/saml-exchange/magic-consume) — same suspended-gate family as user status (batch A pattern).

### G2: request-context tenantId injection + DEFAULT_TENANT retirement

- `authenticate` decorator extension: JWT claim tenantId → `request.tenantId` (fastify.d.ts augmentation). Claims-less legacy tokens (pre-batch A pattern) → DEFAULT_TENANT fallback (backward-compatible, mirrors status-claim tolerance).
- Replace all ~25 DEFAULT_TENANT call sites in routes with `request.tenantId` (roles.ts ×5, setup.ts ×5 — setup keeps DEFAULT_TENANT for admin bootstrap since no JWT exists yet, saml.ts ×2, oauth.ts ×1, api-keys.ts ×3, permission.ts ×1). Self-heal seed (permissions-seed.ts) KEEPS DEFAULT_TENANT (infrastructure, not request-scoped).
- Setup admin bootstrap: creates/uses DEFAULT_TENANT row explicitly (findById on the constant; if missing → insert, tolerating existing DBs where the row predates the tenants table).
- `request.tenantId` falls back to DEFAULT_TENANT when: no auth (public routes calling Managers — e.g. LDAP find-or-provision), or claim absent. Public-route issuance paths (login/saml/magic) resolve tenant = DEFAULT_TENANT (G scope: users belong to default tenant unless provisioned otherwise; cross-tenant provisioning = backlog).

### G3: frontend read-only

- Users/Roles pages gain a read-only "Tenant" column (tenantId shown as slug via a tenants lookup cached in module scope). No switcher, no settings page. Login unchanged.

## 2. Non-goals (backlog)

- FK constraints on existing tenantId columns (data audit first)
- Frontend tenant switcher / X-Tenant-ID override / admin cross-tenant ops
- Cross-tenant user provisioning (signup/LDAP/SAML/magic always → DEFAULT_TENANT)
- SCIM, per-tenant branding/options, tenant-scoped options keys (options stay global)
- Hard delete of tenants; tenant usage quotas

## 3. Constraints carried in

- Permission-code dual-registration discipline (conventions check commands; seed 18→21)
- drizzle migration chain: new table via db:push for dev; migration chain file added per PIT (migration chain serves fresh deploys; 0002 migration)
- Migration-chain discipline (batch C): drizzle/0002_tenants.sql added; dev uses db:push
- TDD red-first; pino object-style; English commits/comments; e2e precheck discipline; PIT-048 identity build; PIT-051 root tsc; PIT-053 branch check after every commit; PIT-054 workers=1 authoritative e2e numbers
