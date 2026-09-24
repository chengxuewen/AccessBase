# Q3E Policy Trio — enforced MFA enrollment, local captcha, CIDR guards

**Driver**: gap-audit §B policy engine + user approvals (enroll-wizard / svg-captcha / CIDR now). **Baseline**: `e6f2f28`
**Facts**: mfa/setup + mfa/enable are bearer-only (auth.ts:1382/:1408 — `preHandler:[app.authenticate]`, payload.sub); mfa/verify consumes purpose 'mfa_verify' (bound-TOTP step-up); login arms returning `{mfaRequired, flowToken}` exist at the PIT-052 sites (password :275ish, oauth/saml/webauthn/sms/magic-verify). KNOWN_OPTION_KEYS options.ts:26 (16+password_*5). No captcha dep exists.

## E2 CIDR (pure, first)
- `apps/server/src/utils/cidr.ts`: `ipInCidr(ip, cidr)` v4 full bit-mask + v6 nibble-prefix + bare-IP equality; malformed entries fail-open per-entry with one warn (garbage must not lock everyone out).
- options `auth_cidr_allow` / `auth_cidr_deny` (comma lists; empty=disabled; deny wins) via OptionsManager env>option (env AUTH_CIDR_ALLOW/DENY).
- `checkAuthCidr(request): 'ok'|'blocked'` called at login/register/forgot/magic-request/sms-request entry (NOT consume paths — post-email IPs shift, documented). 403 `AUTH_IP_002`.
- allowlist: +2 keys.

## E1 captcha (svg-captcha, register/forgot/magic/sms-request)
- dep svg-captcha (apps/server). `GET /auth/captcha` (public, rate 20/min): id=random12, text=lowercased answer → Redis `captcha:{id}` EX 300 (no Redis → endpoint 503 CAPTCHA_002 AND `GET /auth/captcha/status` reports enabled=false → UI hides widget); returns {id, svg}.
- verify helper: GETDEL one-time + case-insensitive; wired BEFORE the existing enumeration-safe arms in the four endpoints, options key `captcha_enabled` (env CAPTCHA_ENABLED truthy + key set + Redis available; else skipped). 400 `CAPTCHA_001` bad/expired.
- allowlist: +1 key. Frontend: shared `<CaptchaField>` component (fetch status+image, click-to-refresh, emits {captchaId, captchaAnswer}) mounted in Login magic form, Register, ForgotPassword, SMS phone step.
- login itself: NO captcha (lockout already covers; recorded decision).

## E3 enforced MFA (flow-token enrollment chain)
- options `mfa_enforcement` = off|admins|all (admins ⇒ subject holds ≥1 isSystem role via roleManager.getUserRoles effective isSystem flag — reuse existing per-user role fetch, no N+1 worry at login frequency).
- Shared arm helper `enrollArm(request, user)`: when policy hits && !user.totpEnabled → issue `mfa_enroll` flow token (300s) → return `{ success:true, data:{ mfaRequired:true, enroll:true, flowToken } }` (NO session). Applied at ALL login-completion sites before the existing totpEnabled branch (password + oauth exchange + saml + webauthn + sms verify + magic consume = PIT-052 matrix stays uniform).
- mfa/setup + mfa/enable gain OPTIONAL `flowToken` body field: present ⇒ skip bearer, consume purpose 'mfa_enroll': setup issues fresh mfa_enroll (chain) + returns {result..., flowToken}; enable on success issues the real session (issueTokenPair with freshly loaded user) and returns token pair. Bearer-only legacy behavior unchanged when flowToken absent (existing e2e/panel keep working).
- Frontend: Login.tsx (single helper call site for oauth/saml arms) + webauthn/sms/magic consumers: `if (data.enroll) sessionStorage 'mfaEnrollToken' + navigate('/enroll-mfa')` (same cross-redirect pattern as mfaFlowToken J14). New page EnrollMfa.tsx: step1 POST mfa/setup {flowToken} (from sessionStorage) → QR + recovery codes + input; step2 POST mfa/enable {code, flowToken} → setTokens(pair)+fetchUser→landing; errors inline; cancel = logout.
- reality catalog: AUTH_IP_002, CAPTCHA_001/002 (+ new codes same-commit rule D126). allowlist: +1 key.
- e2e: enroll wizard happy path mocked (setup→enable→dashboard) + enforcement-off unchanged; captcha widget appears/hides on status; login existing suites unaffected (off by default).

## Order: E2 → E1 → E3. Gates per item: RED unit first; vitest+4×tsc; e2e once at end; live: dev server enable each via options, verify 403/400/wizard with curl+browser probe. Deviation: single blockers-Momus on E3 (chain/session issuance is the risky seam), E1/E2 uncontroversial per approved decisions.
