# Q3 IAM Completeness — Design Spec

**Date**: 2026-09-23 · **Driver**: gap-audit §A1 (revocation fiction) §B (market gaps) · **Baseline**: `bfef2ba`
**Split**: Q3a (this spec's implementation now) = real-time revocation + device flow + JWKS multi-key. Q3b (follows immediately, small) = OIDC back-channel logout + RP upstream end_session. Q3c (GATED on user product decision) = enforced MFA UX + captcha flavor choice. SAML SLO + SAML-IdP + token-exchange + FGA explicitly out (SAML-IdP/token-exchange = own proposals if demanded; FGA = Q4).

## Facts verified 2026-09-23 (with file:line)

- Reader exists ONLY in dead code: `packages/identity/src/hooks/authenticate.ts:84` compares tokenVersion — but the hook is never registered (Q1 finding: identityPlugin not in the runtime path). The LIVE `app.authenticate` (app.ts:136-185) validates JWT + claims-status (P0) + apikey — **no DB touch, no token_version check**.
- Writer: zero repo-wide (`grep tokenVersion\\s*\\[+\\]=|token_version =` → 0 hits). Column exists: schema.ts:41 `integer('token_version').default(1).notNull()`.
- Mutation funnels needing bump: RoleManager.update(:205)/delete(:258)/setParent(:297)/assignToUser(:404)/revokeFromUser(:420)/setUserRoles(:451)/create+bind(no users, skip); UserManager.changeStatus(:234)/delete; TenantManager suspend (revokeTenantAccess already bulk-kills sessions+keys — add user bump).
- Device flow: provider features block (oidc/provider.ts:96-101) has NO deviceFlow (lib default off); clients.ts:12 `ALLOWED_GRANT_TYPES={authorization_code,client_credentials}`; adapter ALREADY persists DeviceCode kind (batch N, adapter.ts kind set incl. DeviceCode + findByUserCode implemented).
- JWKS: provider gets single keypair (provider.ts loadJwks); @fastify/jwt single publicKey; our access tokens live 15m (TTL self-heals rotation) — dual-live-key is ONLY needed for RP-cached ID tokens → provider jwks array is the real fix.
- Sessions refresh path is DB-backed (rotate gate) → refresh-revoke already real-time; only bearer access had the 15m window.

## A. Real-time revocation (closes design A1 — the flagship lie)

**Write side (identity)**: new `services/token-version.ts`:
`bumpTokenVersions(db, tenantId, {userIds?|roleIds?})` → `UPDATE users SET token_version = token_version + 1 WHERE <in-role|in-list>` + after-commit cache invalidation via the EXISTING publish hook channel (new kind `authst:{userId}` — see read side; invalidation reuses `setPermissionCachePublishHook` plumbing? NO — separate small hook `setAuthStateInvalidateHook` on the same leaf pattern to keep concerns clean).
Called from: the 7 funnels above (post-write, in the same DbLike when threaded).

**Read side (apps/server app.authenticate decorator)**: after jwtVerify, cheap freshness check:
1. read `authst:{sub}` from Redis (cached `{tokenVersion,status}`, TTL 30s, one GET — Redis already per-process client);
2. on miss: `SELECT token_version,status FROM users WHERE id=$1` (indexed PK) + SETEX 30s;
3. mismatch vs claims (tokenVersion OR status) → 401 `AUTH_005` (new code → error-codes-reality.md same commit, D126 rule) — frontend refresh-single-flight (already exists on 401) rebuilds silently;
4. Redis AND DB error → **fail-OPEN to the claim-only P0 check as today** (metrics degraded gauge already covers; document the window).
Cost: +1 Redis GET per authed request (amortized), 1 PG PK lookup per user per 30s. Contract: **revocation ≤30s across nodes** (pub/sub invalidation kills the 30s on role-change directly: bump publishes → every node drops the key → next request DB-fresh).
Design docs: security.md/identity-sdd status note updated to ≤30s (not 'immediate') — honest number.

**Tests**: unit — writer SQL shape via PgDialect lock; funnel spies assert bump called; decorator — redis-stub hit/miss/mismatch/fail-open matrix (trust-proxy-{on,off} file-split pattern per PIT-078); integration real-PG — role update bumps members, not others; AUTH_005 e2e lock in auth spec (mock /auth/me returns stale → auto refresh once).

## B. Device Authorization Grant (RFC 8628) — provider

- provider.ts features: `deviceFlow: { enabled: true, forgiveness: 15s? defaults fine }`; clients.ts allowlist add `urn:ietf:params:oauth:grant-type:device_code` (+ client.response_types unchanged).
- interactions: `deviceRoute: '/oidc/device'` (provider renders our page via interaction for prompt=device); frontend `pages/DeviceVerify.tsx` at `/oidc/device` — reuse consent page skeleton: requires login (redirect to /login?redirect= back), shows user_code entry + client name + approve/deny (interactionProvider consents). Adapter already persists DeviceCode.
- discovery auto-publishes device_authorization_endpoint; e2e: full happy path mocked + unit: provider opts include deviceFlow (oidc-provider-mount.test pattern), clients POST accepts new grant, rejects unknown.

## C. JWKS multi-key (RP-facing rotation)

- config: `JWT_JWKS_EXTRA_PUBLIC_KEY_PATHS` (comma list; dev/test none) → provider.ts assembles jwks.keys = [primary pair, extras...]; oidc-provider picks first private for signing, publishes all public (kid rotation = ops runbook paragraph in docs/modules/security.md rotation section + `.env.example`).
- OUR access tokens: keep single key + 15m TTL self-heal — state in the runbook why no dual-verify needed (and that refresh is DB-backed). @fastify/jwt untouched.

## D. Q3b — back-channel logout (small, same batch if green)

- provider features `backchannelLogout: { enabled: true }` requires sessions tracked with `sid` — Session kind already persisted (batch N); RP-initiated logout already on. Test: oidc-flow integration — after end_session, provider enqueues logout token delivery to registered client (mock fetch capture) — if oidc-provider 9.12 needs `features.rpInitiatedLogout.postLogoutRedirectUri` validation we already persist uris.
- RP side (our upstream logins): on /auth/logout, for providers with stored `end_session_endpoint` (add column to oauth_accounts? NO — store in metadata jsonb — zero migration) issue best-effort GET end_session?id_token_hint=… (fire-and-forget, 2s timeout). id_token currently NOT stored (only profile) — storing it = credential at rest: **skip id_token_hint**, call end_session without hint (spec-legal) — document.
- If Momus judges sid/backchannel half-plumbed in v9 defaults, we ship provider-side enable + test and keep RP-side as Q3d.

## E. Q3c — GATED (needs user's call, asked separately)

1. Enforced MFA: `mfa_enforcement=off|admins|all` options; login with policy-miss returns `{mfaRequired:true, flowToken(purpose=mfa_enroll)}` + NEW frontend enroll wizard. Alternative: hard 403 (bricks self-host) — recommend wizard path. A/B ask.
2. Captcha on register/forgot/magic/sms/request: local svg-captcha (dep svg-captcha, self-hosted-safe) vs Turnstile (external, blocked in CN?) vs none+stricter rate — ask.
3. CIDR allow/denylist guard on auth surface (options `auth_cidr_allow`/`auth_cidr_deny`, node:net hand-rolled v4+v6 match, no deps) — non-controversial, may ride Q3a if user says go.

## Order & gates

A → B → C → D; gates after each: RED-first units, vitest full, 4×tsc, eslint touched, e2e run once at batch end (A/B touch UI), live battery: role-revoke → bearer rejected ≤30s on the running server while old code returns 200 (before/after capture); device flow curl E2E against dev server (client_credentials of a device client → device_authorization → user_code page approve via playwright → token). Memory close + reality catalog + status headers of security.md/identity-sdd notes.
