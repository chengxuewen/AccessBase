# Batch E Implementation Plan — MFA Step-Up Alignment Across All Issuance Paths

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the MFA bypass: TOTP-enabled users currently skip step-up when logging in via OAuth, WebAuthn, or LDAP — only local password login enforces it. Align all three issuance paths to the local-login semantics (mfa_verify flowToken branch).

**Architecture:** One semantic, three integration shapes. OAuth callback (302 redirect flow) threads `mfaPending` through its existing oauth_exchange code mechanism so the SPA lands on the TOTP input instead of a session; WebAuthn and LDAP return the same `{mfaRequired, flowToken}` JSON shape local login uses (frontend zero-change). The existing POST /auth/mfa/verify endpoint remains the single TOTP verification + token-issuance gate.

**Tech Stack:** No new dependencies. FlowTokenService, MfaManager, vitest.

**Spec:** docs/superpowers/specs/2026-09-15-batch-d-debt-ldap-design.md §non-goals note + lead-adjudicated bounded design 2026-09-15 (chat-approved). Reference: PIT-052 issuance-gate matrix — this batch fills the MFA step-up column for oauth/webauthn/ldap.

## Global Constraints

- TDD 红先行；vitest mock；不连真 PG；无前端改动（WebAuthn/LDAP 返回本地登录同形 JSON，SPA mfaRequired 交互已存在）
- OAuth 回调是 302 流——mfaPending 经既有 oauth_exchange code 机制传递，执行者读现流后按最小改动落，报告说明接缝
- 行为锁：非 totpEnabled 用户三路径回归零变化（既有测试零改动通过）
- 提交/注释英文；无 as any/@ts-ignore；pino 对象式
- mfa/verify 换发语义保持单一门（TOTP code 校验 + token 签发仍集中一处）
- e2e 无新增；全量基线零新失败（5101→000 + no_proxy）

---

## Task 1: WebAuthn + LDAP step-up 分支（同形 JSON）

**Files:**
- Modify: `apps/server/src/routes/webauthn.ts:298`（issueTokenPair 前置分支）
- Modify: `apps/server/src/routes/auth.ts` LDAP handler（批 D 的 issueTokenPair 调用点前置分支）
- Test: `apps/server/src/__tests__/webauthn.test.ts`（追加）、`ldap-login.test.ts`（追加）

**Interfaces:**
- Consumes: user 行（两路径均已从 DB 读真行）；flowTokens 实例（两文件均有：webauthn.ts:61、auth.ts:32）；本地登录的 mfa_verify 形态（auth.ts:162-166 为参照：`flowTokens.issue('mfa_verify', {userId}, 300)` → `{mfaRequired:true, flowToken}`）
- Produces: totpEnabled 用户在两路径返回 `{mfaRequired:true, flowToken}`（200），非 totp 用户行为逐字节不变
- 注意：WebAuthn 的 user 行与 LDAP 的 user 行都来自 DB 真行（totpEnabled 可读）；LDAP 的 issueTokenPair 用的是 find-or-provision 之后的真行——分支插在 issueTokenPair 之前、suspended 门之后（顺序：suspended → totp → issue）

- [ ] **Step 1: 写失败测试**——webauthn.test.ts：verify 成功 + mock user totpEnabled:true → 200 `{mfaRequired:true, flowToken}` 且 **无 accessToken**；非 totp 回归（既有用例零改动通过）。ldap-login.test.ts 同款两例。
- [ ] **Step 2: RED → 实现两分支（`if (user.totpEnabled) { const flowToken = await flowTokens.issue('mfa_verify', {userId: user.id}, 300); return {mfaRequired:true, flowToken}; }` 照 auth.ts:162-166 形态）→ GREEN**
- [ ] **Step 3: 全量 vitest + tsc ×2；Commit** — `feat(server): MFA step-up on WebAuthn and LDAP login paths (E)`

---

## Task 2: OAuth 回调 mfaPending 通道（302 流适配）

**Files:**
- Modify: `apps/server/src/routes/oauth.ts:469`（issueTokenPair 前置分支 + oauth_exchange payload 扩展）
- Modify: `apps/server/src/routes/auth.ts`（/auth/oauth/exchange 换发端点——totpEnabled 用户 exchange 后返回 mfaRequired 形态）
- Test: `apps/server/src/__tests__/oauth.test.ts`（追加）

**Interfaces:**
- Consumes: oauth_exchange flowToken 机制（oauth.ts:470 issue / :500 consume——SPA exchange 端点所在，执行者先读该端点确认位置）
- Produces: totpEnabled 用户的 OAuth 流：callback 时 issue mfa_verify flowToken + oauth_exchange code（payload 含 {userId, mfaPending:true}）→ SPA exchange → 响应 `{mfaRequired:true, flowToken}`（非 token 对）→ 前端既有 TOTP 输入 → /auth/mfa/verify → **verify 成功后按 user 是否来自 OAuth 发 exchange code**（执行者读 mfa/verify handler 现形态后选择最小接缝：方案 a=verify 响应含新 oauth_exchange code；方案 b=verify 后直接 issueTokenPair 但携带 provider 无关 session。以“token 签发仍集中、不重复造机制”为准）
- 行为锁：非 totp 用户的 OAuth 全流回归零变化

- [ ] **Step 1: 写失败测试**——oauth.test.ts：callback + totpEnabled user → exchange 响应 mfaRequired 而非 token 对；mfa/verify 后换发链；非 totp 全流回归
- [ ] **Step 2: RED → 实现 → GREEN**（执行者裁断 a/b 接缝，报告说明）
- [ ] **Step 3: 全量门禁**——vitest 全量 + tsc ×2 + e2e 全量 chromium（5101→000 + no_proxy；oauth-login.spec 回归确认）
- [ ] **Step 4: Commit** — `feat(server): MFA step-up on OAuth login path (E)`

---

## 验收清单

- [ ] totpEnabled 用户经 oauth/webauthn/ldap 三路径均获 mfaRequired 分支（无 token 对直发）
- [ ] 非 totp 用户三路径回归零变化（既有测试零改动通过）
- [ ] token 签发仍集中经 /auth/mfa/verify（OAuth 经其 exchange 链适配）
- [ ] vitest 全绿 / tsc 双闸 / e2e 基线零新失败
