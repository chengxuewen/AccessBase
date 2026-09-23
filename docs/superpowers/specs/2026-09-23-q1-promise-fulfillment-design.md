# Q1 Promise-Fulfillment Batch — Design Spec

**Date**: 2026-09-23 · **Driver**: docs/superpowers/reports/2026-09-23-gap-audit.md §C/§F · **Baseline**: `23b53cb`
**Scope discipline**: every item here is a backend that already exists but never got its frontend (or a one-layer server completion), plus S-class fixes. No new subsystems.

## Items

### 1. Forgot/reset password UI (gap-audit C: "locked-out user has no product path back")

- New page `pages/ForgotPassword.tsx` at `/forgot-password` (public route, sibling of /login/magic registration in App.tsx:137+): email input → `POST /v1/auth/forgot-password` (auth.ts:681, enumeration-safe 202) → render the returned message verbatim in a success Alert (magic-request precedent Login.tsx:handleMagicRequest).
- New page `pages/ResetPassword.tsx` at `/reset-password?token=`: reads token from search params (display masked prefix only — never log/render full token, W1-6 discipline), newPassword + confirm form → `POST /v1/auth/reset-password {token,newPassword}` (auth.ts:1131; policy rejection surfaces via apiErrorMessage like UserCreate). On success → message + link to /login.
- Login footer: `<Link to="/forgot-password">` + `<Link to="/register">` row (both locales).
- E2E: mocks for both endpoints; assert link presence, form POST payload shape, success states.

### 2. Registration UI (backend auth.ts:301 ships pending semantics)

- New page `pages/Register.tsx` at `/register` (public): email/name/password/confirm → `POST /v1/auth/register` → on 201 switch card to "pending approval" state (no navigation trap; users land back on /login via link). 409 AUTH_REG_001 / 400 AUTH_REG_002 render inline.
- Users.tsx: add status filter (Select active/suspended/pending) — server `GET /v1/users` already accepts `status` (routes/users.ts:54) and passes to findAll; wire into the existing filter toolbar + request params.

### 3. SMS OTP login (fix broken chain, then surface it)

- **[SERVER FIX, RED-first]** `POST /v1/auth/sms-otp/request` (auth.ts:946) currently issues the `sms_otp` flow token but never returns it — `verify` (auth.ts:994) requires `{token, code}`, so no client can complete the flow over the wire. Fix: request ALWAYS responds `202 {message, token}`; for phone-not-found-or-not-active it issues the same-shaped token with `userId: null` and skips sending (constant-shape enumeration immunity, magic 202 precedent). Verify: after consume, `payload.userId == null` → same generic 401 AUTH_SMS_001 (token already burned, magic R13 order). Schema 202 response gains `data.token` (declare it — R2 batch-E lesson: fast-json-stringify strips undeclared fields).
- **[SERVER]** `GET /v1/auth/sms/status` public → `{enabled}` where enabled = `readSmsConfig(options) !== null` (saml/status gate pattern saml.ts:53-61). Rate-limit none needed (constant shape).
- **[FRONTEND]** api/auth.ts: fetchSmsStatus/requestSmsOtp/verifySmsOtp. Login.tsx: gate probe mirroring fetchSamlStatus effect (strict gate, hidden on unreachable); section mirroring magicOpen pattern: phone Input (hint E.164, server validates pattern `^\+[1-9]\d{1,14}$`), send button (busy state, stores returned token), code Input (6 digits) → verify → arms: token-pair (setTokens + fetchUser + navigateAfterAuth) or `{mfaRequired, flowToken}` → `useAuthStore.setState({mfaFlowToken})` so the existing TOTP branch of Login renders (magic consume precedent in store/MagicLogin.tsx double-fire guard awareness).
- Tests: unit RED for request-returns-token + null-userId 401 path in the auth suite; e2e sms tab hidden/shown + full happy path with mocks.

### 4. Dark-mode leak kill (ui-gap H, screenshot-verified)

- Replace `background: '#f0f2f5'` with `token.colorBgLayout` via `theme.useToken()` in: Login.tsx:223 + :275, MagicLogin.tsx:56, setup/index.tsx:68, Consent.tsx:138.
- WelcomeStep.tsx: `#666`→colorTextSecondary, `#999`→colorTextTertiary (status icon hexes #52c41a/#cf1322 are antd presets — keep).
- Dashboard icon hexes SKIPPED deliberately (preset palette reads fine on dark; ponytail: fix the broken thing, not the cosmetic one).
- E2E: extend theme.spec — login page shell bg equals theme token in dark mode (computed style probe, same technique as the sync-round probe).

### 5. i18n keys (ui-gap M)

- `consent.redirecting` into BOTH locales (en: "Redirecting…", zh: "正在跳转…") — Consent.tsx:89 currently renders the raw key to end-users.
- New blocks: `forgot.*`, `reset.*`, `register.*`, `login.sms.*` — en/zh parity, ui-quality i18n key-parity test keeps them locked.

### 6. Audit export → real server endpoint (ui-gap H)

- api/audit.ts: `exportAuditLogs(params: ListAuditParams)` → `client.get('/v1/audit-logs/export', {params, responseType:'blob'})` + blob download (exact precedent api/users.ts:111-118; server side carries the CSV injection guard + tenant predicate, routes/audit.ts:123-168).
- Audit.tsx handleExport: replace the client-side current-page builder with the API call passing current `filters` state; delete the ponytail comment (the "when volume demands it" moment arrived).
- E2E: extend the audit export test — route mocked /v1/audit-logs/export, assert request carries filters and download triggers.

### 7. verify-email minimal closure (design-gap A4)

- `POST /v1/auth/verify-email/request` (authenticate-guarded; self-service only: uses request.user.id — no email param = no enumeration/no admin-confusion). Issues flow token purpose `email_verify`, ttl 86400 (UserManager.verifyEmail doc contract §4.3), sends link `${FRONTEND_ORIGIN}/verify-email?token=` via Mailer (SMTP-gated exactly like forgot-password: mailer absent → 503 AUTH_RESET_002-shape error; same constant-body on all failure arms). Register flow ALSO fire-and-forgets this send for the created pending user (mailer best-effort, never fails registration — SMTP precedent W2).
- `POST /v1/auth/verify-email {token}` (public; add to the existing public whitelist — authorize.ts:14 / authenticate.ts:15 ALREADY list /auth/verify-email, closing the half-wired hole) → consume purpose `email_verify` → `{ userId }` → `UserManager.markEmailVerified(userId)` (new thin method: UPDATE users SET email_verified=true). Unknown/burned token → 400 AUTH_EMAIL_001 (new code → error-codes-reality.md same commit, D126 rule).
- `/auth/me` adds `emailVerified: user.emailVerified ?? false` to the projection; login user payload untouched (R2 lesson: declared response schemas).
- Profile.tsx: Alert banner "email not verified" + send button when !emailVerified (hidden after verify). Verify landing page `/verify-email?token=` = one-shot POST → success/fail Alert (ResetPassword-shaped page; share a tiny TokenLanding pattern — two pages, do NOT abstract a third).
- No login enforcement (that is Q3 policy engine).

### 8. users sortBy whitelist (service-gap D6/19)

- UserManager.findAll: whitelist map `{createdAt, email, name, status}` → drizzle column; `sortOrder==='desc' ? desc : asc`; default stays `createdAt` ASC (zero behavior change when unsorted params, e2e order assertions unaffected).
- Route users.ts: invalid `sortBy` → 400 VALIDATION_001 (whitelist const shared via schema description comment; do NOT silently ignore — fake-sort was the sin).
- Unit: findAll SQL contains `ORDER BY "users"."email" desc` for {sortBy:email,desc} (PgDialect sqlToQuery lock per SessionManager precedent).

### 9. Hygiene

- Delete `CACHE_TTL_SECONDS` (SessionManager.ts:19, zero consumers; TenantManager.ts:193 comment already says so — update that comment's tense).
- `eslint --fix` across src (consistent-type-imports/no-unused-vars classes); hand-remove WebAuthnProvider unused destructures; re-count warnings vs the 70-src baseline; no new warnings anywhere, target ≤30 src.

## Gates (all mandatory before close)

RED-first per item → `pixi run npx vitest run` (expect 972+N), triple tsc, eslint touched files (0 errors), e2e chromium workers=1 (138+N, 0 fail), live battery NOT required (no infra semantics change; wire-chain covered by unit+e2e mocks + one real-PG-free assertion set).

## Out of scope (tracked elsewhere)

audit as-any→fastify.d.ts (Q2), bulk ops, global search/notifications, SSO/trusted-device implementation (docs marked deferred in Q0), SAML IdP/FGA/webhooks (Q3/Q4), Dashboard icon hexes.

## Fact appendix (verified 2026-09-23)

- forgot-password auth.ts:681 returns 200 {success:true} NO message (rev.2 F2) · reset-password auth.ts:1131 (body {token,newPassword}) · link form `FRONTEND_ORIGIN + /reset-password?token=` auth.ts:710
- register auth.ts:301 → 201 {id,email,name,status:'pending'} · users.ts:54 status param · Audit.tsx:61-79 current client-side export · api/users.ts:111-118 blob precedent
- sms request auth.ts:946 (no token in 202 body — the bug) · verify auth.ts:994-1127 (payload {userId,phone,code}; token+code required) · saml gate saml.ts:53-61 · Login.tsx:47-49+84-96 fetchSamlStatus pattern, :373-379 saml button, :381-433 magicOpen pattern, :223/:275 bg hexes
- Consent.tsx:89 raw key · App.tsx public routes area :124-139 · flow token purposes free-form (FlowTokenService.ts:35-108) · /auth/verify-email already whitelisted authorize.ts:14+authenticate.ts:15 · me projection auth.ts:365+

---

## rev.2 — dual-Momus absorbed (flows bg_5e58eb75 + blockers bg_a281374e, both APPROVE-WITH-FIXES)

- **F1 (R1/B1, MAJOR)**: the authorize.ts/authenticate.ts PUBLIC_ROUTES hooks are DEAD in the running server (identityPlugin never registered; sole reference app.ts:353 comment). Item 7's "close the half-wired hole via the existing whitelist" claim is deleted. Actual mechanism: consume endpoint registered WITHOUT preHandler (public by default), request endpoint WITH `preHandler: [app.authenticate]` (app.ts:136 decorator, populates request.user). Do NOT edit the dead PUBLIC_ROUTES arrays.
- **F2 (R4/B2, MAJOR)**: forgot-password actually returns **200 `{success:true}` with NO data.message** (auth.ts:726) — not "202 + message". ForgotPassword.tsx renders a STATIC i18n success string; spec fact appendix corrected.
- **F3 (B3, MED)**: "mailer absent → 503 exactly like forgot-password" — false precedent (forgot is log-only 200). Design kept as NEW behavior: verify-email request returns 503 `AUTH_EMAIL_002` 'SMTP not configured' when mailer unavailable; consume unknown/burned → 400 `AUTH_EMAIL_001`. Both codes land in error-codes-reality.md same commit.
- **F4 (R2/B4, MAJOR)**: User interface + mapToUser (UserManager.ts:357-383) lack `emailVerified` → /me change won't compile as written. Same commit extends identity User type + mapToUser; rebuild identity dist before server tests (PIT-039).
- **F5 (R3/B5, MAJOR)**: sms-otp.test.ts exact-body assertions break loudly: :229/:259/:270/:288 toEqual (add token key) + :294 not-configured `not.toHaveBeenCalled(issue)` FLIPS (not-configured arm now also issues a dummy userId:null token — constant shape in ALL arms). Verify: explicit `if (!payload.userId)` 401 BEFORE findByIdAny (TS null-safety + no `id = NULL` query roundtrip).
- **F6 (R5, MAJOR)**: execution order — items 1/3/4/5 all touch Login.tsx; controller-direct sequential (no parallel lanes over the same file). Order: backend b1(sms)+b2(verify-email)+b3(sort)+b4(hygiene) → frontend f1(i18n+parity test)→f2(api)→f3(pages)→f4(Login single pass)→f5(bg sweep)→f6(audit export)→f7(Users filter)→f8(Profile banner)→f9(routes) → e2e → gates.
- **F7 (R6/B8)**: no locale key-parity test exists anywhere → ADD `apps/admin-ui/src/i18n/__tests__/parity.test.ts` (flatten both JSON trees, assert identical key sets — locks the sync-round 474/474 measurement permanently).
- **F8 (R7)**: WelcomeStep path = `pages/setup/steps/WelcomeStep.tsx`.
- **F9 (B6, LOW accepted)**: register-time verify email may outlive its 24h TTL before approval — harmless (no enforcement; self re-request post-activation). Documented in page copy ("check your inbox after activation" not claimed).
- **F10 (B7, LOW)**: audit export adds the small `blob.type.includes('json')` error sniff → generic i18n error Alert (users-export precedent wart NOT propagated).
- **F11 (R9, note)**: email stays in the sortBy whitelist (not UI-sortable today — future-proofing zero-cost).
