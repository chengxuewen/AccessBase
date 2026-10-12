# Q3D: OIDC Back-Channel Logout RECEIVER (RP side) — Design Spec

**Date:** 2026-10-12 · **Status:** PROPOSED (rev.2 — dual-Momus absorbed: flows 12 findings R1-R12 + blockers 6 findings B1-B6; 3 cross-confirmed must-fixes landed, verdicts flows APPROVE-WITH-FIXES / blockers REJECT→rev.2)
**Parent:** `2026-10-08-logout-coherence-design.md` (rev.2 §OUT — "back-channel logout RECEIVER on our RP side, Q3D flag stays")
**Deliverable class:** design spec → user approval → implementation batch

---

## 0. Problem statement

AccessBase acts as an OIDC **Provider** (IdP) and already delivers back-channel
logout tokens to registered RPs — live-proven on verification day 2026-10-08
(`provider.ts:206-213` success/error event listeners; delivery-attempt events
observed). But AccessBase as an OIDC **RP** (generic-provider logins,
`rp-end-session.ts` registry) has NO receiver: when an upstream IdP logs the
user out at the IdP, our RP-side session (JWT bearer + refresh chain) stays
alive until TTL. That is the last gap in the logout-coherence story and the
same pipe ModuKit collaboration direction 3 would use for event push
(endpoint + signature verify + idempotency + session effect).

**Goal:** implement `POST /api/v1/auth/oauth/backchannel-logout` per the OIDC
Back-Channel Logout 1.0 semantics, invalidating the affected local sessions
when a verified `logout_token` arrives.

**Non-goals (this batch):**
- No front-channel logout changes (already shipped, batch logout-coherence).
- No changes to our IdP sender path (already live-proven).
- No Keycloak dependency for landing: unit + integration tests stand alone;
  live-fire against a real IdP is the Keycloak-day agenda (§4 L1/L2).
- No jwks rotation surface on OUR clients (registered debt — see M2).

### rev.2 change log (dual-Momus absorption)

- **200 not 205** (R3+B2, cross-confirmed): OIDC BCL §2.8 = MUST 200 OK (204
  tolerated); our own IdP sender (`oidc-provider models/client.js:433,462`)
  accepts 200/204 ONLY — a 205 receiver would fail our own L2 self-loop by
  construction.
- **Config surface made real** (B1 BLOCKER): `DynamicProviderConfig` gains
  `issuer` + `jwksUri` (verified absent: `rp-end-session.ts:24-32`); loader
  validation, exact-match iss, duplicate-iss rejection, trailing-slash policy.
- **bumpAuthState reality** (B3 HIGH): real signature
  `bumpAuthState(db, {tenantId, userIds}, delAuthStateKeys?)`
  (`packages/identity/src/services/token-version.ts:22-25`); identity-internal
  only, not root-exported, zero server call sites — spec now names tenantId
  source, delAuthState decision, and import mechanism.
- **Dedup ordering + key** (R2 + B4): SLO claim-first idiom is a category
  mismatch — BCL effects are idempotent, so dedup claims LAST (after effects)
  and is RELEASED on failure; key = verified `jti` (REQUIRED per BCL §2.4 —
  rev.1's "RECOMMENDED" was a false protocol claim) falling back to
  sha256(bytes).
- **sid-only / null-sub = 200 no-op** (R4+B6): protocol-valid tokens must not
  400 (400 invites IdP retry storms); Keycloak sends `sub: null` for
  client-initiated logouts — explicit `null ≡ absent` resolution.
- **Scoped error handler** (R5): global `{success,data}` envelope must never
  leak onto this IdP-facing machine route — route-scoped `setErrorHandler`
  (SCIM precedent `scim.ts:187`).
- **urlencoded parser tasked** (B5): route-scoped `addContentTypeParser`
  (SAML precedent `saml.ts:31-36`) + static-invariant test extension.
- **Test matrix +6** (R7, R8, R10): alg rejection, kid-miss refetch,
  sub+sid happy path, cross-provider isolation, jwks-fetch-failure fail-closed,
  max-token-age, events-member leniency.

---

## 1. Verified facts (PIT-076 discipline — checked same-session, re-verified by both Momus lanes)

| # | Fact | Evidence |
|---|---|---|
| F1 | RP links persist per-login id_token: `oauth_accounts.id_token` (0012), `session_index` (SAML); both nullable — token-nulling needs NO migration | `packages/identity/src/db/schema.ts:267-293` |
| F2 | RP end_session builder single-source `rp-end-session.ts`; skips links without id_token (`if (!row.idToken) continue`, ~:159-172) | `rp-end-session.ts:156-176` |
| F3 | Link writes are UPSERTs refreshing id_token on EVERY generic login (R4) | `apps/server/src/routes/oauth.ts:336-367` (`upsertGenericLink`) |
| F4 | Our RP does NOT persist the OIDC session id (`sid`) — zero `\bsid\b` hits in routes | grep, both lanes re-verified |
| F5 | Registry = `loadDynamicProviders()` in `rp-end-session.ts`; config from `oauth_providers` options key (non-sensitive JSON) + `oauth_<name>_client_secret` masked keys; malformed entries skip-with-warn | `rp-end-session.ts:20-45` |
| F6 | SETNX dedup idiom with `_resetSloDedupForTest` seam | `apps/server/src/utils/saml-logout.ts:125-162` |
| F7 | jose 6.2.10 transitive-only (oidc-provider package.json `jose: ^6.2.10`); server does not declare it | `node_modules/.pnpm/jose@6.2.10` |
| F8 | IdP sender reads `backchannel_logout_uri` from client rows; `backchannelLogoutEnabled` gates feature | `adapter.ts:246-247`, `provider.ts:26,134-135` |
| F9 | `SessionManager.revokeAllUserSessions(userId)` exists (`managers/SessionManager.ts:265`); bearer kill = `bumpAuthState(db, {tenantId, userIds}, delAuthStateKeys?)` in `token-version.ts:22-25` — NOT root-exported, zero server imports | both lanes verified |
| F10 | Route-level rate-limit override supported; /oidc space has its own guard | `rate-guard.ts`, M-batch conventions |
| F11 | New wire codes need same-commit `error-codes-reality.md` rows (D126); vitest baseline flips same-commit | conventions Q0 + Q1 |
| F12 | Global error handler wraps errors in `{success,data}` envelope and leaks `error.message` for <500 (`app.ts:258-272`); SCIM solved identical shape deviation with plugin-scoped `setErrorHandler` (`scim.ts:187-196`) | flows lane verified |
| F13 | SAML registers a route-scoped urlencoded parser (`saml.ts:31-36`); `@fastify/formbody` absent from server deps; Fastify core 415s urlencoded; "no global addContentTypeParser" is a static invariant test | flows+blockers lanes verified |
| F14 | Our IdP sender (oidc-provider 9.12.2) accepts ONLY 200/204 from RP backchannel endpoints | `models/client.js:433,462` |
| F15 | `auth.*` events ride the sanctioned fire-and-forget telemetry lane (`auth-events.ts`); DomainEventType union lives in `packages/identity/src/services/events.ts:17` | R1-T3 + conventions Q4c |

---

## 2. Protocol contract

Per OIDC Back-Channel Logout 1.0 (§2.1-§2.8):

- Accepts `POST` `application/x-www-form-urlencoded`, param `logout_token`
  (signed JWT, no CID embedding).
- Validation, in order: signature (issuer JWKS via `jwksUri` config, alg
  allowlist RS256/ES256/PS256 — `none`/HS256 rejected); `iss` exact-match
  (verbatim string compare; NO trailing-slash normalization — an iss that
  differs by slash is a DIFFERENT issuer per OIDC Discovery; config authors
  must write it exactly); `aud` contains our `clientId` for that provider;
  `exp`/`iat` within tolerance (60s skew + max token age 10 min — R8);
  `events` contains member `http://schemas.openid.net/event/backchannel-logout`
  with a JSON-object value (extra members/claims tolerated — R10);
  `nonce` MUST NOT be present (reject); `jti` REQUIRED (BCL §2.4 — reject if
  absent).
- Session targeting: sub and/or sid. Our deviations (documented): `sid`-only
  tokens and `sub: null` tokens (Keycloak client-initiated edge, B6) are
  **valid-protocol tokens we cannot target** — response is 200 no-op with a
  one-time loud warn; we do NOT 400 valid tokens (400 = "logout failed" to the
  sender, invites retry churn). `sub`-resolved unknown user is likewise a 200
  benign no-op (user never logged in here). No enumeration oracle: all
  validation failures share one 400 shape; benign no-ops share 200.
- Response: **200 OK, empty body, `Cache-Control: no-store`** on success and
  benign replay (F14: 205/anything-non-200 breaks our own sender and violates
  BCL §2.8). 400 `{"error": "invalid_request", "error_description": ...}`
  `application/json` on validation failure — spec shape, NOT our envelope
  (documented deviation, conventions addendum per M4).

---

## 3. Design

### 3.1 Surface

```
POST /api/v1/auth/oauth/backchannel-logout
Content-Type: application/x-www-form-urlencoded
Body: logout_token=<JWT>
```

- **No bearer auth** (caller = IdP's S2S agent); does not ride
  `app.authenticate`.
- **Scoped urlencoded parser** (F13 precedent): route-plugin
  `addContentTypeParser` — never global (static invariant test extended to
  cover the new file).
- **Scoped error handler** (F12 precedent): validation failures replied
  directly in spec shape; unexpected throws caught by the route-scoped
  `setErrorHandler` into a generic 500 spec-shape body (no internal detail,
  no global envelope).
- **Rate limit:** route bucket `max: 30/min per IP`. Rationale for the
  ceiling: token signature is the real authentication; the bucket exists to
  absorb noise, and IdP retry storms (worst case) space out. Documented in
  the conventions addendum.
- **Audit:** excluded (token material in body — same posture as ACS/SLO);
  redaction-list entry `logouttoken` added anyway as belt-and-braces.
- Schema guard: `logout_token` param `maxLength: 8192`.

### 3.2 Config surface (new, explicit)

`DynamicProviderConfig` gains two REQUIRED-for-receiver fields:

```
issuer:  string   // exact-match target for logout_token.iss
jwksUri: string   // OUR config value — never derived from the token (M1 SSRF invariant)
```

- Loader (`loadDynamicProviders`) validates both when present; malformed →
  skip-with-warn (existing pattern, F5).
- Issuer map: built per-registry-load as `Map<issuer, provider>`; **duplicate
  issuer across two providers → loader warns and keeps the FIRST, second
  skipped** (loud, deterministic, never silent last-wins).
- Providers WITHOUT `issuer`/`jwksUri` simply do not participate in
  back-channel logout (back-compatible — existing configs unaffected).
- **No new options allowlist keys**: both fields live INSIDE the existing
  `oauth_providers` JSON blob (F5) — the 16-key allowlist (F13-adjacent) is
  untouched.
- **jose dependency:** add `jose@^6.2.10` as a direct `dependency` of
  `@accessbase/server` (runtime code path — not devDep; R12). pnpm resolves
  the same 6.2.10 already in the lockfile.

### 3.3 Session effect (ordering is normative)

All side effects are individually idempotent. Order:

1. **Resolve**: token `sub` → `oauth_accounts` rows
   (`provider = <matched provider name> AND provider_account_id = sub`).
   No rows → 200 benign no-op. `sub` null/absent or sid-only → 200 no-op +
   one-time loud warn (deviation log).
2. **Revoke sessions**: `SessionManager.revokeAllUserSessions(userId)`
   (`managers/SessionManager.ts:265`) for each linked user.
3. **Bearer kill**: replicate the 3-line bump inside `backchannel-logout.ts`
   within the caller tx — `UPDATE users SET token_version = token_version + 1
   WHERE tenant_id = $t AND id = $u RETURNING id` + `redis DEL authst:<userId>`
   (the `delAuthStateKeys` arm). **Chosen over identity-root re-export**
   (B3): no cross-package export/`identity build` ripple, the SQL shape gets
   a real-PG lock test per house rules, and tenantId comes from the same
   users-row join that resolution already needs. Mirrors manager funnel
   behavior exactly (bump + DEL together).
4. **Null token material**: `access_token`/`refresh_token`/`id_token` → NULL
   on the matched `oauth_accounts` rows (same tx as 2-4 — routeTx; id_token
   null-out also auto-removes the link from end_session builders, F2).
   oauth_accounts columns are nullable (F1) — zero schema change.
5. **Emit** `auth.backchannel_logout` via the sanctioned fire-and-forget
   telemetry lane (`auth-events.ts` family, F15) — webhook consumers are
   at-least-once by dispatcher design; duplicate emission under concurrency
   is accepted (I4 pins the observable state, not event count ≥1).

**Failure between steps:** any throw after resolution → DELETE the dedup key
(release claim) → 500 generic spec-shape body. Redelivery then re-processes
from a clean slate. Crash between steps (no handler runs): dedup claimed LAST
means redelivery re-runs idempotent effects — self-healing. This ordering is
the R2 fix: claim-first + crash = silently lost logout.

### 3.4 Replay dedup (revised)

- **Order**: verify → resolve → effects (2-4) → **claim SETNX** → 200.
  Loser of the race: effects already ran (idempotent) → answers 200.
- **Key**: `ab:bclo:<jti>` when jti present (REQUIRED per protocol, so
  effectively always), fallback `ab:bclo:sha256(token-bytes)`. Covers
  re-signed claim-equal redelivery (B4).
- **Failure release**: any effect throw after claim → `DEL` the key before
  answering 500.
- TTL 1h (≥ max token age 10 min + retry windows). Redis-absent fallback:
  in-process Map with SLO's ponytail sweep comment (single-node honest).
- Restart with Redis down: dedup memory lost → redelivery re-runs idempotent
  effects — safe by design, no schema persistence (zero-migration claim
  stands).

### 3.5 Crypto & time parameters

- Algorithms: RS256/ES256/PS256 only; `none`/HS256 → 400 (U9/U10).
- Clock: 60s iat/exp skew; **max token age 10 min** (`now - iat > 600s` →
  400 AUTH_BCLO_003) — makes the 1h dedup TTL derivable (R8).
- `createRemoteJWKSet` with its built-in cooldown; **unknown kid → force
  refetch** (rotation path, I5); JWKS fetch failure → fail-closed 400 (U13).

### 3.6 Error taxonomy (same-commit reality-catalog rows, F11)

| Code | HTTP | Meaning |
|---|---|---|
| `AUTH_BCLO_001` | 400 | missing/malformed/oversized logout_token param |
| `AUTH_BCLO_002` | 400 | signature/iss/aud/events/nonce/jti validation failed |
| `AUTH_BCLO_003` | 400 | expired or beyond max token age |
| — | 200 | benign no-op (unknown sub, sid-only, null-sub) — never an error |

All 400s: identical `{"error":"invalid_request","error_description":...}` —
codes live in LOGS not responses (BCL spec shape overrides our envelope
convention for this IdP-facing machine route; conventions addendum + M4).

### 3.7 What we deliberately do NOT do

- No `sid` persistence this batch (F4): sub-first resolution suffices for the
  realistic IdP set (Keycloak/Okta send sub+sid; Auth0 always sends both; Entra
  has no BCL at all). Revisit trigger: a real IdP that sends sid-only.
- No multi-tenant scoping beyond what resolution yields: a sub maps to link
  rows; each row's user's tenant is joined from `users` for the bump. Same
  IdP sub linked to users in multiple tenants → all linked users get killed
  (matches IdP-logout semantics; rev.1's "impossible" claim corrected).
- No UI. Zero admin-ui delta → e2e untouched (PIT-080 roster unchanged).

---

## 4. Test matrix (RED-first per item)

**Unit (mock jose verify / mock fetch):**
- U1 happy path: valid sub token → 200, sessions revoked, tokenVersion bumped
  + authst DEL, tokens nulled, event emitted.
- U2 byte-identical replay → 200, side effects once (dedup hit).
- U3 nonce present → 400 BCLO_002. U4: events member missing / non-object
  value → 400; extra members tolerated (R10).
- U5 expired / iat-skew / age>10min → 400 BCLO_003.
- U6 unknown sub → 200 benign. U6b: sid-only → 200 no-op + warn.
  U6c: `sub: null` → 200 no-op (B6).
- U7 alg=none → 400 (R7). U8: HS256 → 400 (R7).
- U9 jti missing → 400 BCLO_002 (protocol REQUIRED).
- U10 jwks fetch failure → 400 fail-closed (R7); U11: unknown kid → refetch
  succeeds → 200 (rotation path).
- U12 redaction: logout_token never reaches audit/log rows (B5 belt-and-braces).

**Integration (real PG+Redis, real jose, generated RSA keypair):**
- I1 full loop: seed user+link → sign token → POST (urlencoded parser live) →
  sessions revoked + tokenVersion bumped + authst key gone + tokens NULL.
- I2 replay → one observable effect set.
- I3 Redis-down → in-process dedup, warn line.
- I4 concurrency: 10 parallel POSTs → net state = revoked exactly once
  observable + exactly-one auth.backchannel_logout event (claim-last order).
- I5 key rotation mid-suite: kid-2 forces refetch, still 200 (R7).
- I6 partial-failure release: effect throw → dedup key DEL'd → retry
  reprocesses → converges (R2).

**Live-fire (Keycloak day — NOT this batch's gate):**
- L1 Keycloak: kill IdP session → our RP session dies ≤30s (bearer included).
- L2 self-loop: AccessBase-IdP → AccessBase-RP (scratch two-node recipe) —
  viable because our sender accepts 200/204 (F14) and we now return 200.

---

## 5. Risks & pre-seeded minefields (for implementation review)

- **M1 (jwks fetch):** `jwksUri` comes from OUR config — never from the token
  (the token only SELECTS a provider via iss). Fail-closed on fetch error;
  unknown-kid refetch; cooldown via `createRemoteJWKSet`.
- **M2 (create-only jwks adjacency):** `oidc_clients.jwks` (sender-side) is
  untouched by this spec.
- **M3 (double delivery):** IdP retries are the S2S analog of StrictMode
  double-fire (PIT-086 family) — dedup + idempotent effects + failure-release
  (I2/I4/I6) are the net; never assume single delivery.
- **M4 (response-shape deviation):** spec-shape 400 + no envelope on this
  route — lands in conventions addendum, not just this spec.
- **M5 (bearer kill scope):** bump kills ALL bearer tokens for each linked
  user (≤30s window) — stricter than per-sid targeting, matches IdP-logout
  semantics. sid-persistence backlog = upgrade path.

---

## 6. Tasks (post-approval)

- **T0**: jose direct dep; `DynamicProviderConfig` + `issuer`/`jwksUri` +
  loader validation + issuer-map duplicate policy; redactor `logouttoken`;
  error-catalog rows; DomainEventType extension (`auth.backchannel_logout`)
  + auth-events lane entry.
- **T1**: `apps/server/src/utils/backchannel-logout.ts` — verify pipeline +
  jwks cache + resolution + 3-line bump replication + dedup (claim-last,
  failure-release) (U1-U12).
- **T2**: route mount — scoped parser + scoped setErrorHandler + rate bucket +
  audit exclusion + schema guard + static-invariant extension (no global
  parser) (I1-I6).
- **T3**: docs wave — parent spec §OUT closure, multi-node runbook §7 residue
  update, conventions addendum (response-shape deviation + rate rationale),
  error-codes-reality, CHANGELOG, status.md batch line, vitest baseline flip
  same-commit (F11).

## 7. Gates (definition of done)

vitest unit+integration green (new count flipped in conventions same-commit);
4× tsc 0; eslint 0-new; e2e NOT re-run (zero UI delta — roster sanity check
only, 186+3); reality-catalog + redactor + vocabulary grep gates pass; scratch
state destroyed after integration runs; this spec's §0 non-goals unchanged.
