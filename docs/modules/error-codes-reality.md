# Error Codes — Reality Catalog (generated)

> **Implementation status (2026-09-23 gap audit):** `implemented` — this document catalogs codes as actually emitted by the running code, superseding the identity-sdd §5.2 / admin-sdd §5.2 spec tables (gap-audit A5).

**This file is the single source of truth for wire error codes.** Regenerate with:

```bash
grep -rhoE "code: '[A-Z0-9_]+'" apps/server/src packages/identity/src --include='*.ts' --exclude-dir=__tests__ | sed "s/code: '//;s/'//" | sort -u
# helper-positional emits (authError / err / samlError / scimError take the code as an argument, not as `code:`)
grep -rhoE "(authError|err|samlError|scimError)\([^)]*'[A-Z][A-Z0-9_]+'" apps/server/src --include='*.ts' --exclude-dir=__tests__ | grep -oE "'[A-Z][A-Z0-9_]+'$" | tr -d "'" | sort -u
# checkCaptcha returns CAPTCHA_001 as a bare string; the named-family sweep:
grep -rhoE "AUTH_(WEBAUTHN|LOCKED|IP|SAML|MFA|OAUTH|RESET|REG|MAGIC|SMS|TENANT|PROVIDER|EMAIL)[A-Z0-9_]*" apps/server/src --include='*.ts' --exclude-dir=__tests__ | sort -u
```

When adding a code: update this file in the same commit (conventions D126 gate). Do NOT add rows back to the SDD §5.2 tables — they are frozen historical specs.

## Core AUTH slots (spec §5.2, subset actually in use)

| Code | Meaning in code | Note |
|---|---|---|
| AUTH_001 | missing/invalid bearer | **collision**: spec slot = MISSING_TOKEN; also emitted for "Invalid API key" (app.ts guard) |
| AUTH_002 | invalid credentials (login) | |
| AUTH_003 | invalid/revoked refresh token | **collision**: spec slot = TOKEN_EXPIRED |
| AUTH_004 | account suspended | gate on all 8 issue paths (PIT-052) |
| AUTH_005 | bearer revocation (Q3A: token_version/status stale vs Redis-memoed auth state; refresh rebuilds) | |
| AUTH_007 | insufficient permission (route guard) | |
| AUTH_033 | 403 register: email domain rejected | **live since R1-T9** (`routes/auth.ts` register via `services/domain-policy.ts`; env `AUTH_BLOCKED_DOMAINS` checked first and wins, then `AUTH_ALLOWED_DOMAINS` — empty = allow-all, exact whole-domain match, no subdomain implication) — spec slot said 400 `EMAIL_DOMAIN_BLOCKED`, reality is 403 |
| AUTH_034 | 403 register: '+'-alias local part rejected | **live since R1-T9** (env `AUTH_BLOCK_EMAIL_ALIASES`, default `true`) — spec slot said 400 |
| AUTH_032 / AUTH_035 | spec slots, **no emitter** | format violations surface as VALIDATION_001 (fastify `format: 'email'`); password strength surfaces as AUTH_REG_002 (register) or the WEAK_PASSWORD 409 tag (admin/helpdesk lanes) |
| AUTH_063/064/065 | LDAP bind/rejected/provision errors | batch D |
| AUTH_999 | generic auth failure | **no in-tree emitter** — the LDAP lane echoes whatever provider code it receives (`routes/auth.ts` `result.error?.code ?? 'AUTH_064'`), so AUTH_999 only appears if a provider supplies it; kept as the reserved generic slot |

## Named families (grew ad-hoc beyond the numeric spec — the real taxonomy)

- **MFA**: AUTH_MFA_001..004 (004 = enroll-chain token invalid/expired, Q3E) · **lockout**: AUTH_LOCKED_001 · **IP blacklist**: AUTH_IP_001 · **CIDR admission**: AUTH_IP_002 (403 "Access denied from this network", Q3E `utils/cidr.ts` gate, deny-wins, per-entry fail-open / list-level fail-closed)
- **OAuth RP**: AUTH_OAUTH_001..004 · provider visibility: AUTH_PROVIDER_DISABLED / AUTH_PROVIDER_NOT_FOUND
- **WebAuthn**: AUTH_WEBAUTHN_001..005 · **SAML SP**: AUTH_SAML_001..002 (003 folded into 002 by batch F — no emitter) · **magic link**: AUTH_MAGIC_001 · **SMS OTP**: AUTH_SMS_001
- **register**: AUTH_REG_001..002 · **reset flow**: AUTH_RESET_001..002 · **tenant gate**: AUTH_TENANT_001 · **email verify (Q1-b2)**: AUTH_EMAIL_001 (bad/expired link, 400) / AUTH_EMAIL_002 (SMTP unconfigured, 503) / AUTH_EMAIL_003 (403 "Email address not verified" on the two terminal login arms — password final arm AND `/auth/mfa/verify`; option `auth.require_verified_email`, default off; possession-proven lanes — SMS OTP, magic link, OAuth/SAML/LDAP — are exempt and mark the address verified, R1-T10)
- **captcha (Q3E)**: CAPTCHA_001 (400 missing/wrong/expired answer — returned as a bare string by `utils/captcha.ts` `checkCaptcha`, then echoed as the envelope code by register / forgot-password / magic-link / SMS lanes) / CAPTCHA_002 (503 challenge unavailable — feature off or Redis down, `GET /api/v1/auth/captcha`)

## Generic HTTP-family codes

VALIDATION_001 · NOT_FOUND · CONFLICT · INTERNAL_ERROR · INVALID_CREDENTIALS · OK (success sentinel)
Setup guard: SETUP_REQUIRED · SETUP_IN_PROGRESS · SETUP_ALREADY_COMPLETE · SETUP_STATE_UNAVAILABLE

## Domain-surface codes

- authorization layer: PERM_001 (auth), PERM_002 (admin-only self), PERM_003 (scope)
- options: OPT_001..003 · OIDC clients: CLIENT_001..011, OIDC_001..003 · API keys: APIKEY_001
  - T-PKJ (logout-coherence §3.5, `POST /api/v1/clients`): 400 CLIENT_008 tokenAuthMethod not in [client_secret_basic, client_secret_post, private_key_jwt, none] · 400 CLIENT_009 `none` combined with client_credentials/device_code (provider does not gate it — client_auth.js lets `none` pass) · 400 CLIENT_010 private_key_jwt without usable jwks (missing / empty keys) · 400 CLIENT_011 jwks key carries non-public or missing members (kty-scoped allowlist RSA kty/n/e · EC kty/crv/x/y · OKP kty/crv/x)
- metrics: METRICS_AUTH (403)
- groups (Q4b): GROUP_NOT_FOUND (404), GROUP_NAME_EXISTS (409), GROUP_MEMBER_TENANT_MISMATCH (400), GROUP_ROLE_TENANT_MISMATCH (400); LAST_ADMIN_GUARD 409 on group funnels too (delete/removeMember/setGroupRoles)
- webhooks (Q4c): WEBHOOK_INVALID (400), WEBHOOK_URL_DENIED (400, fail-closed SSRF guard), WEBHOOK_EXISTS (409 pre-check), WEBHOOK_NOT_FOUND (404), WEBHOOK_PING_FAILED (500)
- email templates (Q4c): TEMPLATE_INVALID (400, both write paths share the validator), SMTP_UNAVAILABLE (502 test-send without mailer)
- email templates (Q4c): TEMPLATE_INVALID (400, both write paths share the validator), SMTP_UNAVAILABLE (502 test-send without mailer)
- events history (Q4d): EVENT_NOT_FOUND (404 `GET /api/v1/events/:id`, foreign/absent — no existence leak)
- data-scope (DG-6d): DATA_SCOPE (403 `routes/users.ts`) — per-row/list ceiling from the caller's `role_permissions.data_scope` binding: detail/update/PATCH-status/roles-view+set-roles (embedded in GET /:id and PUT /:id roleIds)/force-logout/reset-password guard on the code's scope (reads=users:read, mutations=users:write, delete=users:delete); create/import/invite require the users:write scope to be 'all' (ruling A3/R3); `DELETE /users/:id` with `eraseAudit:true` additionally requires users:delete scope 'all' even when the binding is dept/self (ruling A6, checked BEFORE routeTx/advisory lock 727242). apikey callers are tenant-wide by design (R2 short-circuit in `utils/data-scope.ts`). Unknown/cross-tenant ids keep 404 (404-first posture). The users surface only (A2 v1).
- groups kind (DG-6d, A5): out-of-enum POST/PUT `kind` is a schema-boundary 400 VALIDATION_001; GROUP_KIND_INVALID is the manager-funnel belt (identity-direct callers only, never a wire code from /api/v1/groups).
- setup wizard (`routes/setup.ts`): ADMIN_EXISTS (400 admin already present, both /admin and /initialize guards), ADMIN_NOT_CREATED (400 /complete before the admin row exists), ADMIN_NOT_FOUND (400 /complete could not load the created admin), ADMIN_CREATION_FAILED (500 wrapped create)
- audit erasure (R-audit 2026-09-28): ERASE_LOCK_BUSY (409, `DELETE /api/v1/users/:id` with `eraseAudit:true` — the erasure transaction could not take advisory lock 727242 because the anchor worker holds it; nothing was written, RETRYABLE). `TENANT_PLATFORM_ONLY` is also the belt code of `GET /api/v1/audit-logs/verify`: anchors are one global chain across tenants, so verification is platform-tenant only
- identity-library only (never reaches the server wire — no route consumes `AuthManager`, login calls `UserManager.verifyPassword` directly): AUTH_ERROR (provider-throw envelope, `managers/AuthManager.ts`)

## 409 conflict tags (manager throws with message prefix → conflict-mapper envelope)

ROLE_PROTECTED · LAST_ADMIN_GUARD · PERMISSION_NOT_BINDABLE · TENANT_PROTECTED (tags) · ROLE_INHERITANCE_CYCLE · direct codes EMAIL_EXISTS · WEAK_PASSWORD · PASSWORD_REUSED · TENANT_PLATFORM_ONLY

## Spec slots never used (kept for reference, do not renumber)

AUTH_020-028, AUTH_030-031, AUTH_036-038, AUTH_040-047, AUTH_050-053, AUTH_060-062, AUTH_070-072; ADMIN_001-025 (except ADMIN_004) — the admin console surface emits generic + domain codes instead.
