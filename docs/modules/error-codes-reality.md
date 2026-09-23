# Error Codes — Reality Catalog (generated)

> **Implementation status (2026-09-23 gap audit):** `implemented` — this document catalogs codes as actually emitted by the running code, superseding the identity-sdd §5.2 / admin-sdd §5.2 spec tables (gap-audit A5).

**This file is the single source of truth for wire error codes.** Regenerate with:

```bash
grep -rhoE "code: '[A-Z0-9_]+'" apps/server/src packages/identity/src --include='*.ts' | sed "s/code: '//;s/'//" | sort -u
grep -rhoE "AUTH_(WEBAUTHN|LOCKED|IP|SAML|MFA|OAUTH|RESET|REG|MAGIC|SMS|TENANT|PROVIDER)[A-Z0-9_]*" apps/server/src --include='*.ts' | sort -u
```

When adding a code: update this file in the same commit (conventions D126 gate). Do NOT add rows back to the SDD §5.2 tables — they are frozen historical specs.

## Core AUTH slots (spec §5.2, subset actually in use)

| Code | Meaning in code | Note |
|---|---|---|
| AUTH_001 | missing/invalid bearer | **collision**: spec slot = MISSING_TOKEN; also emitted for "Invalid API key" (app.ts guard) |
| AUTH_002 | invalid credentials (login) | |
| AUTH_003 | invalid/revoked refresh token | **collision**: spec slot = TOKEN_EXPIRED |
| AUTH_004 | account suspended | gate on all 8 issue paths (PIT-052) |
| AUTH_007 | insufficient permission (route guard) | |
| AUTH_032-035 | password policy family | spec-consistent |
| AUTH_063/064/065 | LDAP bind/rejected/provision errors | batch D |
| AUTH_999 | generic auth failure | |

## Named families (grew ad-hoc beyond the numeric spec — the real taxonomy)

- **MFA**: AUTH_MFA_001..004 · **lockout**: AUTH_LOCKED_001 · **IP blacklist**: AUTH_IP_001
- **OAuth RP**: AUTH_OAUTH_001..004 · provider visibility: AUTH_PROVIDER_DISABLED / AUTH_PROVIDER_NOT_FOUND
- **WebAuthn**: AUTH_WEBAUTHN_001..005 · **SAML SP**: AUTH_SAML_001..003 · **magic link**: AUTH_MAGIC_001 · **SMS OTP**: AUTH_SMS_001
- **register**: AUTH_REG_001..002 · **reset flow**: AUTH_RESET_001..002 · **tenant gate**: AUTH_TENANT_001 · **email verify (Q1-b2)**: AUTH_EMAIL_001 (bad/expired link, 400) / AUTH_EMAIL_002 (SMTP unconfigured, 503)

## Generic HTTP-family codes

VALIDATION_001 · NOT_FOUND · CONFLICT · INTERNAL_ERROR · INVALID_CREDENTIALS · OK (success sentinel)
Setup guard: SETUP_REQUIRED · SETUP_IN_PROGRESS · SETUP_ALREADY_COMPLETE · SETUP_STATE_UNAVAILABLE

## Domain-surface codes

- authorization layer: PERM_001 (auth), PERM_002 (admin-only self), PERM_003 (scope)
- options: OPT_001..003 · OIDC clients: CLIENT_001..007, OIDC_001..003 · API keys: APIKEY_001
- metrics: METRICS_AUTH (403)

## 409 conflict tags (manager throws with message prefix → conflict-mapper envelope)

ROLE_PROTECTED · LAST_ADMIN_GUARD · PERMISSION_NOT_BINDABLE · TENANT_PROTECTED (tags) · ROLE_INHERITANCE_CYCLE · direct codes EMAIL_EXISTS · WEAK_PASSWORD · PASSWORD_REUSED · TENANT_PLATFORM_ONLY

## Spec slots never used (kept for reference, do not renumber)

AUTH_020-028, AUTH_030-031, AUTH_036-038, AUTH_040-047, AUTH_050-053, AUTH_060-062, AUTH_070-072; ADMIN_001-025 (except ADMIN_004) — the admin console surface emits generic + domain codes instead.
