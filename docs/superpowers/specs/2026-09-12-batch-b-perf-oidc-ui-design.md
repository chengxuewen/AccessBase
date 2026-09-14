# Batch B Design — Permission Cache + Generic OIDC RP + UI Quick Wins

**Status**: Approved 2026-09-12 (user confirmed 4-section design in chat)
**Origin**: Gap analysis 2026-09-12 four-team report, P1 items #5/#6/#10
**Execution**: Batch A protocol — subagent-driven, per-task review, team adversarial review before dispatch

## 1. Scope — three independent workstreams

### B1: Permission resolution cache (perf)

Current state (verified): `requirePermission` → `hasPermission` → `getUserEffectivePermissions`
runs 2+2N SQL per request (getUserRoles + per-role resolveInheritedPermissions recursion),
zero caching. Hottest path in the system — every guarded request pays it.

Change:
- PermissionManager gains a per-(userId, tenantId) in-memory TTL cache (default 30s).
- Invalidation hooks on every write path that can change effective permissions:
  - RoleManager.update / delete → invalidate affected tenant's entries
  - PermissionManager.create / update / delete → invalidate whole tenant namespace
  - users.changeStatus → clear that userId only
  - user role assignment changes (any users_roles write) → clear that userId
- Fix RoleManager.findAll N+1 in the same task: JOIN role_permissions once, group in memory.

Cache shape: key `perm:{tenantId}:{userId}`, plain Map + timestamp (single instance).
Redis version deferred to multi-instance era (YAGNI now) — cache lives inside
PermissionManager, injection point for tests (clock or ttl param).

### B2: Generic OIDC RP (function)

Current state (verified): oauth.ts hardcodes GitHub/Google — SUPPORTED_PROVIDERS const,
getProvider switch, providerConfigured if/else. arctic already ships these + a generic
OAuth2 class.

Change:
- New options-table key `oauth_providers` (JSON): `{ name: { issuer?, authUrl, tokenUrl,
  userinfoUrl, clientId, clientSecret, scope } }` — admins configure via existing
  Settings→Options page (JSON editing), no new UI page.
- Runtime: merge built-in github/google (env-config) + options-configured generic
  providers at request time. Generic providers use arctic's OAuth2 class with explicit
  endpoints. GitHub keeps D109 PKCE exemption; generic providers default to PKCE.
- Login page renders buttons for all CONFIGURED providers (built-in with env creds +
  options-configured), fetched from a small public endpoint (unauthenticated, returns
  only provider names — no secrets).
- Routes unchanged: /auth/oauth/:provider/authorize|callback already parameterized.

### B3: UI quick wins (experience)

1. Dark mode: antd ConfigProvider + theme.darkAlgorithm; new zustand persist `ui` store
   (theme: 'light'|'dark'|'auto'); html[data-theme] sync; toggle in layout header.
2. Empty-state alignment: unify Audit/Clients/Dashboard empty views on the shared
   EmptyState pattern (Roles page has the precedent).
3. Users status filter: antd table column filters on the status column.

## 2. Data flow and invalidation semantics

```
requirePermission(request)
  → cache hit? ─── yes → decide (0 SQL)
       │ no
       → getUserEffectivePermissions (existing chain)
       → write cache, TTL 30s

Invalidation triggers (explicit calls on write paths):
  RoleManager.update/delete      → clear tenant namespace
  PermissionManager CUD          → clear tenant namespace
  users.changeStatus             → clear one userId
  users_roles writes (assign/unassign) → clear that userId
```

Single-instance memory cache is sufficient: all invalidation triggers run in-process.
Multi-instance deployments would need Redis pub/sub or shared cache — explicit
non-goal this batch (upgrade path documented, not built).

## 3. Testing strategy

- B1: unit tests — hit/miss/TTL-expiry/cross-tenant isolation/invalidate-on-write;
  requirePermission 0-SQL assertion on cache hit (spy on manager methods).
- B2: unit tests — options JSON parse (malformed → skip provider with warn), arctic
  OAuth2 construction, profile normalization; e2e — one generic-provider login flow
  (mock upstream).
- B3: component-level tests for theme toggle + persist restore; e2e — dark-mode toggle
  flow (html[data-theme] assertion).

## 4. Explicit non-goals

- No recursive-CTE rewrite of inheritance resolution (cache removes ~all hot-path
  cost; CTE is optimization-of-the-optimization).
- No Redis-backed permission cache (single instance; upgrade path noted).
- No provider-management UI page (options page JSON editing suffices).
- No new permission codes (B2 reuses existing /auth/oauth/:provider routes; no new
  guarded endpoints) — conventions dual-registration rule not triggered.
