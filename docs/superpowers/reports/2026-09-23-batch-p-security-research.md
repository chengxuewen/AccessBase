# Security Research Report — Batch P (team mode, 2026-09-23)

## Verdict: **BLOCK**

Two CRITICAL findings with live-server proof sit in the authentication core. The repo must not claim security-verified status until the P-fix batch lands. Team: surface-hunter + auth-data-hunter + runtime-supply-hunter + poc-engineer-a/b (run e6daecf6), 14 candidates dispatched, all reproduced/falsified with evidence.

## Scope
- Target: AccessBase IAM monorepo @ HEAD 0fba203 (post batches A–O); live-server proof on scratch DBs (`accessbase_poc_*`, ports 5101/5102, loopback SMTP sink 2525 — zero outbound mail; dev DB untouched; all scratch dropped).
- Excluded: `.refinfo/` (reference material), docs prose.
- Method: 3-lane hunting (surface map / auth-cross-batch combos / runtime-supply-config) → dual independent PoC (reproduce-or-falsify) → 5-way cross-check.

## Findings (surviving, PoC-grade)

| # | Sev | Title | CWE | Exploitability | Fix |
|---|-----|-------|-----|----------------|-----|
| F1 | CRITICAL | Unauthenticated account→admin takeover via forgot-password flow_token + TOTP self-enroll | CWE-287/639 | Remote, no creds (needs valid email; mailer-unconfigured widens window) | Bind issued flow_token to the request that created it; verify possession at mfa/setup |
| F2 | CRITICAL | JWT RSA private key world-readable (generate-keys.mjs no mode) → forge admin tokens | CWE-732 | Local user/process; full remote-equivalent bypass | `mode: 0o600` + dir 0o700; re-issue keys guidance |
| F3 | HIGH | Plaintext `oldPassword`/`newPassword` + `flowToken` persisted in audit_logs.requestBody | CWE-312/532 | Anyone with audit:read; backups hold it too (batch M: dump = crown jewels) | Redactor key-set += oldpassword/newpassword/flowtoken (+ case-fold); audit MFA verify route |
| F4 | MED-HIGH | Magic-link consume check-then-mark race: 5–7 of 13 parallel consumes issued sessions | CWE-367 | Needs victim click + ~1 parallel hit | Atomic `UPDATE … WHERE used_at IS NULL RETURNING id` |
| F5 | MED-HIGH | All IP-keyed defenses collapse + lockout bucket shared: Fastify built without `trustProxy` although config.TRUST_PROXY exists AND defaults true on every deploy path | CWE-291/613 | Proxy-fronted prod: unlimited stealth brute + per-IP blacklist useless | Wire `trustProxy: config.trustProxy`; keep XFF gate; document |
| F6 | MED | /oidc/* entirely exempt from rate limiting (onRequest handoff bypasses limiter) | CWE-770 | Anonymous, unbounded hit on protocol endpoints | Limit interaction/auth entry or document exemption boundary |
| F7 | MED | Refresh-token replay NOT detected: route uses legacy rotateRefreshToken; reuse-detecting `UserManager.rotate` is dead code; stolen refresh survives 3 successive replays | CWE-613 | Requires token theft (logs/backups carry plaintext today — F3) | Switch route to rotate(); add revoked-lookup; reuse → family revoke |
| F8 | MED | change-password / password-reset succeed without revoking existing sessions (user.ts:263-266 comment claims the opposite) | CWE-613 | Stolen-credential persistence after "fix" | Call revokeAllForUser on both success paths |
| F9 | HIGH(ops) | compose.prod first boot crash-loops + RSA keys + fully-migrated DB baked into image at BUILD time (volumes mask both at runtime) | CWE-552/docker misdesign | Every fresh prod compose deploy: outage + shared baked key | entrypoint idempotent init; keys to runtime; gitignore out/ |
| F10 | MED | migrate.sh passes DATABASE_URL as psql argv at every container/deploy boot (backup.sh:10 documents the exact anti-pattern) | CWE-214 | Same-host process table | PG* env form (mirror backup.sh) |
| F11 | MED | Dev/compose PG: `--auth=trust` + `listen_addresses='*'` + published 5432 (+ base compose default creds) — any added -p/--network host = instant superuser | CWE-306 | env-dependent | scram defaults; publish only when explicitly opted |
| F12 | LOW-MED | Silent HMAC JWT fallback when only one RS256 key path set (config.ts:64-65 unvalidated pair); NODE_ENV exact-match 'production' trap ('prod' typo = dev secrets); warnDegradedChecks misses the pair case | CWE-757 | misconfig trap | validate pair; normalize NODE_ENV compare |
| F13 | LOW | options writes: no key whitelist (any admin-writable arbitrary keys; only platform-only gates save it — verified all security keys platform-gated); site.url unvalidated → magic-link retarget (platform-admin-only, phishing assist) | CWE-1021 | defense-in-depth | whitelist known keys + origin-parse site.url |
| F14 | LOW | TenantManager.update/delete carry no session/key revocation — today harmless (route-layer revoke exists at tenants.ts:229,236), but violates the K-batch "guards live in the manager funnel" convention; a future SCIM-style direct caller re-opens C-A2 | CWE-1188 | latent | move revoke into manager |
| F15 | LOW | /docs + OpenAPI unauthenticated in prod (setup-guard allows /docs prefix); ADMIN_PASSWORD in curl argv (accessbase.sh:166, deploy start.sh:150); backup.sh symlink check-after-mkdir + find\|awk retention word-splitting; restore checksum-after-restore; dockerfile `--no-frozen-lockfile` + floating base tags; .dockerignore `.env` root-only | misc | hygiene | per-line fixes, one sweep |

## Falsified (kill list — do not re-litigate)
- C-A1 tenant priv-esc chain (partition funnel holds live; `roles:write` IS tenant-bindable — hunter static claim wrong)
- C-A2 tenant suspend/delete session+key survival (route-layer revoke + PERM_005 second layer; see F14 for the latent variant)
- C-A3 SAML ReplacingAuthnSession replay (pure 302 interaction chain in our config)
- C-M1 metrics env>file precedence (intended, WARNed)
- Audit CSV export cross-tenant (properly scoped, audit.ts:109,150)
- auth.local.enabled / login.page_orientation impacts (phantom keys, zero consumers — repo-wide grep + live agree)
- forgot-password link uses site.url (FRONTEND_ORIGIN at auth.ts:712 — discriminator proven)
- /init as practical hole (needs SQL-side mutation; → LOW self-lockout note)
- magic-link forgot-password cross-link (dead claims)

## Residual risk (not tested)
- Real SSO IdP behavior (SAML/OIDC federation) — protocol shapes only; first IdP integration day should re-run consent/replay paths.
- SMTP/SMS external delivery semantics (loopback sink only).
- Docker runtime behavior (no daemon here — F9/F11 static reasoning only).
- Multi-instance option-cache skew (documented in OptionsManager; not load-tested).
- e2e-mock divergence class (PIT seams) — PoC on real PG avoided mocks by construction.

## Remediation shape (proposed P-fix batch)
- Wave 1 (auth core): F1 (token binding + mfa/setup possession), F3 (redactor set + tests), F8 (revoke on password change), F7 (wire rotate reuse-detect).
- Wave 2 (platform/runtime): F2 (key mode + docs), F4 (atomic consume), F5 (trustProxy wiring + env defaults), F6 (oidc limit boundary), F10 (migrate.sh PG* env).
- Wave 3 (ops hardening): F9 (entrypoint init + key runtime + .gitignore out/), F11 (scram defaults), F12–F15 sweep.
- Each with RED-first regression on the live server (the PoC scripts at /tmp/opencode/poc-{a,b}/ are the seed fixtures), then full-suite + e2e gates.
- Doc honesty: status.md "Auth ✅ … refresh 重用检测" claim is currently FALSE for the route path (F7) — reword until Wave 1/2 land.
