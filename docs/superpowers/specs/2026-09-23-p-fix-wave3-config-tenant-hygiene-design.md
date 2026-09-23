# P-fix Wave 3: Config Hardening, Tenant Revocation, Hygiene Sweep (Design Spec)

**Date**: 2026-09-23
**Status**: rev.1 (pending dual-Momus)
**Driver**: Batch P report Wave-3 queue (F12 remainder, F13, F14, F15). Fact-verified per discipline — which caught that **Wave 1's own kill list mis-killed C-A2** (§1.3).

## 1. Corrections this wave must carry

### 1.1 F13's evidence was phantom too
Report cites `constants/options-registry.ts:21-34 registerOptionsKey, isPlatformOnly` — **the file and symbols do not exist** (repo-wide find/grep empty). Real shape: apps/server/src/routes/options.ts:18-20 (`SENSITIVE_KEY_PATTERN`, `KEY_FORMAT=/^[a-z][a-zA-Z0-9_.-]{1,63}$/`) — upsert validates FORMAT only, writes ANY key. The finding's substance (no whitelist) stands; the citation is corrected.

### 1.2 F12 remainder facts
- config.ts:65-66 + app.ts fastifyJwt: RS256 engages only when BOTH key paths set; one-path misconfig silently falls back to HMAC (prod JWT_SECRET fail-fast makes the fallback *possible and quiet*). `requireJwtSecret`/`requireCorsOrigins` (:45/:54) compare `env['NODE_ENV'] === 'production'` exactly — 'Prod'/'prod' typos disarm every prod gate; config.nodeEnv (:68) has the same exact-match default-'development' behavior (W1-6 added the *unset* warn line; typo values remain silent).
- Dockerfile builder/runtime stages run `pnpm install --no-frozen-lockfile` (drift risk, F15d); `.dockerignore` `.env*` is root-anchored (F15f); `EXPOSE`/tags: node:22-slim pinning deferred (can't verify upstream tag from this box; churn risk > value — documented residual).

### 1.3 F14 is OPEN — Wave 1's REFUTED verdict was built on phantoms (re-verified)
Wave-1 killed C-A2 citing "route-layer revoke at tenants.ts:229,236" and "PERM_005 second layer". Both phantom: `grep -n revoke apps/server/src/routes/tenants.ts` → nothing; `grep -rn PERM_005 apps packages` → nothing. Code truth: `TenantManager.delete()` = `update(id, {status:'suspended'})` (TenantManager.ts delete body) — zero revocation, zero cascade (api_keys.tenant_id is a plain uuid, no FK); `assertTenantActive` guards only LOGIN (auth.ts:124) and REFRESH (:569); authenticate's apikey branch (app.ts:143-157) never consults tenant status; JWT residual ≤15min is the accepted stateless design (same class as user-suspend). So: **suspend/delete tenant → its api-keys stay valid indefinitely; live sessions keep full access until token expiry**. engineer-a's original "HTTP 200 after tenant delete" was right; engineer-b's contradictory REFUTED (with fabricated mechanisms) was adopted in Wave-1's errata — this spec re-corrects the record (report F14 row + Wave-1 kill list get errata in close-out). PIT-076 third installment: even *falsification* evidence needs file:line that exists.

### 1.4 F15 items verified
- /docs: swagger `routePrefix: '/docs'` (app.ts:97) + setup-guard ALLOWED_PATHS '/docs' (setup-guard.ts:18) + SPA passthrough :372 — unauthenticated prod API map.
- Bootstrap argv: accessbase.sh:166-168 + scripts/deploy/start.sh:150-152 interpolate `$ADMIN_PASSWORD` into `curl -d "…"` (ps leak + JSON break/injection on quotes).
- backup.sh:60 retention: `find -printf '%T@ %p\n' | sort -rn | awk '{print $2}'` → word-split loss on spaces (F15e); symlink-out dir check runs AFTER mkdir+chmod 700 (:31-33, F15g).
- restore.sh: checksum verified at :79-82 AFTER pg_restore :73 (warn-only post-hoc, F15h).

## 2. Scope — four sequential fixes (one commit each)

### W3-1 F12: config self-defense
(a) `requireKeyPair(env)`: exactly one of JWT_PRIVATE_KEY_PATH/JWT_PUBLIC_KEY_PATH set → **throw** at config eval in ALL envs (half-config is a bug, not a missing optional — K-T4 no-fail-fast preserved: both-unset still fine). (b) `resolveNodeEnv(env)`: lowercase+trim; must match development|production|test else throw (unknown NODE_ENV is never silently dev); config.nodeEnv, the two prod gates, logLevel all read it. RED: config.test.ts cases (pair-half throws, 'Production' string normalizes to prod gates, 'stagging' throws, test/dev pass).

### W3-2 F13: options whitelist + value validation
Known-key allowlist in routes/options.ts (single source there; no new registry file): {site.name, site.url, smtp_host, smtp_port, smtp_user, smtp_password, smtp_from, sms_provider, sms_sign_name, sms_template_code, oauth_providers} ∪ pattern `/^oauth_[a-z0-9][a-z0-9_-]{0,40}_client_secret$/`. POST/PUT upsert: unknown key → 400 VALIDATION_001 `Unknown option key` (message lists none — key enumeration oracle is what platformBelt worries about; keep it generic). site.url + site.name… url-only value rule: `new URL(value)` parses with http(s) protocol AND pathname '/' or '' (origin-only; kills path-hanging phishing tails); invalid → 400. Sensitive-prefix writes keep existing mask-refusal. RED: options route tests (unknown key 400; oauth_x_client_secret 200; site.url 'https://a/b' 400, 'https://ok.example' 200; smtp_port passthrough).

### W3-3 F14: tenant-access revocation in the manager funnel
`TenantManager`: constructor already has db; add `private async revokeTenantAccess(tenantId)`: `UPDATE sessions SET revoked_at=now() WHERE user_id IN (SELECT id FROM users WHERE tenant_id=$1)` + `UPDATE api_keys SET revoked_at=now(), updated_at=now() WHERE tenant_id=$1 AND revoked_at IS NULL` (drizzle-orm equivalents via schema tables; raw SQL only if cleaner). Call from `update()` when patch.status transitions to 'suspended' (delete() delegates ✓) after the row update succeeds; DEFAULT tenant can never suspend (existing guard) so platform is safe. Cache notes: permission-cache 30s TTL + JWT ≤15min documented as accepted residual (matches user-suspend class; refresh/login already hard-gated). RED: real-PG integration (extend tenant suites): provision tenant+user+session+api-key → suspend via manager → key 401 path at authenticate (revokedAt set), session row revoked, users of OTHER tenants untouched; default-tenant reject path unchanged.

### W3-4 F15 hygiene sweep (one commit)
1. app.ts: skip swagger+swagger-ui registration when `config.nodeEnv === 'production'` (docs becomes 404; setup-guard '/docs' entry harmless, note comment); admin bootstrap JSON: both scripts switch to `--data @- <<EOF` stdin (kills argv leak + quoting class), + static lock (ops tests: no `-d "{\"name\"…ADMIN_PASSWORD` pattern in either script; grep shape `curl.*-d.*ADMIN_PASSWORD` → 0).
3. backup.sh retention null-safety: `-printf '%T@\t%p\0' | sort -zrn -k1,1 --tab-separator`… finalize as: `find … -printf '%T@\t%p\0' | sort -z -t $'\t' -k1,1nr | cut -z -f2- | … head -z` style pipeline (GNU tools present — probe in place); move symlink check BEFORE mkdir/chmod.
4. restore.sh: verify `${FILE}.sha256` (when present) BEFORE pg_restore and ABORT on mismatch (restoring an unverified dump is the hazard); delete the dead /dev/tcp probe line (result discarded).
5. Dockerfile: drop `--no-frozen-lockfile` both stages (repo always commits lockfile — constraints.md guarantees sync; drift = build error, which is the POINT).
6. .dockerignore: `.env` block → `**/.env` patterns.
RED: static locks (nodeEnv-gate grep, curl-argv grep, symlink-check order, checksum-before-restore order, frozen-lockfile absence) + bash -n; one functional backup-retention probe (temp dir, spaced filename, KEEP=2 → oldest deleted, newest survives — runs the SAME expression via sourced helper if extractable, else end-to-end backup.sh against scratch DB).

## 3. Constraints
- TenantManager public signatures unchanged; no SCIM/route changes (funnel = manager, K-T2 doctrine).
- options:write remains platform-only (partition untouched) — W3-2 is input validation, not authorization change.
- Node-22 image tag pinning explicitly NOT done (unverifiable here) — recorded residual in report.
- Gates: triple tsc, full vitest (958 + new), eslint 0-new (per-file baseline compare), e2e 138+3, real-PG trio green.
- Close-out: report Wave-3 record + **F14/F13/Wave-1-kill-list errata** + conventions (allowlist maintenance rule: new option keys MUST be added to the options.ts list — check `grep -c` on the set) + status line.

## 4. Execution
Sequential W3-1→4 (config→options→tenant→sweep), controller-direct, RED-first each. Then final verdict update: BLOCK → **PASS WITH FINDINGS** iff all four land + docker-dependent items remain explicitly NOT VERIFIED pending integration day.
