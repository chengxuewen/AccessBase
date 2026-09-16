# Batch F — SAML SP + Magic Link + Debt Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SAML 2.0 SP login (exchange-channel mirroring OAuth) + magic-link passwordless email login + close batch-E Low debt and env passthrough gaps.

**Architecture:** SamlProvider wraps node-saml v5 (lazy import) in identity package; routes/saml.ts is a new encapsulated plugin (5 public endpoints, scoped urlencoded parser) following the OAuth exchange-channel pattern. Magic link reuses FlowTokenService + Mailer with two endpoints in routes/auth.ts. Cleanup package touches stores/Login.tsx/oauth.test.ts/accessbase.sh/e2e.

**Tech Stack:** @node-saml/node-saml 5.1.0, Fastify 4 scoped addContentTypeParser, FlowTokenService (shared-Map stub seam), Mailer.fromConfig, vitest + Playwright mock-API e2e.

**Spec:** docs/superpowers/specs/2026-09-16-batch-f-saml-magic-cleanup-design.md + -REVIEW-ADDENDUM.md (R1–R14; addendum overrides spec where they conflict). The addendum is normative — read it first.

## Global Constraints

- New routes: zero permission codes (auth/* paths resolve null in authorize.ts) — seed stays 18; check `grep -c "resource: '" apps/server/src/routes/permissions-seed.ts` = 18
- MFA step-up four-way uniform: purpose `mfa_verify`, payload `{userId}`, TTL 300s, single /auth/mfa/verify gate untouched
- app.ts invariant: `grep -c "addContentTypeParser" apps/server/src/app.ts` = 0 (parser lives in routes/saml.ts plugin scope only)
- R2 union 200 schema on saml/exchange declares mfaRequired/flowToken AND token-pair fields (fast-json-stringify strips undeclared — batch-E R2 lesson)
- identity package changes → `pnpm --filter @accessbase/identity build` before server tsc (PIT-048/049)
- pino object-style logging; commits/comments English (spec/docs English per batch-F convention; plan body Chinese allowed but this plan uses English for code comments)
- TDD (D114): every task RED first; vitest mocks only, no real PG/Redis (FlowTokenService per-instance memory in test env)
- e2e precheck: 5101 down (`curl -s -m 2 --noproxy '*' http://localhost:5101/health/live` → 000) + `export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1`
- frontend changes → tsc 双闸 (apps/server + apps/admin-ui) + e2e no new failures
- Final tree: root `pixi run npx tsc --noEmit` (PIT-051)
- R10: add `/api/v1/auth/saml/acs` to audit exclusion list in app.ts (options precedent)
- R11: node-saml named-import smoke test is T1's RED step; fallback `import nodeSaml from '@node-saml/node-saml'; const { SAML } = nodeSaml`

---
- R8 (Mailer keys): T3's SMTP options keys MUST be exactly `smtp_host/smtp_port/smtp_user/smtp_password/smtp_from` + `SMTP_*` env fallback (auth.ts:576-581) — no second SMTP config source
- R9 (audit events): NO named audit events — global onResponse hook covers new routes automatically; magic consume `{token}` body is auto-redacted by field name ('token' in audit redact list, packages/audit/src/types.ts:149); no explicit AuditLogger wiring anywhere in this batch
- R12 (endpoint count): routes/saml.ts ships FIVE routes — login / acs / metadata / status / exchange (exchange is a first-class bullet, not an afterthought)
- Suspended-gate semantics per route: ACS = browser navigation → 302 `/login?samlError=AUTH_004` (never raw 403 on a redirect flow); exchange + magic consume = API envelope → 403 AUTH_004 (JSON)


## Task 1: SamlProvider (identity package, lazy node-saml)

**Files:**
- Create: `packages/identity/src/providers/SamlProvider.ts`
- Create: `packages/identity/src/__tests__/SamlProvider.test.ts`
- Modify: `packages/identity/src/index.ts` (add export line)
- Modify: `packages/identity/package.json` (add `@node-saml/node-saml` to dependencies)
- Test: `packages/identity/src/__tests__/SamlProvider.test.ts`

**Interfaces:**
- Consumes: node-saml `SAML` class, `Profile` type (R11 fallback import pattern if named import fails at runtime)
- Produces: `SamlProvider` class — `constructor(config: SamlProviderConfig)`, methods `async loginUrl(relayState: string, host?: string): Promise<string>` (redirect URL via getAuthorizeUrlAsync), `async validateResponse(container: Record<string, string>): Promise<{ email: string; nameId: string; displayName?: string } | { error: 'AUTH_SAML_002'; message: string }>` (wraps validatePostResponseAsync, extracts email from profile.email ?? profile.nameID, generic message on any validation failure — no IdP detail leak), `async metadataXml(): Promise<string>` (generateServiceProviderMetadata standalone with issuer/callbackUrl/logoutCallbackUrl omitted). Export type `SamlProviderConfig` — fields mirror the options keys in Task 2: `{ enabled: boolean; entryPoint: string; idpCert: string; entityId: string; idpIssuer?: string; privateKey?: string; publicCert?: string; clockSkewMs?: number }`
- R5: NO top-level import of '@node-saml/node-saml' — module-level `let samlModule` cache + lazy `await import()` inside a private `async getSaml(): Promise<SAML>` helper

- [ ] **Step 1: RED — write failing tests** (mirror LdapProvider.test.ts vi.mock style): mock '@node-saml/node-saml' with `vi.mock` factory returning `{ SAML: vi.fn().mockImplementation(() => fakeInstance), generateServiceProviderMetadata: vi.fn() }`; first test asserts the real named-import resolves (R11 smoke: `const mod = await import('@node-saml/node-saml'); expect(typeof mod.SAML).toBe('function')` — this fails until package.json dep added); tests: loginUrl calls getAuthorizeUrlAsync and returns url; validateResponse happy path (profile.email present); validateResponse falls back to nameID when email absent; validateResponse returns `{error:'AUTH_SAML_002'}` with generic message 'SAML sign-in failed' on null profile; metadataXml calls generateServiceProviderMetadata with issuer+callbackUrl; lazy-import cached (second call reuses module)
- [ ] **Step 2: Run — expect fail** — `pnpm --filter @accessbase/identity test -- SamlProvider` → FAIL (module not found)
- [ ] **Step 3: Implement SamlProvider** — lazy import pattern; `new SAML({ issuer: config.entityId, callbackUrl, idpCert, entryPoint, wantAssertionsSigned: true, wantAuthnResponseSigned: true, acceptedClockSkewMs: config.clockSkewMs ?? 300000, identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress', privateKey: config.privateKey, publicCert: config.publicCert, idpIssuer: config.idpIssuer, audience: config.entityId })` — callbackUrl passed to constructor via config (add `callbackUrl: string` to SamlProviderConfig); validateResponse try/catch wraps validatePostResponseAsync — catch → `{error:'AUTH_SAML_002', message:'SAML sign-in failed'}`; never throw
- [ ] **Step 4: GREEN + build** — tests pass; `pnpm --filter @accessbase/identity build` (dist sync); index.ts adds `export { SamlProvider } from './providers/SamlProvider.js'; export type { SamlProviderConfig } from './providers/SamlProvider.js';`
- [ ] **Step 5: Commit** — `feat(identity): SamlProvider wrapping node-saml with lazy import (F)`

## Task 2: SAML routes plugin (5 endpoints + scoped parser + audit exclusion)

**Files:**
- Create: `apps/server/src/routes/saml.ts`
- Create: `apps/server/src/__tests__/saml.test.ts`
- Modify: `apps/server/src/app.ts` (register samlRoutes + audit exclusion list entry)
- Test: `apps/server/src/__tests__/saml.test.ts`

**Interfaces:**
- Consumes: SamlProvider (Task 1), FlowTokenService shared-Map stub seam (batch-E R3 pattern from oauth.test.ts:130-163), issueTokenPair/rolesOf (re-define locally in plugin mirroring auth.ts:54-84 — routes are per-plugin functions)
- Produces: routes — `GET /api/v1/auth/saml/login` (302 to IdP; 503 `{success:false,error:{code:'AUTH_SAML_001'}}` when disabled), `POST /api/v1/auth/saml/acs` (scoped urlencoded parser; consume → validate → find-or-provision → suspended gate 403 AUTH_004 → issue `saml_exchange` flowToken 60s payload `{userId, mfaPending}` or `{userId, accessToken, refreshToken, user}` dual-variant per R1 → 302 `/login?samlCode=<token>`; error → 302 `/login?samlError=AUTH_SAML_002`), `POST /api/v1/auth/saml/exchange` (JSON; consume `saml_exchange` → mfaPending variant issues `mfa_verify` {userId} 300s → `{success:true,data:{mfaRequired:true,flowToken}}`; non-mfaPending → token pair envelope; 200 union schema per R1; 401 AUTH_SAML_002 on invalid/expired), `GET /api/v1/auth/saml/metadata` (xml), `GET /api/v1/auth/saml/status` (`{success:true,data:{enabled:boolean}}`)
- Rate limits (R6): ACS 10/min, login 30/min, exchange 20/min, metadata 30/min, status 60/min — route-level `config: { rateLimit: { max, timeWindow } }`
- Options keys (R3 mask auto-covers private_key; idp_cert/public_cert intentionally unmasked — public material): `saml_enabled/SAML_ENABLED(false)`, `saml_entry_point/SAML_ENTRY_POINT`, `saml_idp_cert/SAML_IDP_CERT`, `saml_entity_id/SAML_ENTITY_ID(urn:accessbase:saml:sp)`, `saml_idp_issuer/SAML_IDP_ISSUER`, `saml_private_key/SAML_PRIVATE_KEY`, `saml_public_cert/SAML_PUBLIC_CERT`, `saml_clock_skew_ms/SAML_CLOCK_SKEW_MS(300000)`; callbackUrl derived `saml_entity_id`-independent: `String(await get('saml_acs_url','SAML_ACS_URL', \`${origin}/api/v1/auth/saml/acs\`))` — new key `saml_acs_url/SAML_ACS_URL` defaulting to request origin + fixed path
- R2 ruling: ACS never reads RelayState; 302 target is always `/login?samlCode=…` or `/login?samlError=…`

- [ ] **Step 1: RED — write failing route tests** (mirror oauth.test.ts: plugin mount via `app.register(samlRoutes)` after vi.mock '@accessbase/identity' returning {SamlProvider: mock class, UserManager, RoleManager}; shared FlowTokenService stub via module-level Map — copy the sharedFlowTokens seam from oauth.test.ts:130-163 with purpose-check-after-burn ordering per F3-3, since Task 6 fixes the real stub): cases — status disabled default 503→no wait, status returns {enabled:false}; login when disabled → 503 AUTH_SAML_001; login when enabled → 302 Location contains entryPoint host; acs happy non-totp → 302 `/login?samlCode=` (assert flowTokens.issue called with 'saml_exchange' + payload contains accessToken); acs totp user → 302 + payload has mfaPending:true + no accessToken; acs suspended existing user → 302 samlError (NOT 403 — browser navigation gets redirect; error code carried in query); acs invalid assertion (provider returns error) → 302 samlError; exchange mfaPending → {mfaRequired:true, flowToken} + assert mfa_verify issued {userId} 300s; exchange non-mfaPending → token pair envelope shape; exchange invalid token → 401 AUTH_SAML_002; union schema: exchange response includes flowToken AND accessToken variants both declared (R2); status enabled → {enabled:true}; app.ts grep invariant: `expect(appSource).not.toMatch(/addContentTypeParser/)` for app.ts (static assertion like route-guard.test)
- [ ] **Step 2: Run — expect fail** — `pnpm --filter @accessbase/server test -- saml` → FAIL
- [ ] **Step 3: Implement routes/saml.ts** — plugin signature `export async function samlRoutes(app: FastifyInstance)`; scoped parser FIRST: `app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => { try { done(null, Object.fromEntries(new URLSearchParams(body as string))); } catch (e) { done(e as Error, undefined); } })`; per-plugin `new FlowTokenService(config.nodeEnv === 'test' ? undefined : safeRedis())` (auth.ts:32-34 pattern); dynamic `await import('@accessbase/identity')` inside handlers (auth.ts:898 precedent); options via `getOptionsManager()` get() pattern (auth.ts:877-879); ACS handler: enabled gate → provider.validateResponse → email gate (empty email → AUTH_SAML_002 error redirect) → UserManager.find-or-provision (existing ? active-gate : create {email, name}, DEFAULT_TENANT) → dual-variant saml_exchange issue → 302; exchange handler: consume → null → 401 AUTH_SAML_002 envelope → mfaPending ? mfa_verify+{mfaRequired,flowToken} : token-pair envelope; app.ts: import samlRoutes, `app.register(samlRoutes)` after oauthRoutes; audit exclusion: find the audit hook exclusion array in app.ts (grep '/api/v1/options') and append '/api/v1/auth/saml/acs'
- [ ] **Step 4: GREEN + tsc** — `pnpm --filter @accessbase/identity build && pixi run npx tsc --noEmit -p apps/server/tsconfig.json`
- [ ] **Step 5: Commit** — `feat(server): SAML SP routes with exchange channel + scoped urlencoded parser (F)`

## Task 3: Magic link (request + consume endpoints in routes/auth.ts)

**Files:**
- Modify: `apps/server/src/routes/auth.ts` (add POST /auth/magic/request + POST /auth/magic/consume after forgot-password route ~:556-640)
- Test: `apps/server/src/__tests__/magic-login.test.ts` (new)

**Interfaces:**
- Consumes: flowTokens instance (auth.ts:32), Mailer.fromConfig (identity), issueTokenPair/rolesOf (auth.ts:54-84, in-file), options get() pattern
- Produces: `POST /api/v1/auth/magic/request` {email:string} → **always 202 `{success:true,data:{message:'If an account exists, a sign-in link has been sent.'}}`** regardless of existence (enumeration resistance); rate limit 5/15min per IP (R7); body schema {email:{type:'string',format:'email'}} → 400 on invalid; internal: UserManager.findByEmail → if found && status==='active' → flowTokens.issue('magic_login', {userId, email}, 900) → Mailer.fromConfig(smtp options keys smtp_host/smtp_port/smtp_user/smtp_password/smtp_from + SMTP_* env, auth.ts:576-581 keys) → send html link `${origin}/login/magic?token=…` where origin = options `site.url` → env SITE_URL → request origin (R3); Mailer null → log warn, still 202; `POST /api/v1/auth/magic/consume` {token:string} → rate limit 10/15min per IP → flowTokens.consume(token,'magic_login') → null → 401 AUTH_MAGIC_001 generic → user lookup by payload.userId → null → 401 AUTH_MAGIC_001 (R13) → email-match `user.email !== payload.email` → 401 AUTH_MAGIC_001 (token already burned) → suspended (existing && status!=='active') → 403 AUTH_004 → totpEnabled → `mfa_verify` {userId} 300s → `{success:true,data:{mfaRequired:true,flowToken}}` (200 schema declares union: mfaRequired/flowToken + accessToken/refreshToken/expiresIn/user) → else token pair envelope (shape mirrors login 200)
- Error code AUTH_MAGIC_001 generic message 'Invalid or expired sign-in link'

- [ ] **Step 1: RED — write failing tests** (mirror ldap-login.test.ts vi.mock pattern; flowTokens per-instance memory works in-file since request+consume share the plugin instance): request happy (active user) → 202 fixed body + flowTokens.issue called 'magic_login' {userId,email} 900 + Mailer send called with link containing token; request unknown email → 202 IDENTICAL body (assert deep-equal to happy body) + no Mailer call + no issue; request suspended user → 202 identical + no send; request invalid email format → 400; request Mailer null (no smtp_host) → 202 + warn logged; consume happy non-totp → token pair envelope; consume totp user → {mfaRequired, flowToken} shape; consume invalid token → 401 AUTH_MAGIC_001; consume deleted user → 401; consume email-changed (payload.email ≠ user.email) → 401; consume suspended → 403 AUTH_004
- [ ] **Step 2: Run — expect fail** — `pnpm --filter @accessbase/server test -- magic-login` → FAIL
- [ ] **Step 3: Implement** — two routes in routes/auth.ts; 200 response schema for consume (union declaration); options read `site.url` with `SITE_URL` env fallback via get(); request route reads body schema email format validation
- [ ] **Step 4: GREEN + tsc + full vitest** — `pixi run npx tsc --noEmit -p apps/server/tsconfig.json && pnpm --filter @accessbase/server test`
- [ ] **Step 5: Commit** — `feat(server): magic link login endpoints with enumeration-safe request (F)`

## Task 4: Frontend — SAML button + magic link UI + exchange wiring

**Files:**
- Modify: `apps/admin-ui/src/api/auth.ts` (add fetchSamlStatus, exchangeSamlCode, requestMagicLink, consumeMagicLink — ApiEnvelope-typed)
- Modify: `apps/admin-ui/src/stores/auth.ts` (add exchangeSamlCode action mirroring exchangeOAuthCode incl. R4-corrected MFA branch)
- Modify: `apps/admin-ui/src/pages/Login.tsx` (SAML button gated by status.enabled; magic-link email mini-form; handle samlCode/samlError query params)
- Create: `apps/admin-ui/src/pages/MagicLogin.tsx` (route /login/magic reads token query → consume → success/mfa/suspended/401 states)
- Modify: `apps/admin-ui/src/App.tsx` (add /login/magic route, public)
- Test: `e2e/saml.spec.ts` (new, mock-API), `e2e/auth-session.spec.ts` (append exchange-mfaRequired case — F3-5)

**Interfaces:**
- Consumes: client baseURL '/api' envelope pattern; providers-style status fetch; exchangeOAuthCode store action shape (stores/auth.ts:172-210)
- Produces: exchangeSamlCode — same contract as exchangeOAuthCode (POST /v1/auth/saml/exchange {code} → token pair or mfaRequired branch with R4 fix: clear token/refreshToken/user in MFA branch); Login.tsx effect for `samlCode` param mirrors oauthCode effect (exchange → fetchUser/navigateAfterAuth or TOTP form via mfaFlowToken); samlError param → inline Alert with generic message; MagicLogin consumes token → success → fetchUser+navigateAfterAuth / mfaRequired → mfaFlowToken set → navigate('/login') for TOTP form (store shared)

- [ ] **Step 1: RED — e2e first** (mock-API): e2e/saml.spec.ts — mock `/api/v1/auth/saml/status` {enabled:false} → button hidden; {enabled:true} → button visible with href; mock exchange mfaRequired → TOTP form renders (assert mfaFlowToken path); mock exchange token-pair → navigates to dashboard; samlError param → Alert visible; e2e/auth-session.spec.ts append: exchange mock {mfaRequired:true,flowToken:'flow-1'} → TOTP form shows (F3-5 insertion, R6-style)
- [ ] **Step 2: Run — expect fail** — `pixi run npx playwright test e2e/saml.spec.ts` → FAIL (no button/route)
- [ ] **Step 3: Implement** — api/auth.ts additions (ApiEnvelope typing, no implicit any per Phase-7 constraint); stores/auth.ts exchangeSamlCode (MFA branch: `set({ mfaFlowToken, isAuthenticated: false, token: null, refreshToken: null, user: null })` — R4 fix applied at birth); Login.tsx: samlCode effect (guard: `if (code && useAuthStore.getState().mfaFlowToken) return` mirror oauthCode; skip when samlError present), SAML button (status fetch on mount, no FALLBACK_PROVIDERS semantics — strict enabled gate per addendum), magic email form (useState + requestMagicLink → fixed-message Alert); MagicLogin page + App.tsx route (public, inside existing public route group)
- [ ] **Step 4: GREEN + 双闸 tsc + e2e full** — `pixi run npx tsc --noEmit -p apps/admin-ui/tsconfig.json && pixi run npx playwright test --project=chromium` — all green, 0 new failures
- [ ] **Step 5: Commit** — `feat(admin-ui): SAML sign-in button + magic link flow + exchange MFA wiring (F)`

## Task 5: Cleanup — E-Low×2 frontend + stub burn fix

**Files:**
- Modify: `apps/admin-ui/src/stores/auth.ts` (exchangeOAuthCode MFA branch clears token/refreshToken/user — E-Low #1)
- Modify: `apps/admin-ui/src/pages/Login.tsx` (sessionStorage mfaFlowToken handoff before oidcRedirect assign; restore effect declared BEFORE oauthCode effect — E-Low #2, R14)
- Modify: `apps/server/src/__tests__/oauth.test.ts` (shared stub burn-first — E-Low #3)
- Test: `apps/admin-ui/src/stores/__tests__/auth.test.ts` (new — store unit test for MFA branch hygiene)

**Interfaces:**
- Consumes: existing exchangeOAuthCode action (Task 4 already applies the same fix to exchangeSamlCode — this task retrofits exchangeOAuthCode); oauth.test.ts sharedFlowTokens stub (:130-163)
- Produces: exchangeOAuthCode MFA branch: `set({ mfaFlowToken: payload.flowToken, isAuthenticated: false, token: null, refreshToken: null, user: null })`; Login.tsx: before `window.location.assign(oidcRedirect)` — `if (useAuthStore.getState().mfaFlowToken) sessionStorage.setItem('mfaFlowToken', value)` (skip null — removeItem otherwise); mount restore effect FIRST (before oauthCode effect at :42): read sessionStorage → set store → sessionStorage.removeItem — R14 ordering hard constraint
- Stub fix: oauth.test.ts sharedFlowTokens.consume — move `sharedFlowStore.delete(token)` BEFORE purpose check (mirror FlowTokenService.ts:70/81 real burn-first)

- [ ] **Step 1: RED — store unit test** (new file, vitest + create memory store via actual store creator with mocked api layer): exchangeOAuthCode with mfaRequired response → assert mfaFlowToken set AND token/refreshToken/user all null (fails today — current branch keeps them)
- [ ] **Step 2: Run — expect fail** — `pnpm --filter @accessbase/admin-ui test -- auth` → FAIL
- [ ] **Step 3: Implement store fix + Login.tsx handoff** — as specified in Interfaces; verify effect declaration order in Login.tsx (restore effect must appear earlier in the component than the oauthCode effect, R14)
- [ ] **Step 4: oauth.test.ts stub burn fix** — one-line move; run `pnpm --filter @accessbase/server test -- oauth.test` → green (no existing test depends on mismatch-not-burning — verified by blockers critic)
- [ ] **Step 5: GREEN + 双闸 tsc** + commit — `fix(admin-ui,server): MFA branch token hygiene + oidcRedirect flowToken handoff + stub burn-first (F cleanup)`

## Task 6: Env passthrough (F3-4, R4) + e2e full regression

**Files:**
- Modify: `accessbase.sh` (dev/native path: `set -a; [ -f .env ] && . ./.env; set +a` before server start; container run: replace explicit -e list with `--env-file .env` when file exists, fallback to existing -e list)
- Modify: `.env.example` (add SITE_URL=, SAML_ENABLED=false, SAML_ENTRY_POINT=, SAML_IDP_CERT=, SAML_ENTITY_ID=urn:accessbase:saml:sp, SAML_ACS_URL=, MAGIC section comment only — no magic env keys beyond SITE_URL/SMTP_*)
- Test: manual verification steps + e2e full suite

**Interfaces:**
- Consumes: existing accessbase.sh cmd_dev_native (~:88-96, :195) and cmd_start_container (:461-463)
- Produces: all four modes deliver MFA_ENCRYPTION_KEY from .env to the server process env

- [ ] **Step 1: Implement script changes** — dev/native: source .env early in cmd_dev_native + cmd_dev paths (guard `[ -f .env ]`); container: `if [ -f .env ]; then docker run --env-file .env … else <existing -e list>; fi`; keep deploy untouched (start.sh already sources)
- [ ] **Step 2: Verify all 4 modes** — native: `MFA_ENCRYPTION_KEY=test echo nothing; bash accessbase.sh status:native`… concrete check: put `MFA_ENCRYPTION_KEY=ab`*16 in .env → start server → `grep -c` server logs for startup without MFA key warning, or curl /health; container: docker exec printenv check if container runtime available — if not, static script review + note; document what was NOT verifiable (NOT VERIFIED clause per testing rules)
- [ ] **Step 3: e2e full regression** — 5101 precheck 000 + no_proxy exports → `pixi run npx playwright test --project=chromium` full → 0 new failures vs 116+3 baseline (SAML/magic new specs included)
- [ ] **Step 4: Full vitest + root tsc** — `pnpm -r test` (or per-package) all green; `pixi run npx tsc --noEmit` root clean (PIT-051)
- [ ] **Step 5: Commit** — `chore(scripts): .env passthrough for dev/native/container modes + SAML/magic env docs (F)`

## 验收清单

- [ ] SAML: status→button→login→(IdP 不可测，mock 层)→acs→samlCode→exchange→totp? mfa_verify : token pair；suspended → samlError redirect；ACS 审计排除生效；app.ts parser invariant = 0
- [ ] Magic: request 恒 202 + 限流 5/15min + Mailer 链路（Mailer null 降级）；consume 全分支（invalid/deleted/email-changed/suspended/totp/normal）
- [ ] MFA 四维同形扩至六签发点（login/ldap/webauthn/oauth-exchange/saml-exchange/magic-consume）——mfa_verify {userId} 300s，verify 单门不动
- [ ] F3 全清：MFA 分支 token hygiene（OAuth+SAML 两 action）、oidcRedirect handoff（R14 顺序）、stub burn-first、env 透传、e2e mfaRequired case
- [ ] vitest 全绿（604 基线 + 新增）、tsc 双闸 + 根闸净、e2e 全量 0 新失败、seed 18 不变
