# Batch H — SCIM 2.0 User Provisioning (Design)

**Status**: Proposed 2026-09-16
**Origin**: Gap-analysis P2 final item. Consumes batch G multi-tenant foundation (UserManager tenant-scoped, request.tenantId) and batch C api_keys (sha256-hashed bearer tokens).
**Librarian-verified**: RFC 7643/7644 protocol core + Okta/Azure AD practice + Node lib landscape (2026-03).

## 0. Architecture rulings

- **Hand-rolled protocol mount** (same pattern as /oidc onRequest hijack, SAML routes, LDAP provider): routes/scim.ts plugin + TWO small deps — `scim2-parse-filter` (filter parsing, 0.3.0, TS, zero-dep) + `scim-patch` (RFC 7644 PATCH semantics, 0.9.3, TS). No SCIM server framework.
- **Content-Type discipline**: MUST accept AND respond `application/scim+json`. Fastify's default JSON parser handles the body (identical wire format); response `Content-Type` header set per-route. No new content-type parser needed (app.ts invariant preserved). If an IdP sends strict Content-Type that Fastify 4 rejects (application/scim+json is NOT application/json) → scoped addContentTypeParser in the scim plugin mapping scim+json → JSON.parse (same pattern as SAML urlencoded, encapsulated, app.ts untouched).
- **Bearer auth**: reuse `api_keys` table — new `scope` column (varchar, default 'data') with value 'scim' marking provisioning tokens. Auth: `Authorization: Bearer ab_...` → sha256 lookup → scope must include 'scim' → request.tenantId = key.tenantId. No new table. Token lifecycle (revoke/rotate/one-time-reveal) inherits from batch C.
- **Non-goals**: SCIM Groups (backlog — Okta/Azure user-provisioning works user-only), full filter grammar (only `userName eq` + `id eq` via scim2-parse-filter subset), PUT full-replace (PATCH is the dominant IdP op; PUT supported as full-update for compat), enterprise schema extension (urn:...enterprise:2.0:User).

## 1. Scope

### H1: SCIM token issuance + auth wiring

- api_keys table: `scope` column (drizzle-kit generate 0003 — migration triple per R5 batch G discipline). Seed/migration backfill: existing rows → 'data'.
- api-keys CRUD route: accept optional `scope` field ('data' | 'scim') on create; response/reveal unchanged. `tenants` of scim tokens = key.tenantId (existing).
- app.ts authenticate: apikey branch — if scope='scim', do NOT grant data-plane access (permission check denies via scope mismatch: requirePermission checks `key.scopes` → scim tokens get empty data scopes; conversely 'data' tokens cannot call /scim/* — the scim routes do their OWN bearer check, not app.authenticate).

### H2: SCIM protocol mount (routes/scim.ts)

- Mount: `/api/v1/scim/v2/*` (kept inside /api for proxy alignment; Fastify plugin, encapsulated, own scoped parser for application/scim+json).
- Auth middleware (plugin-scoped preHandler): Bearer token → api_keys lookup → scope='scim' required → request.tenantId = key.tenantId (R7 batch G). 401 on missing/invalid; 403 on wrong scope.
- Endpoints (RFC 7644 §3.2 + §4):
  - `GET /ServiceProviderConfig` — static capability doc (filter/patch/sort/etag supported flags)
  - `GET /Schemas` + `GET /Schemas/{id}` — User schema descriptor (static)
  - `GET /ResourceTypes` + `GET /ResourceTypes/{id}` — User resource descriptor (static)
  - `GET /Users` — ListResponse (pagination: `startIndex` 1-based / `count`; map to our 0-based page = startIndex-1); filter `userName eq "x"` or `id eq "x"` via scim2-parse-filter → translated to a WHERE clause (NOT post-filter — push down to SQL)
  - `GET /Users/:id` — single User resource
  - `POST /Users` — provision (find-or-create by userName↔email; existing → 409 scimType 'uniqueness'); map to UserManager.create with DEFAULT_TENANT (SCIM provisioning is per-tenant via key.tenantId → users land in key's tenant)
  - `PUT /Users/:id` — full replace (name/emails/active; preserve immutable fields id/userName/meta)
  - `PATCH /Users/:id` — Operations array via scim-patch applied to the CURRENT resource representation, then diff-mapped to UserManager.update semantics (most critically: `replace active=false` → users.status='suspended' + session revocation parity with user disable chain; `active=true` → status 'active')
  - `DELETE /Users/:id` — soft: active=false equivalent (users.status='suspended' + session revocation). HTTP 204. No hard delete.
- **User resource mapping** (RFC 7643 §4.1 ↔ users table):
  - `id` ↔ users.id (uuid), `userName` ↔ users.email (case-insensitive unique — SCIM userName MUST be unique per RFC; our email IS unique), `externalId` ↔ new column users.external_id (nullable, for IdP-side correlation; drizzle-kit 0003 same migration as scope column)
  - `name.givenName/familyName/formatted` ↔ users.name (formatted = "given family" composite; store whole name on write, decompose on read as best-effort single name field)
  - `emails[0].value` ↔ users.email; `active` ↔ users.status === 'active'; `meta` = {resourceType:'User', location:`/scim/v2/Users/{id}`, created, lastModified}
  - `password` attribute: if present on POST, route through password hashing + policy (reject if policy fails); if absent → provision with null passwordHash (consistent with LDAP find-or-provision)
- **Error shape**: `{schemas:['urn:ietf:params:scim:api:messages:2.0:Error'], status:'<code>', scimType?, detail}` — uniqueness(409), notFound(404), invalidValue(400), invalidFilter(400), tooMany(413), sensitive(403). NOT our {success,data} envelope — protocol mount exception (same as /oidc).

### H3: Suspension parity (batch A discipline)

- `active=false` via PATCH or DELETE → users.status='suspended' + revokeAllUserSessions (parity with user disable chain). Re-enable → status='active' (sessions stay revoked; user logs in fresh).
- All SCIM writes trigger audit via the global onResponse hook (request bodies contain SCIM JSON — note: no sensitive fields in SCIM User payloads except optional password on POST; audit redact list already covers 'password').

## 2. Non-goals (backlog)

- SCIM Groups / enterprise schema / full filter grammar / PUT deep-merge / ETag If-Match concurrency / bulk endpoint / SPA adapter
- SCIM token self-service UI (token issuance via existing api-keys page with scope dropdown — T2 delivers the API surface; UI polish backlog)

## 3. Tests

- Unit: filter translation (userName eq / id eq / unsupported → invalidFilter), User mapping round-trips, PATCH op → UserManager semantics matrix (add/replace/remove × active/name/emails), error shapes per scimType, pagination conversion (1-based ↔ 0-based), token scope enforcement (data-token → 403, scim-token → allowed, no-token → 401), Content-Type (scim+json accepted+returned)
- e2e: mock-API spec for the SCIM flow via page.route (bearer token + provision + filter + disable)

## 4. Constraints

- New deps: scim2-parse-filter + scim-patch (both TS-native, actively maintained 2026)
- Migration 0003: api_keys.scope + users.external_id (single drizzle-kit generate)
- PIT standing: 048 identity build / 051 root tsc / 053 branch / 054 workers=1; PIT-055 (tenant-scoped mock two-key modeling); PIT-056 (probe assertions on gate calls)
- Tests must run with PG down (H′1 conditional skip precedent if needed)
