# Batch C Design — API Key + Password Policy + Force Logout + CSV Import/Export

**Status**: Approved 2026-09-12 (user confirmed 4-section design in chat)
**Origin**: Gap analysis 2026-09-12 P1 remainder; api.md §23.10 (API Key format, pre-designed) + :122 (audit export, pre-planned)
**Execution**: Batch A/B protocol — subagent-driven, per-task review, team adversarial review before dispatch

## 1. Scope — five independent work items

### C1: API Key (service-to-service auth)

api.md §23.10 already specifies the format: `ab_` prefix + 32 alnum random (35 chars total),
SHA-256 hash storage, fine-grained scopes (ApiKeyScope[]), optional expiresAt, optional rateLimit.

Deliverables:
- `api_keys` table (identity schema): id, name, prefix, hash (sha256), scopes (jsonb), expiresAt?, lastUsedAt?, revokedAt?, tenantId, createdAt/updatedAt
- ApiKeyManager: create (returns plaintext ONCE — one-time reveal like OIDC clients), revoke (soft, revokedAt), list (safe shape — no hash), authenticate(key) → key row or null (hash lookup)
- Auth dual-read: request with `Authorization: Bearer ab_...` where token does NOT parse as JWT → API key path (hash lookup + revoked/expiry check → request.user = {sub: keyId, type:'apikey', scopes}) — JWT path untouched
- CRUD routes `/api/v1/auth/api-keys` (public auth surface, authenticated by JWT + apikeys:read/write/delete permission codes — DUAL REGISTRATION: authorize map + BUILTIN_PERMISSIONS seed, 15→18 codes; conventions check commands updated)
- Settings UI: API Keys management page (create → one-time reveal modal → list/revoke); reuses Clients page patterns

### C2: Configurable password policy

Current: policy hardcoded inline (8+/lower/upper/digit) at register + changePassword + resetPassword ("No minLength here" comment, auth.ts:225).

Deliverables:
- 4 options keys: `password_min_length` (int, default 8), `password_require_upper/lower/digit` (bool, default true) — env fallbacks PASSWORD_MIN_LENGTH etc.
- PasswordPolicy helper (identity package): `assertPasswordPolicy(pw, opts): { ok, code?, message? }` — single source; the three call sites converge on it; defaults = current behavior (zero breakage)
- Reads via OptionsManager three-param form (env > option > default)

### C3: Admin force-logout

Infrastructure exists: revokeAllUserSessions(userId) (SessionManager:213, already wired for suspend in Batch A).

Deliverables:
- `POST /api/v1/users/:id/force-logout` (users:write permission; idempotent) → revokeAllUserSessions + invalidatePermissionCache(userId) (cache hygiene from Batch B)
- Users page row action (existing row-actions dropdown) with confirm; e2e: force-logout → user's refresh fails

### C4: Audit CSV export

api.md:122 planned `/audit-logs/export`. Current: zero CSV infrastructure (grep clean).

Deliverables:
- `GET /api/v1/audit-logs/export` (audit:read permission — existing code, no new codes; same filter params as list)
- Streaming response: text/csv + Content-Disposition attachment; loop OFFSET pages (audit volume YAGNI keyset); CSV-injection guard: prefix `'` for cells starting with `=+-@` (formula injection)
- Audit page export button (respects current filters)

### C5: Users CSV import/export

Deliverables:
- `GET /api/v1/users/export` (users:read) — same CSV pattern as C4 (shared helper)
- `POST /api/v1/users/import` (users:write) — two-phase: parse+validate all rows → report {valid, errors:[{row,field,message}]}; `?commit=true` executes valid rows via UserManager.create (inherits Batch A pending semantics, password policy C2, audit, cache invalidation automatically); error rows reported per-row
- Users page: import/export buttons + import result modal (dry-run report or commit summary)

## 2. Explicit non-goals

- API Key scopes UI/engine: table stores scopes but v1 writes ['*'] only — policy engine is a separate future batch
- Password history/expiry policy (P2 backlog)
- Async import job queue (synchronous; sub-thousand-row scale; larger = future)
- Permission-code management UI (seed mechanism unchanged)

## 3. Testing strategy

- C1: unit — format/one-time-reveal/hash-lookup/revoke-immediacy/dual-read auth; e2e — settings page CRUD flow
- C2: unit — three-param × each key; register/changePassword weak-password cases parameterized against policy options
- C3: route test (permission gate) + e2e force-logout → refresh fails
- C4/C5: unit — CSV generation, injection guard, import validation report, error-row isolation; e2e — export download, import dry-run + commit flow
- Global gates: vitest full / tsc ×2 / e2e baseline zero new failures

## 4. Risks and dependencies

- C1 adds 3 permission codes → conventions dual-registration check commands + expected counts MUST be updated (15→18) in the same commit
- C5 import → UserManager.create inherits Batch A pending semantics (imported users land pending; admin activates — by design, documented in UI copy)
- CSV injection guard required for both exports (formula injection: =, +, -, @ prefixes)
- CSV helper shared by C4/C5 — one module, two consumers (DRY)
- Auth dual-read must NOT weaken JWT path (unknown scheme → existing 401 semantics; API key only when token starts with ab_)
