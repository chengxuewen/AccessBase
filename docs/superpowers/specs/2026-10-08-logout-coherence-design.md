# Logout-Coherence Batch — Design Spec (rev.2 — dual-Momus absorbed; rulings RATIFIED 2026-10-08)

Date: 2026-10-08 · Ladder position: post-multi-node (status.md: `logout-coherence` -> data-scope -> branding+portal)
Origin: round-2 gap audit ladder + batch F backlog. Scope: logout **coherent with external identity planes** —
SAML SLO (both directions), OIDC RP-initiated end_session for the generic-RP lane, and provider-side
`private_key_jwt` client auth.

**rev.2 change log** — absorbed: BLOCKERS `B1[B]-B9` (verdict APPROVE-WITH-FIXES, B1 mandatory) × FLOWS
`R1-R11` (verdict APPROVE-WITH-FIXES). Cross-hits (double evidence): B1×R3 forged-unsigned-GET, B1c×R2 replay
false-premise, B2×R1 response-arm loop, B5×R5 none-CC gate, B9×R7 method-union. R6 escalated T6 from optional
to precondition. Mutex fix R8. Facts corrected R1/R7/R9/R11.

## 0. Rulings — RATIFIED by user 2026-10-08

- **A1 = kill-all.** IdP-initiated SLO resolves NameID(email) -> user -> `revokeAllUserSessions`. Safe cross-tenant:
  `users.email` globally unique (schema.ts:30; flows CONFIRMED) — one row, one tenant, no straddle.
- **A2 = Redis cacheProvider IN batch — and escalated (R6): it is a PRECONDITION, not an enhancement.**
  `buildProvider` constructs a fresh SamlProvider **per request** (saml.ts:79) -> fresh node-saml SAML instance ->
  default in-memory CacheProvider dies between `/saml/login` (stores AuthnRequest ID) and `/saml/acs`
  (verifies InResponseTo under `'always'`). Real-IdP SAML login is therefore suspected broken even **single-node**
  (never live-fired — batch F e2e mocked the lane). T6-cache lands FIRST; live-fire proof goes to the ledger.
- **A3 = generic providers only** for RP end_session. Google/GitHub backlog.
- **A4 = id_token plaintext** (consistent with sibling access/refresh columns :272-273; exposure already recorded
  by batch M; no wire exposure — oauth_accounts never surfaced by any route, flows CONFIRMED).

## 1. Scope

IN: SAML link persistence (nameID/sessionIndex), SP-initiated logout, IdP-initiated SLO + SP-initiated response
arm, RP end-session URL (generic), `/auth/logout` -> `idpLogoutUrl`, SPA one-hop, provider `private_key_jwt`
(+ per-client jwks), Redis saml cacheProvider, audit-redaction, error-catalog/openapi/runbook/memory wave.
OUT: back-channel logout RECEIVER on our RP side (Q3D flag stays; live-RP = integration day), bearer hardening
(15-min window semantics unchanged, recorded §8), SCIM deprovisioning, google/github end-session, jwks key-rollover
(no client PUT surface — create-only, §8).

## 2. Interface facts (rev.2 — corrected/extended; all re-verified 2026-10-08 by both reviewers)

| Fact | Evidence |
| --- | --- |
| `POST /auth/logout`: findSessionByToken->revokeSession, emits `auth.logout` method `'password'` (:102), returns `{success:true}`, **no response schema declared** (adding `data` passes through, no fast-json strip) | `apps/server/src/routes/auth/core.ts:72-107` |
| SessionManager revoke trio stamp revokedAt + cacheInvalidateUser; **no tokenVersion bump** | `packages/identity/src/managers/SessionManager.ts:257-279` |
| SAML routes :136/:152/:177/:273/:370; plugin-scoped urlencoded parser :30 (covers POST SLO arm); audit exclusion = url-prefix list `app.ts:532-534` (ACS); plugin prefix `/api/v1/auth` (:564) | `apps/server/src/routes/saml.ts`, `app.ts` |
| SamlIdentity `{email,nameId,displayName?}` — nameId captured at ACS then discarded; sessionIndex never read; find-or-provision **at ACS** yields full user row before arms (upsert placement feasible) | `SamlProvider.ts:28-32`; `saml.ts:190-240` |
| **[R1 fix] node-saml validate fns return `{profile, loggedOut}` — there is NO `logoutRequest` field**; message-type discrimination is on `container.SAMLRequest` vs `container.SAMLResponse` (redirect arm branches internally, saml.js:650-654) | `@node-saml@5.1.0 lib/saml.d.ts:29-37,51-58`; saml.js:650-654 |
| **[B1/R3 fact]** redirect binding: `hasValidSignatureForRedirect` **returns true when `container.Signature` is absent** (saml.js:658-679) — unsigned LogoutRequests pass; POST binding enforces signature (saml.js:948-956) | node-saml dist |
| **[B1/R2 fact]** `validateInResponseTo` runs only for RESPONSE arms (saml.js:633-645,1032-1033); cache `saveAsync` happens only when WE generate requests (:142,:295). No built-in replay defense for inbound LogoutRequests. `'always'` + null InResponseTo throws only on the response validator, not on inbound requests. | node-saml dist |
| `logoutUrl` option defaults to `entryPoint` (saml.js:95); LogoutResponse `@Destination` = `options.logoutUrl` (saml.js:317); metadata emits `SingleLogoutService` only when `logoutCallbackUrl` passed (metadata.js:86-89) | node-saml dist |
| `getLogoutResponseUrlAsync(samlLogoutRequest: Profile, ...)` — first arg IS the Profile returned by validate (carries `.ID` -> InResponseTo, saml.js:318,964-965). No arg-shape defect (blockers CONFIRMED). | saml.d.ts:26 |
| CacheProvider shape `saveAsync/getAsync/removeAsync` types.d.ts:22-25; config key `cacheProvider` :144; Profile `sessionIndex?` :196 | node-saml types.d.ts |
| **[B3 fact]** SAML option roster today has NO IdP-logout-URL / SP-SLO-callback key: `saml_enabled/entity_id/entry_point/idp_cert/acs_url/idp_issuer/private_key/public_cert/clock_skew_ms`; options allowlist = `KNOWN_OPTION_KEYS` (routes/options.ts:27,88) | `saml.ts:61-84` |
| RP lane: `DynamicProviderConfig{authUrl,tokenUrl,userinfoUrl,clientId,scope?}` (oauth.ts:45-51); https-only field validation :134-145; PROVIDER_NAME_PATTERN :42; **link insert happens only for new links — existing-link callback path early-returns WITHOUT touching tokens (:333-341)** [R4] | `apps/server/src/routes/oauth.ts` |
| `oauth_accounts`: user_id(64), provider(32), providerAccountId(128), access/refresh **plaintext** (:272-273), expires, **created_at :275** [R11 — newest-link sorting is sortable], unique(provider,providerAccountId) | `packages/identity/src/db/schema.ts:265-284` |
| arctic 3.7.0: `OAuth2Tokens.idToken(): string` **THROWS on absence** (dist/oauth2.js:47-52); no endSession helper (oidc.d.ts = decodeIdToken) — URL built by hand | dist |
| `oidc_clients`: tokenAuthMethod default basic (:340), NO jwks column, bc-uri (:342) | schema.ts:331-345 |
| Clients POST passes `tokenAuthMethod` unvalidated (:70/:120); **routes = POST/GET/rotate-secret/DELETE only — no PUT/PATCH** (create-only surface, downgrade-via-UPDATE impossible) [CONFIRMED both] | `apps/server/src/routes/clients.ts:55/137/153/183` |
| oidc-provider 9.12.2: private_key_jwt native (client_auth.js:48/245); `jwks or jwks_uri is mandatory` client_schema.js:487; requireJwks scoping :478; **default clientAuthMethods already include private_key_jwt + none** (defaults.js:3119) — zero provider-config change for T5; `none` passes client auth unconditionally (client_auth.js:193,225) | dist |
| **[R7 fact]** `AuthEventMethod = 'password'|'totp'|'admin-wizard'` (auth-events.ts:22) — `'saml'` NOT in union; R1-T3 precedent = sanctioned extension in same commit | `apps/server/src/utils/auth-events.ts` |
| **[R9 fix]** frontend store DOES call server: `logoutWithServer` (stores/auth.ts:134-143) already POSTs `{refreshToken}` but **discards the response**; AdminLayout consumes store | `apps/admin-ui/src/stores/auth.ts` |
| audit middleware captures `reply.send` payloads verbatim into responseBody (packages/audit/src/middleware.ts:67-75,99-100); redactor = lowercase field list (types.ts, precedent accesstoken/refreshtoken W1-7) | audit pkg |
| chain dir = 0000..0011 (12 files); ops-migrate `toHaveLength(12)` (:170/:199); SENTINELS format `ver|probe` per chain file (migrate.sh:109-117) | CONFIRMED flows |

## 3. Design (rev.2)

### 3.1 SAML link persistence + SP-initiated logout
- At ACS after find-or-provision: upsert `oauth_accounts(userId, provider='saml', providerAccountId=nameId)` +
  `session_index`. **[B7]** pre-check `nameId.length <= 128`: overflow -> LOUD `logger.warn` naming the swallow
  (link skipped, login unaffected) — invisible-seam doctrine.
- `SamlProvider.logoutUrl(nameId, sessionIndex)` = `getLogoutUrlAsync({nameID, nameIDFormat:identifierFormat,
  sessionIndex} as Profile, '', {})` — destination resolves from **new** `saml_logout_url` option (fallback
  entryPoint with warn) [B3].
- Route `GET /api/v1/auth/saml/logout` (bearer; route-level `config.rateLimit` shape = saml.ts:155 precedent;
  lookup keyed by JWT `sub` — no cross-tenant path): samlConfigured 503 `AUTH_SAML_001`; no saml link ->
  `{logoutUrl:null}` 200.

### 3.2 SLO endpoint — THREE arms (B2/R1 rewrite)
`GET + POST /api/v1/auth/saml/slo`, one plugin-scoped registration, discrimination on `container.SAMLRequest` vs
`container.SAMLResponse`:
- **LogoutRequest arm (IdP-initiated):**
  **[B1/R3]** GET binding: reject (uniform `SLO_FAILED` 302, zero side effects) unless `Signature` AND `SigAlg`
  query params present — node-saml's silent-accept-on-unsigned MUST be overridden route-side. Document: SLO
  requires signed redirect binding (opt-in per IdP) or POST binding.
  **[R2]** replay defense is OURS: SETNX `ab:saml:sreq:<RequestID>` TTL `requestIdExpirationPeriodMs` over
  getRedis (dedup failure = SLO_FAILED; Redis absent -> in-process Map with TTL sweep + loud boot-adjacent warn,
  honest single-node ceiling `ponytail:` comment).
  validate -> profile.nameID(email) -> `findByEmail` -> **A1** `revokeAllUserSessions` +
  `emitAuthEvent({type:'auth.logout', method:'saml'})` [union extension §5] ->
  `getLogoutResponseUrlAsync(profile, RelayState-or-'', {}, true)` -> ALWAYS 302 (ACS posture R1 mirror).
- **LogoutResponse arm (SP-initiated completion):** validate via the same redirect/post validators (here
  `validateInResponseTo` genuinely applies — cache check + consume); success -> 302 `FRONTEND/login`;
  never generate a response back (loop-killer).
- **Failure arm:** any validation/reject/dedup-hit -> 302 `/login?error=SLO_FAILED`, warn-log only, uniform shape
  (oracle closed once B1 lands — blockers CONFIRMED).
- Public route: per-IP `config.rateLimit` 10/min (ACS :180 precedent; PIT-083 dedicated `remoteAddress` in tests);
  audit-excluded by adding `/api/v1/auth/saml/slo` to the app.ts:532-534 prefix list (bulky SAMLRequest bodies must
  not land in audit_logs — R10 family).
- **[R10]** `validateRedirectAsync(request.query, <raw query string>)` — second arg is the querystring AFTER `?`
  (`request.url.slice(indexOf('?')+1)`), NEVER `request.url` path-prefixed — signature base-string corruption trap.

### 3.3 RP end_session (generic providers)
- `DynamicProviderConfig` + optional `endSessionUrl` (https-only, mirror :134-145 validation, drop-with-warn).
- **[R4 fix]** callback generic branch must **upsert** the link row (new insert AND existing-link update):
  tokens + `id_token` refreshed on every login. arctic `idToken()` throws on absence -> guard (openid scope
  expected for generic; empty/throw -> null).
- Route `GET /api/v1/auth/oauth/end-session-url?provider=<name>` (bearer): link row (userId+provider) +
  registry entry with endSessionUrl + stored id_token -> build `${endSessionUrl}?id_token_hint=<urlenc>`;
  anything missing -> `{logoutUrl:null}`. Unknown/invalid name -> 404 `AUTH_OAUTH_001` parity; built-in names
  (github/google) -> `{logoutUrl:null}` (A3).

### 3.4 `/auth/logout` coherence answer + audit hygiene
- Response `{success:true, data:{ idpLogoutUrl?: string|null }}`; resolution: saml link && configured -> §3.1 URL;
  else newest (created_at) generic-oauth link WITH endSessionUrl+id_token -> §3.3 URL; else null. All builders
  fail-soft to null — IdP leg must never fail the logout.
- **[B4]** the URL embeds signed SAMLRequest / `id_token_hint` = token material; `/auth/logout` is audited and the
  middleware persists responseBody (audit middleware :67-75). Fix in same commit: add `idplogouturl` to the audit
  redactor lowercase field list (types.ts; accesstoken/refreshtoken precedent W1-7) + camelCase assertion in
  logger.test. (Convention: "Full tokens never reach logs on any env".)
- SPA: `logoutWithServer` (stores/auth.ts:134-143) captures the response; AdminLayout logout: after local clear,
  `window.location.assign(idpLogoutUrl)` when present else current behavior. e2e: toHaveURL polling (conventions).

### 3.5 private_key_jwt
- `oidc_clients.jwks jsonb NULL` (§4). POST /clients: `tokenAuthMethod` whitelist
  `[client_secret_basic, client_secret_post, private_key_jwt, none]` else `CLIENT_008`;
  **[B5 gate]** `none` REJECTED when grantTypes contains `client_credentials` (anonymous self-asserting mint —
  provider does NOT enforce, client_auth.js:193/225) else `CLIENT_009`; `private_key_jwt` requires `jwks`
  `CLIENT_010`; **[B6]** jwks kty-scoped PUBLIC-member allowlist (RSA: kty/n/e; EC: kty/crv/x/y; OKP: kty/crv/x;
  every other member incl. d/p/q/dp/dq/qi/oth/k -> reject CLIENT_011). New codes into
  reality catalog same commit.
- `OidcClientManager.create` input `jwks?`; secret still generated reveal-once (column notNull; unused, harmless).
- adapter client(): `...(row.jwks ? { jwks: row.jwks } : {})` (one-liner parity with bc-uri :247 mapping).
- No provider config change needed (defaults.js:3119 CONFIRMED). jwks returned in GET/list = public metadata.

### 3.6 Redis saml cacheProvider — PRECONDITION task (A2/R6)
- `apps/server/src/utils/saml-cache-provider.ts`: `CacheProvider{saveAsync,getAsync,removeAsync}` over `getRedis()`
  (key `ab:saml:req:<id>`, TTL = requestIdExpirationPeriodMs default + grace); Redis absent -> fall back to
  node-saml default + one WARN (single-node honest).
- Injection seam = `buildProvider` in saml.ts (constructor option `cacheProvider?` on SamlProvider; identity stays
  redis-free — dispatcher-deps precedent). **[R8]** this lands inside the SAML lane (same file ownership), the
  old T1/T6 mutex collision disappears.

## 4. Migration 0012 (one chain file, `pnpm db:generate` batch-O canon + dev `db:push`)
- `oauth_accounts`: `+ id_token text NULL`, `+ session_index text NULL`
- `oidc_clients`: `+ jwks jsonb NULL`
- **[B8]** SENTINELS: TWO probe entries for 0012 (one per touched table): `0012|SELECT id_token FROM oauth_accounts
  LIMIT 1` + `0012|SELECT jwks FROM oidc_clients LIMIT 1`; ops-migrate dual assertion (batch-N B2 precedent);
  file expectations 12->13 (:170/:199).

## 5. Codes & docs wave
- error-codes-reality.md: + CLIENT_008/009/010/011 rows; note SLO reuses AUTH_SAML_002 posture (302-only).
- `AuthEventMethod` union + `'saml'` [R7] — same-commit, telemetry lane conventions note unchanged.
- options allowlist: + `saml_logout_url` (IdP SLO endpoint) and + `saml_slo_callback_url` (our SP-side callback,
  so metadata can advertise it) [B3] — both into KNOWN_OPTION_KEYS + `.env` passthrough NOT needed (options-only,
  F13 precedent) + Options page docs line.
- metadataXml: pass `logoutCallbackUrl` so SingleLogoutService is advertised (metadata.js:86-89) [B3].
- openapi regen: baseline 99 -> expected 102 (3 new paths; slo GET+POST share one path, 2 ops).
- runbooks: multi-node.md §2 saml-cache row replaces "F1 backlog" wording; §6 smoke: SLO signed/unsigned + cross-node
  round. key-rotation untouched. security.md/saml module headers -> implemented status (D126 gate).
- CHANGELOG + status.md + conventions + AGENTS count.

## 6. Tasks & lanes (rev.2)
- **T0** foundation: migration 0012 + SENTINELS dual + ops flip + schema columns. RED-first.
- **T-SAML** one deep lane (owns SamlProvider.ts + saml.ts + new cache-provider util + tests; R8 merged, zero mutex):
  3.6 cacheProvider FIRST -> 3.1 link + SP-initiated + new option keys + metadata -> 3.2 three-arm SLO.
- **T-RP** lane: 3.3 (endSessionUrl config + existing-link upsert + end-session-url route + tests).
- **T-SPA** lane: 3.4 (/auth/logout data.idpLogoutUrl + audit redactor + logoutWithServer capture + AdminLayout +
  e2e logout spec + PIT-080 roster — no new login probes expected).
- **T-PKJ** lane: 3.5 (routes + manager + adapter + integration: RSA keypair in-test, client_credentials assertion
  roundtrip good/bad, none+CC rejected, jwks private-member rejection; inject shape proven by oidc-flow :22/:315/:425).
- **T-docs**: §5 wave (controller after lanes).
- Baselines after: vitest 1357 + new; e2e 177+3 + new specs **must re-run** (admin-ui delta exists).

## 7. Test net additions (RED-first)
- unsigned GET LogoutRequest -> 302 SLO_FAILED + **zero revoke calls** (spy) [B1 net].
- replayed identical signed LogoutRequest (same ID) -> dedup hit -> SLO_FAILED [R2 net].
- LogoutResponse arm -> no response URL generated (loop regression lock) [B2 net].
- existing generic-oauth link login -> row UPDATED with fresh id_token [R4 net].
- `none`+`client_credentials` create -> 4xx CLIENT_009; jwks with `p`/`k` member -> CLIENT_011 [B5/B6].
- /auth/logout response with idpLogoutUrl -> audit row masked [B4].
- nameID 129 chars -> warn logged + link skipped + login still succeeds [B7].

## 8. Ledger / residues
- R6 latent-defect scope note: if real-IdP SAML login was broken single-node pre-batch, integration-day live-fire
  will reveal it; T-SAML fixes the cache layer regardless. Record honestly in status.md.
- IMPLEMENTATION DEVIATION (accepted, stronger than spec): SLO replay dedup claims the request ID AFTER signature validation, not before -
  only authenticated IDs consume the dedup store (pre-validation claim would let forged requests poison it).
- node-saml reality discovered during implementation: the REDIRECT-binding LogoutResponse arm never reaches validateInResponseTo
  (only the POST response arm does, saml.js:516) - route-side Signature+SigAlg enforcement is the protection there;
  replay of a signed redirect LogoutResponse completes without cache consumption. Residual recorded, posture unchanged.
- Bearer-survives-to-TTL on logout (unchanged; §3.4 does not bump tokenVersion - force-logout precedent).
- jwks create-only: key rollover requires client re-creation (no PUT surface) - operational debt line.
- google/github end-session (A3), backchannel receiver + Q3D live-RP, SCIM deprovisioning.
