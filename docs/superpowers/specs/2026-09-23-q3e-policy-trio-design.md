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

---

## rev.2 — blockers-Momus absorbed (bg_1b142e64; flows pass covered by self-check + shipped E1/E2)

- **F-B1**: enrollArm matrix ADDS ldap/login (auth.ts:1710/1718) → 7 arms total; mfa/verify correctly EXCLUDED (bound-user path).
- **F-B2**: /setup/complete (setup.ts:497-505) signs its own JWT pair OUTSIDE issueTokenPair — wizard path stays enroll-free BY DESIGN (must complete bootstrap; enforcement bites from the next login). Documented here, not a hole to patch.
- **F-B3 wiring prescribed**: mfa/setup + mfa/enable LOSE the route preHandler; handler branches: `body.flowToken ? consume('mfa_enroll') : await app.authenticate(request, reply)` (manual decorator call preserves P0/tenant/Q3A gates — raw jwtVerify would bypass them).
- **F-B4 prescribed**: enable-on-flow loads via **findByIdAny** (public context), requires user.status==='active' (403 AUTH_004 else), passes the FULL user row into issueTokenPair (tokenVersion claim rides → Q3A gate applies to wizard sessions), bad/used enroll token = 401 AUTH_MFA_004 (new code → catalog).
- **F-B5 corrected interpreter roster**: stores/auth.ts login/exchangeOAuthCode/exchangeSamlCode/consumeMagicLink (4) + Login.tsx webauthn + Login.tsx sms = 6 sites; central `handleMfaArm(data)` helper in Login module scope; enroll ⇒ sessionStorage 'mfaEnrollToken' + navigate('/enroll-mfa') (same J14 handoff pattern). /enroll-mfa registered as PUBLIC route (no token exists yet — PrivateRoute would bounce the wizard).
- **F-B6 accepted+documented**: off→all flip does NOT evict live sessions (enforcement applies at next login; refresh continuation is by design — same posture as Keycloak realm policies). No bump-on-toggle (would evict everyone silently; worse).
- **F-B7 accepted**: wrong TOTP code burns the enroll token (mirrors mfa/verify precedent; page says re-login). TTL expiry mid-wizard likewise. Setup-cycling bounded by login rate limits + credential ownership.
- **F-R2 schema rule**: every arm's 200 response schema must declare `enroll:{type:'boolean'}` (+ flowToken already declared) — fast-json-stringify strips undeclared (batch-E lesson).
- KNOWN_OPTION_KEYS already carries the 4 keys (210b856); Settings generic CRUD suffices (no masking: SENSITIVE_KEY_PATTERN doesn't match them).

## Implementation note (E1/E2 shipped ahead of this record)
server 608/608 green with CIDR+captcha lanes; captcha verify = GETDEL w/ get+del fallback (W1-3 discipline); config-plane/Redis failures = feature inert by design (fail-open documented at call sites).

## Execution record (2026-09-23)

E2 CIDR (util + login/register/forgot/magic/sms gates, fail-open layers unit-locked) -> E1 svg-captcha (local challenge, GETDEL, status-gated widget, 4 forms mounted, auto-load on enable) -> E3 enroll chain (enrollGate at 7 arms incl. the Momus-caught LDAP omission; dual-channel mfa/setup+enable via manual app.authenticate for the bearer lane (F-B3); chained mfa_enroll token across setup->enable; findByIdAny + status re-assert + full-claim issueTokenPair at enable (F-B4); public /enroll-mfa wizard with sessionStorage handoff; redirect-channel pre-checks via enforceHit at oauth/saml callbacks with enrollPending payloads). Gates: vitest 1024/1024 (99 files, +mfa-policy x5), 4x tsc 0, e2e 148+3 (q3e-policy x3 incl. chain-token flowToken(tok-1->tok-2) proof; 17-spec captcha/status roster = PIT-080 recurrence caught by FULL e2e — targeted runs would have missed it). Deviations: single Momus (E3-focused) per context ceiling; E1/E2 self-checked + fail-open matrices.
