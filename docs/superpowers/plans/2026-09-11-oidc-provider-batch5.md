# OIDC Provider Implementation Plan (Batch 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AccessBase becomes an OIDC Identity Provider — third-party apps register as clients and obtain tokens via authorization_code + PKCE and client_credentials, with a clients management UI — closing the largest ratified positioning gap (table stakes in 5/5 mainstream IAM platforms).

**Architecture:** `oidc-provider` (panva, v9.12.2) mounted at `/oidc` behind the existing Fastify server (raw http body parsing delegated via `fastify-express`-free approach: mount the Koa app through `app.all('/oidc/*')` proxying to the provider callback — using node's http-level integration point `provider.callback`). Custom adapter persists clients/grants/codes to PostgreSQL via Drizzle (`oidc_clients`, `oidc_grants` tables — codes/refresh tokens intentionally short-lived and NOT persisted; device/user codes unsupported in scope). `accountId` = AccessBase user id; adapter findAccount returns `{ accountId, claims: async () => ({ sub: accountId, name: user.name, email: user.email, email_verified: false }) }` (UserManager field mapping — review M2); interaction flow reuses the existing Login page via redirect to `/login?redirect=<oidc interaction url>`; consent handled by a minimal consent page consuming the interaction prompt. Client registry CRUD at `/api/v1/clients` behind `clients:read`/`clients:write` codes (Batch-1 dual-registration pattern, seed 13→15). Client secrets are stored AES-256-GCM encrypted (review M4 — no sha256 anywhere; see Task 4 ruling). Plaintext shown once at creation.

**Tech Stack:** TypeScript strict, Fastify + Drizzle (PostgreSQL 16), oidc-provider 9.12.2, React 19 + AntD5, vitest + Playwright, pnpm monorepo.

**Dev/Deploy topology (review B3):** dev mode runs SPA on :5173 and API on :5101 — the interaction redirect targets the FRONTEND origin. vite.config proxy gains `'/oidc'` -> http://localhost:5101 (dev) so `/oidc/auth/:uid` resume hits the provider from the SPA origin; interaction.url is composed per environment: dev = `${FRONTEND_ORIGIN}/login?...` (absolute), deploy single-port = relative path. FRONTEND_ORIGIN env (default http://localhost:5173) added to .env.example.

**Spec:** User-ratified decision card (Item 11, option B): oidc-provider library + adapter layer; scope LOCKED to authorization_code + PKCE + client_credentials; SAML/implicit/hybrid/device-flow explicitly OUT; refresh tokens reuse existing rotation semantics; security-hardening skill pass before merge. integration.md already promises OIDC provider endpoints (documented debt, not new scope).

## Global Constraints

- Dual registration: seed ↔ routePermissions move together (clients:read/write → seed 13→15, conventions count expectation updated)
- Client secrets: generated server-side (crypto.randomBytes(32).base64url), stored sha256-hashed, plaintext returned ONCE in the create response — never again retrievable
- Scope allowlist per client: `openid profile email offline_access` + custom scopes validated against client's registered `scope` string (oidc-provider native)
- RS256 signing keys: reuse `JWT_PUBLIC_KEY_PATH`/`JWT_PRIVATE_KEY_PATH` files via a Provider keystore — NO new key generation when existing keys present; fall back to generating an ephemeral keystore in dev with a loud warn (never in production — reuse the JWT_SECRET-style fail-fast posture)
- English commit messages; English code comments; no `as any`/`@ts-ignore`/`@ts-expect-error`/`eslint-disable`/console.log
- i18n en/zh strict symmetry; toasts via feedback bridge
- `export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1` before any test run
- All API responses `{ success, data }` envelope
- Baseline: vitest 396 (+13 from batch-4 fix wave = 413 at plan time... verify with `pixi run npx vitest run 2>&1 | tail`), e2e 80 passed + 13 pre-existing failures (auth×5/dashboard×5/health×3)
- **Scope LOCK**: no SAML, no implicit flow, no hybrid, no device flow, no backchannel logout, no claims-parameter customization beyond openid/profile/email

---

### Task 1: oidc_clients + oidc_grants tables

**Files:**
- Modify: `packages/identity/src/db/schema.ts` (append after `options`)

**Interfaces:**
- Produces:
  - `oidcClients`: `id uuid PK defaultRandom`, `clientId text unique notNull`, `name text notNull`, `secretEncrypted text notNull` (AES-256-GCM blob — see Task 4 ruling), `redirectUris jsonb notNull` (string[]), `postLogoutRedirectUris jsonb default []`, `grantTypes jsonb notNull` (["authorization_code","refresh_token"] or ["client_credentials"]), `scope text notNull` (space-separated), `tokenAuthMethod text notNull default 'client_secret_basic'`, `createdAt/updatedAt timestamptz defaultNow`
  - `oidcGrants`: `id uuid PK`, `providerGrantId text unique notNull` (oidc-provider's grant jti), `userId uuid notNull`, `clientId text notNull`, `scope text notNull`, `createdAt timestamptz` — persisted consent/grant records
  - Row types `OidcClientRow`/`OidcGrantRow`

- [ ] **Step 1: Append tables + row types** (follow options-table style from batch 4 Task 1)

- [ ] **Step 2: Push schema** — `export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1 && pixi run npx drizzle-kit push` (generate fallback if infra down)

- [ ] **Step 3: Typecheck + commit** — `pixi run npx tsc --noEmit -p packages/identity/tsconfig.json`; `git commit -m "feat(identity): add oidc clients and grants tables"`

### Task 2: OidcClientManager (CRUD + secret hashing)

**Files:**
- Create: `packages/identity/src/managers/OidcClientManager.ts`
- Create: `packages/identity/src/__tests__/OidcClientManager.test.ts`
- Modify: `packages/identity/src/index.ts` (barrel export)

**Interfaces:**
- Consumes: oidcClients table (Task 1); MfaManager-style constructor `constructor(databaseUrl?: string | DrizzleDB)`.
- Produces:
  - `create(input: { name, redirectUris, grantTypes, scope, tokenAuthMethod? }): Promise<{ client: OidcClientRow; plaintextSecret: string }>` — generates clientId (`ab_` + randomBytes(8).base64url) + secret (randomBytes(32).base64url), stores AES-256-GCM encrypted blob (per-record salt, `v1:salt:iv:tag:ct` format — review M5)
  - `list(): Promise<OidcClientRow[]>` — NEVER includes secretEncrypted in projections (select explicit columns)
  - `get(clientId): Promise<OidcClientRow | undefined>`
  - `rotateSecret(clientId): Promise<string>` — new plaintext, re-encrypted blob
  - `remove(clientId): Promise<void>`
- Barrel export follows OptionsManager pattern.

- Consent contract (review M3 — Task 6 implements and mocks against this, PIT-033):
  - `GET /oidc/interaction/:uid` → `{ success, data: { clientName, requestedScopes, promptName, uid } }` (envelope)
  - `POST /oidc/interaction/:uid` body `{ decision: 'approve' | 'deny' }` → approve creates grant (oidcGrants row) + `interactionFinished(consent)`; deny → `interactionFinished({ consent: { rejectedScopes } })`
  - Auth: AccessBase bearer token required; interaction's accountId MUST equal token user id (bearer = CSRF-immune; provider `_interaction` cookie is SameSite=lax httpOnly by default — stated posture)
  - GET /oidc/interaction/:uid → { success, data: { clientName, requestedScopes, promptName, uid } } envelope for the consent page
- [ ] **Step 1: RED tests** — fixture per PermissionManager/OptionsManager pattern (vi.mock db + chainable). Cases: create returns plaintext once + stores ENCRYPTED blob (plaintext never in DB — assert the stored column differs from the returned secret); list excludes secretEncrypted column; decrypt(encrypt(secret)) roundtrip via exported crypto helpers; rotateSecret invalidates old (old plaintext no longer decrypts to same blob check); remove.
- [ ] **Step 2: RED run** → module not found
- [ ] **Step 3: Implement** — crypto module `encryptSecret`/`decryptSecret` helpers (AES-256-GCM; per-record random 16B salt; blob format `v1:salt:iv:tag:ct` base64 segments; key = scrypt(JWT_SECRET, salt, 32) — review M5; version prefix supports a dual-key rotation window, rotation completes by re-issuing client secrets via rotateSecret; exported for adapter reuse); secretEncrypted NEVER in list/get selects
- [ ] **Step 4: GREEN + package suite** — `pixi run npx vitest run packages/identity`
- [ ] **Step 5: Commit** — `feat(identity): OidcClientManager with encrypted secrets`

### Task 3: seed clients:read/clients:write + routePermissions

**Files:**
- Modify: `apps/server/src/routes/permissions-seed.ts` (13→15, THREE comments, RESOURCES += 'clients')
- Modify: `apps/server/src/__tests__/permissions-seed.test.ts` (EXPECTED_PERMISSION_COUNT + any literals → 15)
- Modify: `packages/identity/src/hooks/authorize.ts` (+3 mappings: GET/POST /api/v1/clients → read/write, PUT+DELETE /api/v1/clients → write)
- Modify: `.agents/memorys/conventions.md` (count expectation 13→15) — commit together

**Interfaces:** codes consumed by Task 5 routes and Task 7 UI gate.

- [ ] **Step 1: Seed entries + RESOURCES + comments + test literals** (batch-4 T3 exact pattern)
- [ ] **Step 2: routeMappings** — `'GET:/api/v1/clients': 'clients:read'`, `'POST:/api/v1/clients': 'clients:write'`, `'PUT:/api/v1/clients': 'clients:write'`, `'DELETE:/api/v1/clients': 'clients:write'`
- [ ] **Step 3: Convention checks (count 15, diff empty) + vitest both test files green**
- [ ] **Step 4: Commit** — `feat(server): seed clients permission codes and map client routes`

### Task 4a: adapter (review M8 split)

**Files:** Create `apps/server/src/oidc/adapter.ts`; Test `apps/server/src/__tests__/oidc-adapter.test.ts`
- Drizzle-backed Client (shape-mapped snake_case: clientId→client_id, redirectUris→redirect_uris, grantTypes→grant_types, tokenAuthMethod→token_endpoint_auth_method — review m8) + Grant; catch-all in-memory for all other kinds (M6 sets above); findAccount with claims mapping (M2).
- RED tests: Client roundtrip incl. secret decryption (uses encryptSecret helpers from Task 2); grant upsert/find; unknown kind → memory Map; account claims shape.
- Commit: `feat(server): oidc drizzle adapter with account claims mapping`

### Task 4b: provider factory + keystore + mount (B1/B2)

**Files:** Create `apps/server/src/oidc/provider.ts`; Modify `apps/server/src/app.ts`; Test `apps/server/src/__tests__/oidc-provider-mount.test.ts`
- `buildOidcProvider(deps)`: `new Provider(issuer, configuration)`; features `{ devInteractions: false, registration: false, revocation: true, introspection: true, clientCredentials: { enabled: true } }`; **`pkce: { required: true }` explicit** (review m2 — default only forces PKCE for `none` auth method); cookies keys `[sha256('oidc-cookies:' + JWT_SECRET)]` (review m3 — restart-stable, multi-instance shared); keystore from RS256 key files; **production fail-fast when key files absent** (batch-1 posture, new check in provider build — review C); dev fallback ephemeral keystore + loud warn.
- Mount via onRequest hook + reply.hijack() + cached `provider.callback()` handler (B1/B2 exact shape in R1); static-assertion test forbids content-type parsers on /oidc.
- RED tests: provider constructs; /oidc/.well-known/openid-configuration serves; mount hijacks before body parsing (POST urlencoded to /oidc/token reaches provider — the B1 regression lock).
- Commit: `feat(server): oidc provider factory with keystore and fastify onRequest mount`

### Task 4c: interaction glue + full protocol flow tests

**Files:** Create `apps/server/src/oidc/interaction.ts`; Test `apps/server/src/__tests__/oidc-flow.test.ts`
- interactions.url branch (login/consent per M7), consent contract endpoints (M3), B3 topology URL composition (FRONTEND_ORIGIN).
- Full-flow tests: AC+PKCE happy path (interactionDetails → interactionFinished login → grant → code+verifier exchange → RS256 id_token verify), client_credentials flow, invalid redirect_uri rejected, wrong verifier rejected, consent deny path.
- Commit: `feat(server): oidc interaction glue with consent contract and protocol flow tests`

### Task 5: /api/v1/clients CRUD routes

**Files:**
- Create: `apps/server/src/routes/clients.ts` (stats.ts lazy-singleton seam pattern)
- Modify: `apps/server/src/app.ts` (register)
- Test: `apps/server/src/__tests__/clients-routes.test.ts`

**Interfaces:**
- `GET /api/v1/clients` → list (id, clientId, name, redirectUris, grantTypes, scope, createdAt — no secret material)
- `POST /api/v1/clients` → create; response includes `clientSecret` plaintext ONCE
- `POST /api/v1/clients/:id/rotate-secret` → new plaintext once
- `DELETE /api/v1/clients/:id` → 204
- Client validation: redirectUris non-empty for authorization_code clients, https-only in production (http allowed for localhost), scope subset of allowlist

- [ ] **Step 1: RED route tests** (mask-free — this is client metadata; the ONE plaintext secret response is asserted to never appear in subsequent GETs)
- [ ] **Step 2: Implement + register** 
- [ ] **Step 3: GREEN + suites + commit** — `feat(server): oidc client registry CRUD with one-time secret reveal`

### Task 6: Consent page + login redirect glue (frontend)

**Files:**
- Create: `apps/admin-ui/src/pages/Consent.tsx` (minimal consent UI: client name, requested scopes with i18n labels, Approve/Deny buttons → POST to interaction submit endpoint)
- Modify: `apps/admin-ui/src/App.tsx` (public route /consent, outside PrivateRoute)
- Modify: `apps/admin-ui/src/pages/Login.tsx` (accept `?redirect=` param — after successful auth, if redirect present and starts with `/oidc`, navigate there instead of landingPath — preserving the OIDC interaction resume; landingPath logic stays for non-OIDC logins)
- Modify: `apps/admin-ui/src/i18n/locales/{en,zh}.json` (consent scope labels + buttons)

**Interfaces:**
- Login `redirect` param: validated — MUST start with `/oidc/` (open-redirect guard); OIDC interaction resumes the provider flow after login.

- [ ] **Step 1: Consent page + i18n**
- [ ] **Step 2: Login redirect param (guard: /^\/oidc\//)** 
- [ ] **Step 3: e2e oidc-consent.spec.ts** — mock OIDC interaction endpoints: (a) login with redirect param resumes to /oidc (mocked authorize response); (b) consent approve posts and completes (mocked); (c) consent deny; (d) redirect param NOT starting /oidc is rejected → falls back to landingPath. Reuse route-guard-403 mock patterns (PIT-033).
- [ ] **Step 4: Gates + commit** — `feat(admin-ui): consent page and oidc login redirect glue`

### Task 7: Clients management UI (Settings section or standalone page)

**Files:**
- Create: `apps/admin-ui/src/pages/Clients.tsx` (table + create modal + secret-once reveal dialog + rotate confirm + delete)
- Modify: `apps/admin-ui/src/App.tsx` (route /clients gated clients:read via PrivateRoute)
- Modify: `apps/admin-ui/src/layouts/AdminLayout.tsx` (menu item via codeOf)
- Create: `apps/admin-ui/src/api/clients.ts`
- Modify: i18n locales

**Interfaces:**
- Create modal: name, redirectUris (multi-line, one per line), grantTypes (checkbox group), scope (input); on success → Modal with the ONE-TIME plaintext secret + copy button + warning text; secret never shown again (list has no secret).
- Route + menu gated clients:read; actions visible to clients:write (same pattern as users page).

- [ ] **Step 1: api module + page + route/menu/i18n**
- [ ] **Step 2: e2e clients.spec.ts** — (a) page gated: no-permission → 403; (b) list renders mocked clients; (c) create flow → secret reveal dialog shown once; (d) subsequent list does NOT contain the secret; (e) rotate → new secret revealed once; (f) delete flow. PIT-033 mocks.
- [ ] **Step 3: Gates (tsc/eslint/parity/e2e) + commit** — `feat(admin-ui): oidc clients management page`

### Task 8: security-hardening pass + full gates + memory

**Files:**
- Modify: `.agents/memorys/status.md` (+ batch 5 line), `.agents/memorys/conventions.md` (count 13→15 if not done in T3)

- [ ] **Step 1: security-hardening skill pass** — run the project's security-hardening skill checklist over the new attack surface: /oidc/* endpoints unauthenticated by design (protocol), redirect_uri validation, PKCE enforcement, secret storage, interaction resume open-redirect guard (harden: reject `\\` and double-encoded `%2F%2F` after decode — review M7 hardening note), consent CSRF posture (same-site cookie from provider), issuer config, rate-limit impact on /oidc/token (global 100/min/IP shared bucket — exempt or raise for token endpoint, record decision), /oidc audit exemption (oidcGrants table = partial audit trail; record as explicit decision not silent omission). Findings → fix in this task or ledger as follow-ups with user sign-off for anything structural.
- [ ] **Step 2: Full gates** — tsc ×2, root vitest, e2e chromium (expect: new specs green; failures = the 13 pre-existing only)
- [ ] **Step 2b: env/docs updates (review m4/m6/m7)** — add OIDC_ISSUER + FRONTEND_ORIGIN to `.env.example` with comments; record in conventions.md: cookie-keys derivation, /oidc rate-limit decision, /oidc audit exemption (oidcGrants = partial audit trail)
- [ ] **Step 3: Memory updates + commit** — `docs(memory): record oidc provider batch completion`

## Out of Scope (ratified LOCK)

- SAML, implicit, hybrid, device flow, backchannel logout, claims-param customization
- Dynamic client registration (RFC 7591)
- Refresh-token rotation changes (reuse existing SessionManager semantics)
- Multi-issuer / multi-tenant OIDC

## Risks

- **R1 (RESOLVED per review B1/B2):** Fastify parses bodies BEFORE handlers; /oidc form-urlencoded POSTs would 415 and `provider.callback` is a Koa factory (returns a handler), not an invokable method. Mounting uses an onRequest hook (fires before body parsing) with reply.hijack(): `app.addHook('onRequest', (req, reply, done) => { if (!req.url.startsWith('/oidc/')) return done(); reply.hijack(); oidcHandler(req.raw, reply.raw).then(() => done(), done); })` where `const oidcHandler = provider.callback()` is built ONCE after provider construction (cache the returned handler). A static-assertion test forbids registering any content-type parser for /oidc (route-guard.test precedent).
- **R2:** Client secret at rest — resolved by AES-256-GCM encryption with key derived from JWT_SECRET (scrypt), encrypted blob stored in `secretEncrypted` column (Task 1/2).
- **R3:** Interaction resume → login page must NOT create a session for the OIDC user that bypasses consent — consent is enforced by provider prompt; Login redirect only resumes the provider's own interaction cookie.
