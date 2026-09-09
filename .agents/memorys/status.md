# AccessBase 项目状态

**更新日期**: 2026-09-03
**当前阶段**: Phase 7 完成（Admin UI 审查修复：envelope 类型化/单飞刷新/feedback bridge/lint 门禁）

## 模块状态

| 模块         | 状态      | 描述                               |
| ------------ | --------- | ---------------------------------- |
| 设计文档     | ✅ v3.0   | 42 章节 + 14 个补充 + 35+ 项目参考 |
| 设计决策     | ✅ D1-D112 | 112 个设计决策                     |
| 包 SDD       | ✅ 8 个   | 所有 L0 包详细设计                 |
| L0 包实施    | ✅ 8 个   | 全部实施完成                       |
| Fastify 服务 | ✅        | REST API + 中间件链                |
| Admin UI     | ✅        | React + Ant Design Pro             |
| 测试         | ✅ 321+69 个 | 321 vitest + 69 E2E chromium（全绿，test.fail 清零） |
| Docker       | ✅        | 多阶段构建 + 3 种运行模式          |
| CI/CD        | ✅        | GitHub Actions                     |
| 构建模式     | ✅ 4 种   | native / container / compose / deploy |
| Auth         | ✅        | login / me / logout / refresh + refresh 轮换/重用检测 |
| 安全中间件   | ✅        | rate-limit + helmet + CORS 白名单 + 完整错误 envelope |
| JWT          | ✅        | RS256（未配密钥回退 HMAC） |
| 审计         | ✅        | audit_logs 表 + 中间件接线 + AuditStorage 注入 |
| MFA         | ✅        | TOTP + 恢复码 + flow_token step-up |
| 锁定        | ✅        | 5次/15分钟 + IP 黑名单 + 密码历史 |
| 核心页面     | ✅        | Roles/Users/Audit/Profile + 403/404 + 布局 |
| OAuth/WebAuthn | ✅     | GitHub/Google OAuth + Passkey 用户名无发现登录 |
| Settings     | ✅        | 会话管理/Passkey管理/站点信息      |
| Dashboard    | ✅        | 动态统计+最近活动+快捷操作         |

## 代码结构

```
packages/              # 8 个 L0 包
├── types/             @accessbase/types (4 files)
├── logging/           @accessbase/logging (1 file)
├── i18n/              @accessbase/i18n (4 files)
├── migration/         @accessbase/migration (5 files)
├── health/            @accessbase/health (5 files)
├── identity/          @accessbase/identity (13 files)
├── audit/             @accessbase/audit (4 files)
└── admin/             @accessbase/admin (6 files)

apps/
├── server/            Fastify 服务 (7 files)
└── admin-ui/          React 前端 (14 files)

docs/
├── modules/           31 个设计文档 + 8 个 SDD
├── reference/         9 个参考调研文档
└── implementation-plan.md
```

## 设计决策汇总

共 112 个设计决策（D1-D112）

- D1-D80: 原始设计决策
- D81-D95: 从 35+ 项目参考中提炼
- D96-D112: Phase 6 实施（安全基座/会话MFA/登录扩展）

## 测试覆盖

| 包       | 测试文件                            | 用例数     |
| -------- | ----------------------------------- | ---------- |
| types    | entities.test.ts                    | 8          |
| logging  | logger.test.ts                      | 9          |
| identity | AuthManager/UserManager/RoleManager | 57         |
| health   | service.test.ts                     | 11         |
| audit    | logger.test.ts                      | 10         |
| server   | routes/auth/mfa/oauth/webauthn/stats 等 | 199    |
| **合计** | **31 文件**                         | **321 ✅** |

## 运行模式

| 模式        | 命令                         | 说明              |
| ----------- | ---------------------------- | ----------------- |
| 开发        | `./accessbase.sh dev`        | 后端 + 前端热重载 |
| 测试        | `./accessbase.sh test`       | 321 个测试（vitest）+ 69 E2E chromium |
| 构建        | `./accessbase.sh build`      | 构建所有包        |
| Docker 开发 | `./accessbase.sh docker:dev` | PG + Redis 分离   |
| Docker 生产 | `./accessbase.sh docker`     | 单容器 all-in-one |

## 近期工作

- 2026-08-21: Phase 0-4 基础设施 + L0 包 + Fastify + 测试 + UI + Docker
- 2026-08-26: Setup wizard E2E 测试（7 个测试用例，覆盖 7 个 bug）
- 2026-08-26: 三种构建模式（native/container/compose）+ CLI 命令
- 2026-08-27: Deploy 模式（build/start/stop/reset/status/logs）
- 2026-08-27: Auth 端点接通（login/me/logout/refresh）
- 2026-08-27: Admin 自动创建 + setup 状态管理
- 2026-08-27: 用户 CRUD（后端 7 API + 前端 UI + E2E 3/4 通过）
- 2026-08-27: axios 双层解构修复 + isAuthenticated 持久化 + PrivateRoute token 检查
- 2026-08-27: E2E 测试策略决策（mock API vs 真后端）
- 2026-08-31: Phase 6a 安全基座（6 任务，167 测试，E2E 0 新失败，D110/PIT-022）
- 2026-08-31: Phase 6b 会话+MFA 基座（SessionManager缓存/FlowToken/TOTP/密码管理/锁定，236 测试）
- 2026-08-31: Phase 6c 核心页面（Roles/Audit/Profile/Users重构/错误页/布局，47 E2E，PIT-023）
- 2026-08-31: Phase 6d 登录扩展（OAuth GitHub/Google + WebAuthn passkey + Settings 页 + 动态 Dashboard，300 vitest + 62 E2E，D109/D112，验收清单 docs/superpowers/plans/2026-08-31-phase6-acceptance-checklist.md）
- 2026-09-01: Setup 统一化（setup 状态 DB 推导 D113 / init.ts 收缩 + env 双变量旁路 / reset 天然回向导 PIT-027；vitest 0 新失败 / E2E 无回归）
- 2026-09-02: Guard 容错修复（backend-down 三态+自动重试 / dev trap 不停 infra + infra 复用 / PIT-028 vite 模式补刀 + PIT-029；E2E +T5.4，基线无回归）
- 2026-09-03: Phase 7 Admin UI 审查修复（refresh 单飞+信封单层解包 PIT-030 根治 / feedback bridge / MFA step-up UI / 向导密码不落 persist / roles hydrate 修复 / /auth/me 信封+真实 roles；lint 门禁修复：flat config 关 no-undef + react-hooks error/warn、4 处 disable 真修 deps；E2E chromium 69（+11 净新回归锁），test.fail 全清）
- 2026-09-03 收口：真后端验收 setup-real 6/6 + health 3/3（首跑 T5.1 冷 reset 超 180s 为负载现象非回归）；curl 验真 T2-2（isActive+roleIds 持久化）/T2-4（真实角色）；追加修 C6 sr-only/C7 菜单裸 key/C8 齿轮标注；教训沉淀 D114 + PIT-031~033；注：dev DB 现为 setup-real 重置后验证态（admin=audit-verify@test.local），恢复日常用 reset:native 重走向导
- 2026-09-04: Phase 8a 批一 UI 速赢包（apiErrorMessage 错误族/语言持久化+探测/状态三修/假排序+行操作/杂项5连，e2e 69→74 全绿）
