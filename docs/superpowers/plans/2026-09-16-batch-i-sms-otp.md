# Batch I — SMS OTP Login + Provider Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Land SMS OTP login: SmsProvider abstraction (aliyun SDK + twilio raw REST), two endpoints (request/verify), TOTP non-downgrade chain, users.phone column.

**Architecture:** SmsProvider interface in identity package (mirror Mailer.fromConfig null-degrade pattern); endpoints in routes/auth.ts after magic-link block (mirror magic request/consume chain per addendum R3 corrections); FlowTokenService issue/consume with code in payload; users.phone column + partial unique index in migration 0004.

**Tech Stack:** @alicloud/dysmsapi20170525 + @alicloud/openapi-client (aliyun adapter), Node 20 global fetch + Basic auth (twilio adapter — R5: NO twilio npm package), drizzle-kit generate 0004, vitest.

**Spec:** docs/superpowers/specs/2026-09-16-batch-i-sms-otp-design.md + -REVIEW-ADDENDUM.md (R1–R9 binding; addendum overrides spec).

## Global Constraints

- R1: findByPhone multi-match → null + warn; partial unique index on phone
- R2: NO lockout on phone (zero lockout in SMS verify — rate limits only)
- R3/R7: verify chain = findByIdAny → phone-match re-validation → suspended → totpEnabled → mfa_verify or issueTokenPair (exact magic-consume mirror with corrections)
- R4: CJS interop destructure `m.default?.X ?? m.X` + real-import smoke test per adapter
- R5: twilio adapter = raw REST (zero npm dep); aliyun = SDK with lazy import
- R6: E.164 body schema pattern double-escaped in TS source: `'^\\+[1-9]\\d{1,14}$'`
- R8: .env.example 7 SMS env keys; Non-goals declares "no admin-ui changes in v1"
- R9: migration 0004 includes phone column + partial unique index + idx_users_phone
- PIT standing: 048/051/053/054/055/056/057; TDD red-first; English comments/commits

---

## Task 0: deps + migration 0004 + SmsProvider interface (identity package)

**Files:**
- Modify: `packages/identity/package.json` (add @alicloud/dysmsapi20170525 + @alicloud/openapi-client)
- Modify: `packages/identity/src/db/schema.ts` (users.phone varchar(20) nullable)
- Generate: migration 0004 (phone column + partial unique index + idx_users_phone)
- Create: `packages/identity/src/services/SmsProvider.ts` + `packages/identity/src/__tests__/SmsProvider.test.ts`
- Modify: `packages/identity/src/index.ts` (export SmsProvider, SmsConfig)
- Modify: `apps/server/src/managers/UserManager.ts` (findByPhone new method: WHERE phone = X LIMIT 2 → 1 row or null+warn per R1)

**Interfaces:**
- Produces: `SmsProvider.fromConfig(cfg: SmsConfig): SmsProvider | null` (null when config absent); `send({to, code}): Promise<void>`; `SmsConfig {provider, signName?, templateCode?, accountSid?, authToken?, fromNumber?, accessKeyId?, accessKeySecret?}`
- UserManager.findByPhone(phone: string): `Promise<User | null>` (multi-match → null + warn per R1)
- Migration 0004: phone varchar(20) nullable + partial unique idx + regular idx

- [ ] **Step 1: RED — SmsProvider tests** — fromConfig null when unconfigured; aliyun adapter: lazy import smoke (R4 real-import test), send calls SendSms with templateParam JSON {code}, throws on API error; twilio adapter: raw REST fetch POST Messages.json with Basic auth + URLSearchParams, throws on non-2xx; both adapters return null fromConfig when credentials absent
- [ ] **Step 2: RED — UserManager.findByPhone tests** — single match returns user; multi-match returns null (R1); no match returns null; PIT-055 two-key mock modeling
- [ ] **Step 3: schema + migration** — drizzle-kit generate; verify triple + partial unique index in SQL
- [ ] **Step 4: GREEN + build + commit** — `pnpm --filter @accessbase/identity build`; `feat(identity): SmsProvider abstraction + users.phone column with partial unique index (I)`

## Task 1: SMS OTP endpoints (routes/auth.ts)

**Files:**
- Modify: `apps/server/src/routes/auth.ts` (POST /sms-otp/request + POST /sms-otp/verify after magic-link block)
- Modify: `apps/server/src/__tests__/sms-otp.test.ts` (new)
- Modify: `apps/server/src/app.ts` (nothing — auth routes auto-registered; verify)

**Interfaces:**
- Consumes: SmsProvider (T0), UserManager.findByPhone (T0), FlowTokenService (existing), issueTokenPair (auth.ts:54), findByIdAny (auth.ts:516)
- Produces:
  - POST /sms-otp/request {phone} → body schema pattern R6 → 400 invalid; always 202 (enum-safe); found && active → code gen + flowTokens.issue('sms_otp', {userId, phone, code}, 300) + SmsProvider.send fire-and-forget
  - POST /sms-otp/verify {token, code} → flowTokens.consume(token,'sms_otp') → null → 401 AUTH_SMS_001; user = findByIdAny(payload.userId) → null → 401; phone-match `user.phone !== payload.phone` → 401 (R3); suspended → 403 AUTH_004; totpEnabled → issue('mfa_verify',{userId},300) → {mfaRequired,flowToken}; else issueTokenPair → token pair; 200 union schema
  - NO lockout (R2); rate limit 5/15min request + 10/15min verify per IP; .env.example 7 SMS keys (R8)

- [ ] **Step 1: RED — route tests** (mirror magic-login.test.ts pattern): request happy (active user + SmsProvider mock send called + 202 + code in payload asserted via flowTokens.issue spy); request unregistered phone → 202 no send (PIT-056); request invalid phone → 400; request SmsProvider null → 202 + warn; verify happy non-totp → token pair; verify totp user → {mfaRequired, flowToken} + NOT accessToken (R7/R8 test detail); verify wrong code → 401 (token burned); verify expired token → 401 AUTH_SMS_001; verify suspended → 403 AUTH_004; verify phone-match fail (payload.phone ≠ user.phone) → 401 (R3); verify multi-match phone (findByPhone null) → 401; verify zero lockout (R2: no lockout.recordFailure/isLocked called in any verify path — PIT-056 negative probe)
- [ ] **Step 2: Implement endpoints** → GREEN
- [ ] **Step 3: .env.example + gates + commit** — `feat(server): SMS OTP login endpoints with provider abstraction (I)`

## Task 2: PIT-052 matrix update + full regression (final task)

**Files:**
- Modify: `.agents/memorys/pitfalls.md` (PIT-052 matrix: add sms-otp-verify row → mfa_verify {userId} 300s)
- Verify-only: full regression gates

**Interfaces:**
- Consumes: all prior tasks
- Produces: matrix updated (seven→eight issuance points)

- [ ] **Step 1: PIT-052 matrix update** — add sms-otp-verify row
- [ ] **Step 2: Full regression gates** — `pixi run npx vitest run apps/server` 0 failed + `pixi run npx vitest run packages/identity` 0 failed + `pixi run npx tsc --noEmit -p apps/server/tsconfig.json` + `pixi run npx tsc --noEmit` root (PIT-051) + `git branch --show-current` (PIT-053)
- [ ] **Step 3: Commit** — `docs(memory): PIT-052 matrix update for sms-otp-verify (I)`

## 验收清单

- [ ] SmsProvider: fromConfig null-degrade + aliyun SDK adapter (lazy import + CJS interop) + twilio raw REST adapter + real-import smoke tests
- [ ] users.phone migration 0004 + partial unique index + findByPhone multi-match guard
- [ ] POST /sms-otp/request: always 202 + rate 5/15min + E.164 body schema (double-escaped)
- [ ] POST /sms-otp/verify: exact magic-consume mirror with R3 corrections (findByIdAny + phone-match) + zero lockout (R2) + TOTP non-downgrade
- [ ] .env.example 7 keys + Non-goals UI declaration
- [ ] PIT-052 matrix eight issuance points
- [ ] vitest 全绿 / 双 tsc + 根闸净
