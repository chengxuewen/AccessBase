# OIDC Provider Implementation Plan (Batch 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AccessBase becomes an OIDC Identity Provider — third-party apps register as clients and obtain tokens via authorization_code + PKCE and client_credentials, with a clients management UI — closing the largest ratified positioning gap (table stakes in 5/5 mainstream IAM platforms).

**Architecture:** `oidc-provider` (panva, v9.12.2) mounted at `/oidc` behind the existing Fastify server (raw http body parsing delegated via `fastify-express`-free approach: mount the Koa app through `app.all('/oidc/*')` proxying to the provider callback — using node's http-level integration point `provider.callback`). Custom adapter persists clients/grants/codes to PostgreSQL via Drizzle (`oidc_clients`, `oidc_grants` tables — codes/refresh tokens intentionally short-lived and NOT persisted; device/user codes unsupported in scope). `accountId` = AccessBase user id; interaction flow reuses the existing Login page via redirect to `/login?redirect=<oidc interaction url>`; consent handled by a minimal consent page consuming the interaction prompt. Client registry CRUD at `/api/v1/clients` behind `clients:read`/`clients:write` codes (Batch-1 dual-registration pattern, seed 13→15). Client secrets are stored hashed (sha256) — plaintext shown once at creation.

**Tech Stack:** TypeScript strict, Fastify + Drizzle (PostgreSQL 16), oidc-provider 9.12.2, React 19 + AntD5, vitest + Playwright, pnpm monorepo.

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
  - `create(input: { name, redirectUris, grantTypes, scope, tokenAuthMethod? }): Promise<{ client: OidcClientRow; plaintextSecret: string }>` — generates clientId (`ab_` + randomBytes(8).base64url) + secret (randomBytes(32).base64url), stores AES-256-GCM encrypted blob (key = scrypt(JWT_SECRET))
  - `list(): Promise<OidcClientRow[]>` — NEVER includes secretEncrypted in projections (select explicit columns)
  - `get(clientId): Promise<OidcClientRow | undefined>`
  - `rotateSecret(clientId): Promise<string>` — new plaintext, updated hash
  - `remove(clientId): Promise<void>`
- Barrel export follows OptionsManager pattern.

- [ ] **Step 1: RED tests** — fixture per PermissionManager/OptionsManager pattern (vi.mock db + chainable). Cases: create returns plaintext once + stores ENCRYPTED blob (plaintext never in DB — assert the stored column differs from the returned secret); list excludes secretEncrypted column; decrypt(encrypt(secret)) roundtrip via exported crypto helpers; rotateSecret invalidates old (old plaintext no longer decrypts to same blob check); remove.
- [ ] **Step 2: RED run** → module not found
- [ ] **Step 3: Implement** — crypto module `encryptSecret`/`decryptSecret` helpers (AES-256-GCM, scrypt key from JWT_SECRET, exported for adapter reuse); secretEncrypted NEVER in list/get selects
- [ ] **Step 4: GREEN + package suite** — `pixi run npx vitest run packages/identity`
- [ ] **Step 5: Commit** — `feat(identity): OidcClientManager with hashed secrets and timing-safe verification`

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

### Task 4: oidc-provider instance + adapter + mount

**Files:**
- Create: `apps/server/src/oidc/provider.ts` (provider factory: config, keystore from RS256 files, adapter)
- Create: `apps/server/src/oidc/adapter.ts` (Drizzle-backed adapter: findAccount via UserManager; clients from OidcClientManager; grants ↔ oidcGrants; everything else in-memory Map — codes/transient are single-use by protocol)
- Create: `apps/server/src/oidc/interaction.ts` (interaction url → `/login?redirect=...` and consent page route handlers)
- Modify: `apps/server/src/app.ts` (mount `/oidc/*` → `provider.callback`)
- Test: `apps/server/src/__tests__/oidc-provider.test.ts`

**Interfaces:**
- Produces: `buildOidcProvider(deps: { userManager, clientManager, optionsManager }): Provider` — issuer from config (`OIDC_ISSUER` env, default `http://localhost:5101`), scopes `openid profile email offline_access`, features: `{ devInteractions: false, registration: false, revocation: true, introspection: true }`, pkce required, clientCredentials enabled.
- Produces: `buildOidcProvider(deps: { userManager, clientManager, optionsManager }): Provider` — issuer from config (`OIDC_ISSUER` env, default `http://localhost:5101`), scopes `openid profile email offline_access`, features: `{ devInteractions: false, registration: false, revocation: true, introspection: true }`, pkce required, clientCredentials enabled.
- Adapter contract: oidc-provider Adapter class — `upsert(id, payload, expiresIn)`, `find(id)`, `findByUid`, `findByUserCode`, `destroy`, `consume` — in-memory Map for transient kinds (AuthorizationCode, Interaction, InteractionSession, RefreshToken, Session), Drizzle-backed for Client (via OidcClientManager) and Grant (oidcGrants table).
- Client-secret storage (R2, DECIDED RULING): oidc-provider compares `client_secret` literally against plaintext — a hash cannot sit at the provider boundary. Therefore secrets are stored **AES-256-GCM encrypted** (key = scrypt(JWT_SECRET, salt), Node crypto ~15 lines); adapter `find(kind=Client)` decrypts and returns plaintext to provider memory only. Consequences: (a) schema column is `secretEncrypted` (Task 1/2 use encryption, NOT sha256 hashing — Task 2's `verifySecret` is replaced by provider-internal comparison and is dropped); (b) standard clients send the plaintext secret over TLS via client_secret_basic — unchanged from ecosystem norms; (c) plaintext exists once in the create response and decrypted only inside the oidc process.

- [ ] **Step 1: RED tests** — provider builds; adapter Client.find roundtrips a created client (create via OidcClientManager with encryption key set); authorization_code+PKCE full flow via `provider.callback` injection (supertest-style against the mounted path): authorize request (redirect_uri match, PKCE challenge) → interaction redirected to login url → simulate authentication by calling provider.Interaction.get + finishLogin with user id → consent grant → code exchange with verifier → id_token RS256-verifiable via public key; client_credentials flow issues access token for machine client; invalid redirect_uri rejected; PKCE missing/wrong verifier rejected.
- [ ] **Step 2: Implement adapter + provider factory + interaction glue**
- [ ] **Step 3: Mount in app.ts — `app.all('/oidc/*', ...)` bridging raw req/res to `provider.callback(req, res)` via Fastify's raw request access**
- [ ] **Step 4: GREEN + full server suite**
- [ ] **Step 5: Commit** — `feat(server): oidc-provider with drizzle adapter, pkce, and interaction glue`

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

- [ ] **Step 1: security-hardening skill pass** — run the project's security-hardening skill checklist over the new attack surface: /oidc/* endpoints unauthenticated by design (protocol), redirect_uri validation, PKCE enforcement, secret storage, interaction resume open-redirect guard, consent CSRF posture (same-site cookie from provider), issuer config. Findings → fix in this task or ledger as follow-ups with user sign-off for anything structural.
- [ ] **Step 2: Full gates** — tsc ×2, root vitest, e2e chromium (expect: new specs green; failures = the 13 pre-existing only)
- [ ] **Step 3: Memory updates + commit** — `docs(memory): record oidc provider batch completion`

## Out of Scope (ratified LOCK)

- SAML, implicit, hybrid, device flow, backchannel logout, claims-param customization
- Dynamic client registration (RFC 7591)
- Refresh-token rotation changes (reuse existing SessionManager semantics)
- Multi-issuer / multi-tenant OIDC

## Risks

- **R1:** oidc-provider (Koa) inside Fastify — bridging via provider.callback(req, res) is the documented integration path but needs care with Fastify's body parsing (`app.all('/oidc/*', { config: { rawBody: true } })` or mounting before body-parser). Mitigation: Task 4 mounts at raw level; body-parser exclusion for /oidc/* verified in tests.
- **R2:** Client secret at rest — resolved by AES-256-GCM encryption with key derived from JWT_SECRET (scrypt), encrypted blob stored in `secretEncrypted` column (Task 1/2).
- **R3:** Interaction resume → login page must NOT create a session for the OIDC user that bypasses consent — consent is enforced by provider prompt; Login redirect only resumes the provider's own interaction cookie.
