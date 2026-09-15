# Batch D Implementation Plan — Audit Actor Fix + Real LDAP Provider

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the audit actor attribution hole (4× 'anonymous') and implement the real LDAP provider per identity-sdd §2.1 (Admin Bind, auto-provision, pre-reserved error codes).

**Architecture:** D1 is a four-line semantic fix in packages/audit (user?.id ?? user?.sub ?? 'anonymous') with test updates; the audit.ts consumer side inherits. D2 fills the LdapProvider stub using `ldapts` (the only new dependency), exposes config via options-table keys with env fallbacks, wires a POST /auth/ldap/login route through issueTokenPair (inheriting Batch A disable semantics), and lands the pre-reserved AUTH_063/064/065 codes.

**Tech Stack:** TypeScript strict, ldapts (new), Drizzle ORM, options-table config channel, vitest, Playwright mock-API.

**Spec:** docs/superpowers/specs/2026-09-15-batch-d-debt-ldap-design.md (committed 8c3ed50)

## Global Constraints

- TDD 红先行；vitest mock 不连真 PG/LDAP；e2e mock-API（5101→000 + no_proxy）
- identity/audit 包改动后各 pnpm --filter build（dist 同步陷阱）
- 唯一新依赖 ldapts（lockfile 同 commit）
- LDAP 错误码用预留段 AUTH_063/064/065（identity-sdd:773-775）
- LDAP 用户落库 status='active'（信任源）；登录签发带 status claim（批次 A 语义）
- options 键 ldap_* 走 SENSITIVE_KEY_PATTERN 天然掩码（ldap_bind_password）
- 提交/注释英文；无 as any/@ts-ignore；pino 对象式
- e2e 基线 116+3skip 零新失败；auth-session test.fail 清偿判定归档到报告
- audit 历史行不迁移（前向修复）

---

## Task 1: audit actor 归属修复（D1）

**Files:**
- Modify: `packages/audit/src/middleware.ts`（:86/:124/:130/:157 四处 user?.id）
- Test: `packages/audit/src/__tests__/middleware.test.ts`（既有文件更新/追加）

**Interfaces:**
- Produces: actor 解析顺序 user.id → user.sub → 'anonymous'（:130 resourceId 处 user.id → user.sub → 'unknown'；:157 system 语义处保持 'system' 兜底不动，仅前置 sub 读取）
- 注意 :157 是 system-job 上下文（字面 'system' 兜底），:86/:124 是通用请求上下文——修法相同但兜底语义不同，测试分别断言

- [ ] **Step 1: 写失败测试**（middleware.test.ts 追加/更新四断言）：JWT 形 payload {sub:'u-9'} → userId 'u-9'；{id:'x',sub:'y'} → 'x'（id 优先保兼容）；空 payload → 'anonymous'；apikey 形 {sub:'key-1'} → 'key-1'；:157 system 上下文断言独立
- [ ] **Step 2: RED → 实现（四处 user?.id ?? user?.sub ?? 兜底）→ GREEN**
- [ ] **Step 3: audit build + 全量 vitest + tsc；test.fail 判定**（读 e2e/auth-session.spec.ts 的 test.fail 用例：已修复→删标注转绿归档；仍坏→本批修，报告记录）
- [ ] **Step 4: Commit** — `fix(audit): attribute audit entries to user sub when id absent (D1)`

---

## Task 2: LdapProvider 真实现（D2 核心）

**Files:**
- Modify: `packages/identity/package.json`（+ldapts）+ lockfile
- Modify: `packages/identity/src/types.ts`（LdapConfig 补全：url/baseDn/bindDn/bindPassword/userFilter/attributeMap）
- Modify: `packages/identity/src/providers/LdapProvider.ts`（五方法真实现）
- Modify: `packages/identity/src/index.ts`（无新导出，LdapProvider 已导出；确认）
- Test: `packages/identity/src/__tests__/LdapProvider.test.ts`（new，mock ldapts）

**Interfaces:**
- Consumes: ldapts `Client`（connect(url)、client.bind(dn,password)、client.search(dn,{scope:'sub',filter})、unbind）
- Produces: authenticate({username,password}) → AuthResult{success,userId?,email?,name?}；AUTH_063 连接/绑定失败、AUTH_064 用户 DN 查找无果或 user bind 拒绝（Error.message 带码，路由层映射 HTTP）；syncAttributes 映射 mail→email、displayName→name；autoProvision 落 users（status:'active'）
- 配置形态：constructor(config: LdapConfig)——config 由路由层从 options/env 读（Task 3 接线），provider 只吃纯类型

- [ ] **Step 0:** `pnpm --filter @accessbase/identity add ldapts`（lockfile 同 commit）
- [ ] **Step 1: 写失败测试**（vi.mock('ldapts') Client 全链 mock）：authenticate 成功链（search 1 条 → bind true → 返回 AuthResult）；用户不存在 → AUTH_064；user bind 拒绝 → AUTH_064；连接失败 → AUTH_063；syncAttributes mail/displayName 映射断言；autoProvision 调 createDb 链断言（照 PermissionManager.test mock 模式）
- [ ] **Step 2: RED → 实现 → GREEN**；identity build；全量 vitest
- [ ] **Step 3: Commit** — `feat(identity): real LdapProvider — admin bind, search, verify, sync, provision (D2)`

---

## Task 3: 配置通道 + 登录路由（D2 接线）

**Files:**
- Modify: `apps/server/src/routes/auth.ts`（POST /auth/ldap/login）
- Modify: `apps/server/src/config.ts`（ldap options/env 读取形态确认——或直接 getOptionsManager 三参，照 C2 模式）
- Test: `apps/server/src/__tests__/ldap-login.test.ts`（new）

**Interfaces:**
- Consumes: Task 2 LdapProvider；getOptionsManager 三参（auth.ts:582 先例）；issueTokenPair（含 status claim）
- Produces: POST /api/v1/auth/ldap/login {username,password} → 200 {accessToken,refreshToken,...}（照 login 信封）；LdapProvider 未配置（enabled false/缺 url）→ 503 AUTH_063 语义；认证失败 → 401 AUTH_064；属性同步失败 → 500 AUTH_065（登录降级失败）；自动供给用户 login 链复用 issueTokenPair（带 status claim）
- 路由公开（无权限码——照 login/register 公开形态，零双注册负担）

- [ ] **Step 1: 写失败测试**：mock getOptionsManager（ldap_url 配置形态）+ mock LdapProvider（或 mock ldapts 经 provider）；成功 → 200 + token 对；未配置 → 503；AUTH_064 → 401；AUTH_065 → 500；LdapConfig 从 options 组装正确性断言
- [ ] **Step 2: RED → 实现（路由 + provider 组装 + issueTokenPair）→ GREEN**；全量 vitest + tsc ×2
- [ ] **Step 3: Commit** — `feat(server): LDAP login route with options-driven config (D2)`

---

## Task 4: e2e + 收官门禁（D2 前端零改动说明）

**Files:**
- Test: `e2e/ldap-login.spec.ts`（new，mock-API）
- 验证性任务

**Interfaces:**
- Consumes: Task 3 路由

- [ ] **Step 1: e2e**——GlobalGuard mock + login helper；mock `/api/v1/auth/ldap/login` 200 token 形状 → 登录成功进 Dashboard；401 场景 inline 错误。RED（路由前端无专属 UI，Login 页现有表单不受影响——本 e2e 直接 API 级断言 + 复用现有登录流回归即可，若无需前端改动则此条降为 API e2e 形态并注明）
- [ ] **Step 2: 全量门禁**——vitest 全量（预期 561+新增）；tsc ×2；e2e 全量 chromium（基线 116+3skip + 新增，零失败）
- [ ] **Step 3: Commit** — `test(e2e): batch D regression locks — LDAP login flow (D2)`

---

## 验收清单（批次 D 完成定义）

- [ ] audit 四处 actor 归属正确（sub 优先/id 回退/anonymous 兜底/system 独立）
- [ ] auth-session test.fail 清偿判定完成（转绿删标注 或 bug 修复），存量回 0
- [ ] LdapProvider 五方法真实现，AUTH_063/064/065 三分支齐备
- [ ] POST /auth/ldap/login 全语义（200/401/500/503）+ issueTokenPair 带 status claim
- [ ] ldapts 锁版本入 lockfile；LDAP options 键掩码生效
- [ ] vitest 全绿 / tsc 双闸 / e2e 基线零新失败
