# P-fix Wave 1: Auth-Core Remediation (Design Spec)

**Date**: 2026-09-23
**Status**: rev.1 (pending dual-Momus)
**Driver**: Batch P security research (docs/superpowers/reports/2026-09-23-batch-p-security-research.md) — verdict BLOCK. Wave 1 = the auth-core cluster. Every line below was re-verified against HEAD `7170fde` by the controller — **including the audit report's own claims, three of which did not survive that re-verification and are corrected here**.

## 1. Audit Errata (lead verification 2026-09-23 — PIT-076 applied to the audit itself)

The report's Wave-1 items were checked code-first before fixing. Outcomes:

| Report claim | Verdict after code read | True shape |
|---|---|---|
| F1 "unauth account→admin takeover via forgot-password flow_token + mfa/setup userId trust (mfa.ts:372-403, emailVerified self-asserted)" | **FALSIFIED as described.** `apps/server/src/routes/mfa.ts` does not exist; `/mfa/setup` (auth.ts:1185-1210) has `preHandler:[app.authenticate]` and takes userId from the JWT's own `payload.sub` — no body trust, no emailVerified claim anywhere. forgot-password never returns the token to the caller (auth.ts:700-731: mail-or-log only). PoC's "takeover" ran on a server the PoC author owned — the token came from reading that server's own log (dev-branch full-token logging, auth.ts:723-728). | Residual REAL issues: (a) dev-branch logs FULL reset token and **NODE_ENV defaults to development** (config.ts:66) while the single-container production path never sets it (Dockerfile has no ENV NODE_ENV, docker/entrypoint.sh doesn't export it; only compose.prod sets it, docker-compose.prod.yml:9 — and that path F9-crash-loops anyway) → prod container = dev mode: full tokens in logs, HMAC-JWT/ADMIN/CORS fail-fast gates inert; (b) flow tokens/passwords in audit (→F3). |
| F7 "refresh replay NOT detected; reuse-detecting rotate is dead code" | **FALSIFIED as described.** SessionManager.rotateRefreshToken (called by the route, auth.ts:refresh handler) DOES implement reuse detection: usedAt → revoke-all + throw (SessionManager.ts:163-171). | REAL sibling defect: the usedAt check-then-UPDATE is non-atomic (SELECT :150-155 → UPDATE :174-177 across awaits) → CONCURRENT refresh with one token double-rotates (both see usedAt=null). The PoC's "3 successive replays passed" was in fact concurrent firing. Same race family as F4. |
| F8 "password change/reset succeeds without revoking sessions" | **FALSIFIED.** change-password revokes (auth.ts:648 `revokeAllUserSessions` + reissues), reset revokes (auth.ts:1164), and auth.ts:470. Surviving access token ≤15min is the documented stateless-JWT design (auth.ts:649 comment), not a bug. | Nothing. Killed. (Report to carry this correction.) |
| F4 "magic consume check-then-mark race in routes/magic-link.ts:172-229" | Phantom file:line again, mechanism misattributed — BUT the race is REAL at a different layer: FlowTokenService.consume = redis `GET` then `DEL` (two round-trips, SessionFlow services/FlowTokenService.ts consume body); between them a concurrent consume of the same token also gets the record. All 8 channels share this service (password_reset, mfa_verify, magic_login, oauth/saml exchange, sms OTP). Live repro 5-7/13 stands. | Redis GET→DEL gap (memory-mode path is sync and safe). |
| F3 redactor gaps | CONFIRMED: types.ts:149 exact-key list `['password','token','secret','api_key','credit_card','plaintext','accesstoken','refreshtoken']`; sanitizer lowercases keys before compare (logger.ts:212-213) → normalized misses: `oldpassword`, `newpassword` (change-password/reset bodies auth.ts:622,1130s), `flowtoken` (mfa/verify + oauth/saml exchange bodies). OTP `code` key would also leak but `code` collides with the error-envelope `code` field on response bodies — needs request-side-only treatment. | Fix both halves. |
| F2 key file mode | CONFIRMED: scripts/generate-keys.mjs:27-28 `writeFileSync(privatePath, privateKey)` no mode → umask 022 ⇒ 0644 world-readable. | One-line fix. |
| F5 trustProxy unwired | CONFIRMED: config.ts:33/98 defines TRUST_PROXY, sole consumer is magic-origin (auth.ts:769); Fastify built at app.ts without trustProxy → request.ip = socket peer for rate-limit keyGenerator + audit ip + LockoutService IP blacklist. Operators setting TRUST_PROXY=true get silently nothing. | Wire into app construction. |

**New finding surfaced by this verification (N1, belongs in Wave 1 severity)**: production single-container runs with NODE_ENV unset ⇒ 'development' default ⇒ (i) full reset/flow tokens to stdout logs, (ii) batch-L's JWT-secret/ADMIN/CORS production pre-flights never arm. compose-prod sets NODE_ENV but crashes first boot (F9). Net: NO shipped container path today runs the hardened configuration. Fix in this wave = safe defaults, not deployment advice.

## 2. Scope — six fixes, RED-first each

| # | Fix | Files | RED test |
|---|-----|-------|----------|
| W1-1 | F2: private key 0600 + keys dir 0700 (`writeFileSync(..., {mode})` + `mkdirSync(...,{mode:0o700})`; chmod existing on re-run for idempotent upgrade) | scripts/generate-keys.mjs | vitest: run generator into tmpdir, `statSync(private).mode & 0o077 === 0` |
| W1-2 | F3: shared redact list += `oldpassword`,`newpassword`,`flowtoken`; request-side-only += `code` (redactFields gains an extras param; response side untouched) | packages/audit/src/{types.ts,logger.ts} | vitest unit: camelCase bodies (oldPassword/flowToken/code) redacted on request, error-envelope `code` on response NOT redacted |
| W1-3 | F4: consume via **GETDEL** (ioredis `getdel`), one round-trip atomic burn; on GETDEL-unsupported error, fall back to get+del with a WARN (both servers here are ≥6.2/valkey8) | packages/identity/src/services/FlowTokenService.ts | vitest integration vs live native redis (skipIf down, H′ convention): 10 concurrent consumes of one token → exactly 1 winner |
| W1-4 | F7': rotate atomic mark: `UPDATE sessions SET used_at=now() WHERE id=$1 AND used_at IS NULL AND revoked_at IS NULL RETURNING id` → 0 rows = replay/expired path (then revoke-all on usedAt-reuse as today, detected via a second read only on the failing branch); concurrent double-rotate eliminated | packages/identity/src/managers/SessionManager.ts | real-PG integration: two concurrent rotateRefreshToken with same token → exactly one succeeds, sibling rows intact, serial replay still burns family |
| W1-5 | F5: pass `trustProxy: config.trustProxy` to Fastify build (app.ts builder; default false preserved — TRUST_PROXY stays opt-in) | apps/server/src/app.ts (+ fastify ctor option) | route-level unit: boot with trustProxy true, XFF-rotating requests → request.ip varies; false → collapses to socket (documents current-as-opt-in) |
| W1-6 | N1: token-log hardening — reset/magic/OTP logs **never** emit full token (8-char prefix everywhere, drop the dev branch); Dockerfile adds `ENV NODE_ENV=production` in runtime stage; warnDegradedChecks gains a "NODE_ENV not production" line (non-fatal, per K-T4 no-brick rule) | apps/server/src/routes/auth.ts (:723-728 + magic twin), Dockerfile, apps/server/src/config.ts (warn list) | vitest: with NODE_ENV=development, capture pino-transport spy on forgot-password → log line contains prefix + ellipsis, not full 64-hex; docker line = read-verify static assert (no docker here: NOT VERIFIED marker) |

Out of scope (queued): F6 /oidc limiter boundary, F9 compose.prod boot design, F10 migrate.sh argv, F11 trust-PG defaults, F12 remainder, F13-F15 sweep — Waves 2-3 per report.

## 3. Constraints
- Chain untouched (no schema/migration changes; usedAt semantics unchanged — column already exists, this is query atomicity only).
- FlowTokenService public contract identical (issue/consume signatures).
- burn-first + purpose-mismatch "already burned" note (J-batch discipline) preserved in comments.
- PIT-052 eight-issuer matrix: W1-3/W1-4 must not change any issuance site; consume-side only.
- warnDegradedChecks stays pure/env-only (H′ convention) — N1's warn line reads env only.
- Gates after all six: double tsc + identity rebuild (dist-sync), full vitest (931 baseline + new), eslint touched files, e2e 138+3, then PoC replay: rerun the original F2/F3/F4/F7 attacks + a NODE_ENV-unset container sim (node binary with env stripped) → all must now fail safe.

## 4. Execution shape
Strictly sequential single track (one file cluster, overlapping tests) — controller-direct, per H-T4c/L′/O precedent. Commits per fix (W1-1..6) so a bisect pinpoints any regression. Report errata section (F1/F7/F8 corrections + N1 addition) appended to the batch-P report file in the closeout commit, plus status/PIT/D notes per lesson-memory rules (incl. the audit-grade lesson: **PoC reports are claims too — file:line citations must be grep-verified before anyone schedules a fix from them**; both PoC engineers cited phantom paths for F1/F4/F8 in the same run).
