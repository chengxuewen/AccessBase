# Batch F — SAML SP + Magic Link + Debt Cleanup (Design)

**Status**: Proposed 2026-09-16
**Origin**: Gap-analysis P2 decomposition (SAML SP + magic link released after batches D/E) + batch E final-review Low findings + MFA ops debt
**Execution**: Batch A–E protocol — subagent-driven TDD, per-task review, dual-Momus adversarial review of the plan before dispatch

## 0. Library selection (librarian-verified 2026-09-16)

**@node-saml/node-saml v5.1.0** — sole new dependency (+@types if not bundled).
Rationale: passport-free core `SAML` class; lightest dep tree (xml-crypto/xml2js/xmlbuilder/xpath, no native builds); best TS types (`MandatorySamlOptions`, `Profile`, `CacheProvider`); `CacheProvider` interface → Redis-backed InResponseTo validation for multi-instance; CJS interop verified safe with `type:module` (tsc emits `exports.X =` pattern, cjs-module-lexer detects).
samlify rejected: mandatory `@authenio/samlify-xsd-schema-validator` (native libxml risk on CI/ARM), sync parse hot path.
Known gaps to design around: node-saml does NOT parse IdP metadata XML (we take cert via config keys, no metadata-XML ingestion in v1); Fastify 4 has no urlencoded parser by default → **plugin-scoped** `addContentTypeParser` inside `routes/saml.ts` only (app.ts invariant `grep -c addContentTypeParser = 0` preserved; /oidc onRequest hijack unaffected).

## 1. Scope — three independent work packages

### F1: SAML SP login path (mirror LDAP batch-D shape)

- `packages/identity`: `SamlProvider` (wraps node-saml `SAML` class; protocol-pure like LdapProvider — claims in, no tenant/UserManager knowledge). Config interface `SamlProviderConfig`. Exports from index.ts.
- `apps/server/src/routes/saml.ts` (new plugin, 4 public endpoints, no permission codes — seed stays 18):
  - `GET /api/v1/auth/saml/login` → 302 to IdP (`getAuthorizeUrlAsync`, RelayState = origin)
  - `POST /api/v1/auth/saml/acs` → scoped urlencoded parser → `validatePostResponseAsync` → email from `profile.email ?? profile.nameID` → find-or-provision (same semantics as LDAP: reuse by email, null passwordHash on provision, DEFAULT_TENANT) → **suspended gate 403 AUTH_004** → **MFA step-up `{mfaRequired, flowToken}`** (same shape as login/ldap/webauthn/oauth-exchange: purpose `mfa_verify`, payload `{userId}`, 300s) → else token pair. Error codes `AUTH_SAML_001` (503 disabled/unconfigured) / `AUTH_SAML_002` (401 assertion invalid — generic message, no IdP detail leak) / `AUTH_SAML_003` (500 provisioning failure).
  - `GET /api/v1/auth/saml/metadata` → SP metadata XML (`generateServiceProviderMetadata`) when configured
  - `GET /api/v1/auth/saml/status` → `{enabled}` public probe for the Login page button
- Options keys (options table + env fallback, `get()` helper pattern): `saml_enabled/SAML_ENABLED(false)`, `saml_entry_point/SAML_ENTRY_POINT`, `saml_idp_cert/SAML_IDP_CERT`, `saml_entity_id/SAML_ENTITY_ID(urn:accessbase:saml:sp)`, `saml_idp_issuer/SAML_IDP_ISSUER`, `saml_private_key/SAML_PRIVATE_KEY`, `saml_public_cert/SAML_PUBLIC_CERT`, `saml_clock_skew_ms/SAML_CLOCK_SKEW_MS(300000)`. Mandatory pair to arm: `enabled=true` + `entry_point` + `idp_cert`. Response `200` schema on ACS must declare both `mfaRequired/flowToken` AND token-pair fields (batch-E R2 lesson — fast-json-stringify strips undeclared).
- Validation hardening (non-negotiable): `wantAssertionsSigned: true`, `wantAuthnResponseSigned: true`, `validateInResponseTo: 'always'` with Redis CacheProvider (`saml:req:` prefix via `getRedis()`), `acceptedClockSkewMs` from options, `audience` = entity_id. SLO deferred (backlog).
- Frontend: Login page "Sign in with SSO (SAML)" button rendered when `status.enabled`; href = `/api/v1/auth/saml/login`. No SPA callback changes (ACS 302s straight back with token pair in… no — ACS is form-POST from IdP; response is a 302 to `/login?samlCode=`… **decision: ACS mirrors batch-E OAuth channel**: consume assertion → issue `saml_exchange` flowToken (60s) → 302 `/login?samlCode=…`; SPA exchanges via `POST /auth/saml/exchange` (reuse FlowTokenService cross-route seam + shared-Map stub pattern from batch E). totp users: exchange returns `{mfaRequired, flowToken}` exactly like OAuth exchange. Frontend: `exchangeSamlCode` in stores/auth.ts reuses the same mfaRequired branch shape as exchangeOAuthCode.)
- Tests: SamlProvider unit (vi.mock node-saml), route tests (assertion happy/non-totp/totp-mfa/suspended/disabled/invalid-signature via mocked validatePostResponse), e2e: login page button gated by status mock; ACS full-flow stays vitest-only (no test IdP in CI).

### F2: Magic link login (passwordless email)

- Endpoints in `routes/auth.ts` (public, no permission codes):
  - `POST /api/v1/auth/magic/request` `{email}` → **always 202 identical body** (enumeration resistance); rate-limit 5/15min per email+IP (reuse existing rate-limit plugin route config). If user exists & active: `flowTokens.issue('magic_login', {userId, email}, 900)` → `Mailer.send(email, …, html with link `${uiOrigin}/login/magic?token=…`)` (uiOrigin from options `site_url`, fallback env; Mailer null → log-only 202, warn).
  - `POST /api/v1/auth/magic/consume` `{token}` → `flowTokens.consume('magic_login')` → user lookup → email-match check (`payload.email !== user.email` → generic 401, token already burned) → suspended gate → **MFA step-up same shape** → else token pair. Rate-limit 10/15min per IP.
- Error code `AUTH_MAGIC_001` (401 invalid/expired token, generic).
- Frontend: Login page "Email me a sign-in link" → email form → request; new route `/login/magic` reads `token` query → calls consume → success path identical to login response handling (store token pair / mfaFlowToken branch). persist discipline: no new persisted fields.
- Token security notes (librarian): 256-bit random hex key; raw-token-in-Redis accepted (ephemeral + 15min TTL; sha256-hash storage = backlog hardening); never log/audit the token; audit events `magic_login_requested/consumed` with actor attribution per batch-D rules (no token in responseBody).

### F3: Debt cleanup package (small, independent)

1. `stores/auth.ts` exchangeOAuthCode MFA branch: also clear `token/refreshToken/user` (mirror logout) — kills stale-session revival wart (batch-E Low #1).
2. `Login.tsx`: preserve in-memory mfaFlowToken across `oidcRedirect` full-reload path — sessionStorage handoff (`mfaFlowToken` written before `window.location.assign`, restored+cleared on mount) — fixes totp+OIDC-RP dead-end (Low #2). sessionStorage is session-scoped + cleared on use; acceptable per Zustand persist discipline (transient, not business data).
3. `oauth.test.ts` shared FlowToken stub: burn before purpose check (one line, mirrors real burn-first semantics) (Low #3).
4. `accessbase.sh` env passthrough: verify `MFA_ENCRYPTION_KEY` (and new SAML_*/MAGIC vars) reach server process in all 4 start modes; fix gaps (batch-E ops note; key already in .env.example:44).
5. e2e: add exchange-response mock with `mfaRequired:true` covering the SPA MFA branch at browser layer (batch-E Info finding — cheap, no provider flow needed).

## 2. Non-goals

- SLO (SAML logout) — backlog. IdP metadata XML ingestion — backlog (cert via config only). SAML encrypted assertions — supported by lib, off by default.
- Magic link: no account-provisioning via magic (existing accounts only — enumeration-safe design), no SMS/magic-code OTP.
- No new permission codes, no schema migration (flow tokens stay Redis/memory), seed stays 18.

## 3. Risks / constraints carried in

- fast-json-stringify field stripping on any new 200 schema (R2 lesson) — every new schema declares the union of all return shapes.
- FlowTokenService cross-route consume in vitest → shared-Map stub seam mandatory for F1 exchange tests (batch-E R3 pattern).
- identity package changes → `pnpm --filter @accessbase/identity build` before server tsc (PIT-048/049).
- Language: commits/comments/spec English; plan + AI conversation Chinese.
- e2e precheck: 5101 down (000) + no_proxy exports.
