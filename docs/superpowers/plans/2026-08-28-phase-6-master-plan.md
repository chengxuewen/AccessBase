# AccessBase Phase 6 主实施计划 — 安全基座 + 会话/多步认证 + 核心页面 + 登录扩展

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this master plan + per-phase sub-plans. Steps use checkbox (`- [ ]`) index
> **本计划对应子计划**: 4 份子计划文档（6a/6b/6c/6d），每份含完整 TDD 步骤级任务分解。本文件是导航枢纽 + 测试策略总纲。

**Goal:** 将 AccessBase 从“骨架完整、逻辑大量 stub”推进到企业 IAM 可用基线（安全硬化 + 会话/多步认证 + 核心页面 + OAuth/WebAuthn 登录扩展），全程 TDD，人工测试最小化。

**Architecture:** 在现有 Fastify 插件架构上补齐 L0 接线 → 安全中间件链 → 会话存储重构（refresh 轮换 + Redis + DB）→ flow_token 多步认证基座 → 2FA/WebAuthn/OAuth 依次构建 → 前端补齐 Roles/Audit/Profile/Settings 页面。所有安全相关变更遵循最小变更原则，不动 `.refinfo/`。

**Tech Stack:** Fastify v4 / @fastify/jwt v8 / Drizzle ORM / PostgreSQL 16 / Redis (Valkey) / otplib / qrcode / @simplewebauthn/server+browser / arctic (OAuth) / React 18 / AntD 5 / Vitest / Playwright

**Spec:** `docs/modules/{api,database,security,ui,core-packages}.md` + `.agents/memorys/decisions.md` (D22/D23/D42/D60/D84) + `.refinfo/new-api/`（flow_token 模式参考）

## Global Constraints

- 包管理一律 pnpm workspace，不新增非必要依赖；新增依赖必须进 pixi/pnpm lockfile 一起提交
- API 路径必须 `/api/v1/` 前缀；前端 client.baseURL='/api'，请求路径带 `/v1/`
- 严格 TypeScript，无 `as any` / `@ts-ignore`（project anti-pattern）
- 每个任务: 失败测试先行 → 最小实现 → 通过 → commit
- E2E 用 Playwright（mock API 默认，真后端仅 setup/auth-flow 类测试）；webServer.reuseExistingServer: true
- 测试命令统一: `pixi run npx vitest run <file>` / `pixi run npx playwright test --project=chromium e2e/<file>.spec.ts`
- 用户实体无 status/roles 字段（D105）；PATCH /users/:id/status 独立端点
- 测试数据独立（Date.now() 标识）；beforeEach 检测 401 → 重建 admin 重试
- 前端改动必须过 4 步验证: tsc → dev server 200 → console 0 error → 路由可达
- Zod 校验在信任边界；日志 pino 结构化（对象第一参）

---

# 测试策略总纲（减少人工测试）

## 三层测试金字塔 + 最终人工抽检

| 层 | 工具 | 見覆盖内容 | 触发点 |
|----|------|-----------|--------| project--------|
| L1 单元 | Vitest | 每个 manager/provider/middleware/util 的核心逻辑（AAA 模式，mock 外部依赖） | 每个任务 RED→GREEN 步骤 |
| L2 集成 | Vitest + fastify.inject() | 路由级：认证链、RBAC preHandler、rate limit 生效、audit hook 讽出审计记录、refresh 轮换全流程 | 每个路由任务收尾 |
 | L3 E2E | Playwright | 用户旅程: login→2FA→roles CRUD→audit 查看→profile 改密→settings 保存→OAuth/WebAuthn 癟2 login→2FA→roles CRUD→audit 查看→works | 每个前端页面任务收尾 |
| 人工 | 人工 | 仅最终验收抽检（每个 Phase 一次，<30 min，按 checklist 抽查 E2E 視盲区: 视觉走查、真实 OAuth provider 后台配置、真实 hardware key）。任何时候无法自动化验证时：**NOT VERIFIED — services unavailable** | Phase 收尾 |

## 自动化校验命令矩阵（计划中每个任务收尾必须跑）

```bash
# 通用门禁（每个任务 commit 前必须全绿）
pixi run npx tsc --noEmit
pixi run npx vitest run packages/identity apps/server/src 2>&1 | tail -5

# 前端任务追加
pixi run npx tsc --noEmit -p apps/admin-ui/tsconfig.json
pixi run npx vitest @testing-library 2>/组件级校验
# E2E（涉及前端路由/API 契约变更时）
pixi e npx playwright test --project=chromium

# 后端集成流（涉及路由/中间件时）
pixi run npx vitest run apps/server/src/__tests__/routes.test.ts
routes.test.ts
```

## E2E 人工测试最小化设计原则

1. **能断言就断言**：E2E 中所有行为验证用 expect 断言（URL/表格行/表格行/console errors，不用“人眼看截图”
2. **真后端测试仅限**: setup wizard、auth-flow（login→me→logout→refresh）、2FA 全流程、OAuth（mock provider server） 真 OAuth provider 后台留人工抽检
3. Playwright 可 API-first：先 `request.post('/api/v1/auth/login')` 材 token，再 page 测试 UI，避免 UI 登录的脆弱性
4. console error 过滤规则不变（findDOMNode/chrome-extension/ResizeObserver）
5. 真实邮件/OAuth 后台/hardware key 3 类场景 → 最终人工抽检 checklist（每 Phase 收尾一次）

---

# Phase 导航

| Phase | 主题 | 任务数 | 预估 | 子计划文档 |
|-------|------|--------|------|-----------|
| **6a** | 安全基座：接线 + 中间件链 + RS256 + refresh 轮换 + audit 接线 | 6 | ~1 周 | `2026-08-28-phase-6a-security-foundation.md` |
| **6b** | 会话与多步认证基座: SessionManager + flow_token + 2FA/TOTP + 密码管理 + 锁定 | 5 | ~1.5 周 | `2026-08-28-phase-6b-session-mfa.md` |
| **6c** | 核心页面: Roles CRUD / Users 重构 / Audit 查看器 / Profile / 快赢集 / 布局增强 | 6 | ~2 周 | `2026-08-28-phase-6c-core-pages.md` |
| **6d** | 登录扩展: OAuth + WebAuthn + Settings + Dashboard 动态化 | 4 | ~2 周 | `2026- garbled-28-phase-6d-login-extensions.md` |
表**依赖链**：

```
6a-1(L0接线) ──→ 6c-1(Roles UI)、6c-2(Users重构)
6a-4(refresh轮换) ──→ 6b-1(SessionManager)
6b-1+6b-2(会话+flow_token) ─喚→ 6b-3(2FA) ──→ 6d-2(WebAuthn)
6b-4(密码管理) ──→ 6c-4(Profile UI)
6a-5(audit接线) ──→ 6c-3(Audit UI)
```

## Phase 6a 任务概要（详见子计划 6a）

1. **L0 插件接线 + roles 路由接通** — app.ts 取消注释修正、roles.ts 5 个 501→接 RoleManager、修复 routes.test.ts 中对应期望
2. **安全中间件链** — @fastify/rate-limit + @fastify/helmet + CORS 白名单（CORS_ORIGINS env）+ 统一错误 envelope 补全（timestamp/requestId/path）
3. **JWT RS256 迄移** — 密钥对生成脚本 scripts/generate-keys.mjs、config 加载 PEM、@fastify/jwt sign/verify 换 RS256、旧 HMAC token 自动失效（迁移说明）
4. **Refresh token 轮换 + 重用检测** — sessions 表加列（refresh_token_hash/device_info/ip_address/revoked_at/used_at）、/refresh 端点重写、重用→全设备吊销
5. **audit_logs 表 + AuditLogger DB 持久化 + 中间件接线** — drizzle schema + AuditLogger.writeToStorage→DB + app.ts 注册 audit middleware
6. **6a 集成收尾** — 全量门禁 + E2E 回归 + 更新 memorys

## Phase 6b 任务概要（详见子计划 6b）

7. **SessionManager 实现** — 补齐 stubs（create/revoke/revokeAll/list/rotate/validate），Redis 缓存 + DB 权威，logout 改为服务端吊销
8. **flow_token 多步认证基座**（new-api 模式） — Redis 存多步认证中间态（TTL 5min），`IssueFlowToken/ConsumeFlowToken`，集成测试覆盖过期/重放
9. **2FA/TOTP** — otplib+qrcode，mfa_recovery_codes 表，/v1/auth/mfa/setup/enable/verify/disable 端点，登录流程插入 2FA 挑战（flow_token 承接）
10. **密码管理** — change-password / reset-password 请求+确认端点，Redis reset token，密码历史检查
11. **账号锁定 + IP 黑名单** — Redis 计数器（D60），登录失败 N 次→锁定，锁定检查在 authenticate 链最前
12. **6b 集成收尾** — 全量门禁 + 2FA E2E（真后端）+ memorys 更新

## Phase 6c 任务概要（详见子计划 6c）

13. **Roles CRUD 页面** — /roles 路由 + ProTable + 权限分配 Transfer 组件 + i18n
14. **Users 页面重构** — Modal→独立路由（/users/create、/users/:id、/users/:id/edit），角色分配表单，批操作，空状态
15. **Audit 日志查看器** — /audit 路由 + 过滤表格 + 导出按钮（CSV）+ 分页
16. **Profile 个人中心** — /profile（资料展示+编辑）+ /profile/password（改密表单，接 6b-4）
17. **快赢集** — 403/404 页 + GlobalErrorBoundary + 空状态组件 + 面包屑
18. **6c 集成收尾** — 前端门禁 4 步 + E2E 回归 + memorys 更新

## Phase 6d 任务概要（详见子计划 6d）

19. **OAuth 社交登录**（arctic 库）— GitHub/Google provider、oauth_accounts 表、state+PKCE、字段映射、绑定/解绑
20. **WebAuthn/Passkey**（@simplewebauthn）— 注册/登录/凭据管理端点，用户下拉菜单入口，依赖 6b-2 flow_token
21. **Settings 页面** — /settings/{general,security} 两 tab，后端 settings API（site 名/logo/策略）+ 前端表单
22. **Dashboard 动态化** — GET /api/v1/stats 端点（用户/角色/登录数、最近活动）+ 前端动态卡片 + 快捷操作
23. **6d 集成收尾 + 项目验收** — 全量门禁 + 全套 E2E + 更新 status.md 到 Phase 6

## 验收门禁（每 Phase 收尾统一执行）

- [ ] `pixi run npx tsc --noEmit` 0 错误（root + admin-ui 两个 tsconfig）
- [ ] `pixi run npx vitest run` 全绿（单元+集成）
- [ ] `pixi run npx playwright test --project=chromium` 全绿（mock E2E）
- [ ] 真后端 E2E（setup/auth-flow/2FA）全绿
- [ ] console 0 应用 error（标准过滤规则）
- [ ] memorys 更新（status.md/decisions.md/pitfalls.md 按需）
- [ ] Phase 6d 收尾追加：status.md 更新为 Phase 6 完成，产出最终人工抽检 checklist 结果
