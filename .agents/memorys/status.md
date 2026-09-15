# AccessBase 项目状态

**更新日期**: 2026-09-10
**当前阶段**: Phase 8a 完成（UI 速赢包 + RBAC 授权强制接线 + MFA 自助面板，全分支终审通过）+ 用户体验改进轮（创建用户 B 包 + 宽度自适应五连）

## 模块状态

| 模块         | 状态      | 描述                               |
| ------------ | --------- | ---------------------------------- |
| 设计文档     | ✅ v3.0   | 42 章节 + 14 个补充 + 35+ 项目参考 |
| 设计决策     | ✅ D1-D116 | 116 个设计决策                     |
| 包 SDD       | ✅ 8 个   | 所有 L0 包详细设计                 |
| L0 包实施    | ✅ 8 个   | 全部实施完成                       |
| Fastify 服务 | ✅        | REST API + 中间件链                |
| Admin UI     | ✅        | React + Ant Design Pro             |
| 测试         | ✅ 364+80 个 | 364 vitest + 80 E2E chromium（全绿，test.fail 清零） |
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

共 116 个设计决策（D1-D116）

- D1-D80: 原始设计决策
- D81-D95: 从 35+ 项目参考中提炼
- D96-D112: Phase 6 实施（安全基座/会话MFA/登录扩展）
- D113-D115: Setup DB 推导 / RED 回归网法 / 授权强制 requirePermission 路线
- D116: 前端状态栈评审（留 Zustand+RR7 声明式，TQ 缓议；英文决策记录起始）

## 测试覆盖

| 包       | 测试文件                            | 用例数     |
| -------- | ----------------------------------- | ---------- |
| types    | entities.test.ts                    | 8          |
| logging  | logger.test.ts                      | 9          |
| identity | AuthManager/UserManager/RoleManager | 57         |
| health   | service.test.ts                     | 11         |
| audit    | logger.test.ts                      | 10         |
| server   | routes/auth/mfa/oauth/webauthn/stats 等 | 199    |
| **合计** | **37 文件**                         | **364 ✅** |

> 包行系 2026-09-03 快照；Phase 8a 增量在 identity（PermissionManager/authorize）、server（route-guard/seed/me）、admin-ui（errors/sortParams 新纳入）共 +43，见近期工作行。

## 运行模式

| 模式        | 命令                         | 说明              |
| ----------- | ---------------------------- | ----------------- |
| 开发        | `./accessbase.sh dev`        | 后端 + 前端热重载 |
| 测试        | `./accessbase.sh test`       | 364 个测试（vitest）+ 80 E2E chromium |
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
- 2026-09-10: 用户体验改进轮（UserCreate 体验包 B：错误透传/409 高亮/密码策略可视/确认密码/角色三态/路由门 users:write，提交 90c6ae9+0634937；宽度自适应五连：表单卡 flex fit-content 塌陷修复 332→560/三表 scroll.x/Transfer 46%/Login 流宽/UserEdit 三态，提交 ea54c4a；实测矩阵 375-1920 hscroll 归零；e2e 80→84 + 21+7 处 tr 选择器适配 measure-row，PIT-036）
- 2026-09-04: Phase 8a 批二 RBAC 接线（PermissionManager 补实/9 码种子+启动自愈/requirePermission preHandler/me 暴露 permissions+mfaEnabled/前端菜单路由门+403）；真后端 curl 验真 V1-V4 全过（自愈坐实/无角色 403 PERM_001/半权动作粒度 200+403）；vitest 357 + e2e 77 全绿；D115；注：dev DB admin 现为日常态（用户自建邮箱），MFA 端点需 MFA_ENCRYPTION_KEY 未配——见 conventions 批二约束小节
- 2026-09-04: Phase 8a 批三 MFA 自助面板（TOTP 扫码/恢复码一次性/密码关闭，e2e 80，vitest 357）
- 2026-09-04: Phase 8a 终审修复波（PATCH 映射+注册路由覆盖静态锁/PermissionManager 池单例/users-me self-service 豁免/init 去重，vitest 364 两遍全绿）

- 2026-09-10: 架构评审与语言约束（Profile/Settings 720 居中列收尾 77c7e5d；三路调研定 D116：留 Zustand+RR7 声明式守卫、不引入 redux，TanStack Query 按触发条件缓议；design-system SKILL.md 假栈声明清除；新硬约束：提交/注释/架构设计英文、计划与对话中文；PIT-037 Space inline-flex 不受 margin-auto）- 2026-09-10: 设置/资料页宽度终裁改流式全宽（用户实测后推翻 720 居中列：卡片与列表页一致拉伸，卡内表单/Alert 封顶 400 消断层，提交见 git log fix(admin-ui) fluid；偏好已入 conventions 防回改）
- 2026-09-11: 差距修复批 1-3 落地（安全：audit:read/stats:read 权限码 seed 9→11+路由守卫+前端门+landingPath 重定向、JWT_SECRET 生产 fail-fast；体验：删除键尾随逗号、antd locale 绑 i18n+html lang、三详情页 EmptyState 错误态+重试、a11y aria-label×4+autoComplete×7、Roles Transfer 分页全量拉取；文档：ui.md 五处 implementation notes）。13 commits d87ace0..41d4b90，vitest 376/376、tsc/eslint 0、e2e 74 过+13 败（auth×5/dashboard×5 缺 /setup/status mock 债 + health×3 后端未启，checkout 基线 A/B 坐实为预存）。计划 docs/superpowers/plans/2026-09-11-gap-remediation-batch1-3.md（SDD 团队两轮对抗审核+oracle 终审 CLEAN）
- 2026-09-11: 批 4 options 运行时配置中心落地（options 表+OptionsManager 三级优先级 env>option>default 缓存、seed 13 码双注册、/v1/options CRUD+敏感键脱敏+掩码回写拒绝+审计排除、向导成 site.name 首写者+status 解析、Settings Options 页+权限门+e2e 6 例；7 commits 3140a2d..TBD，vitest 396/396、e2e 80 过+13 预存债；SDD 团队审核 7M+6m 全修+1M 终审修，T2/T6 各 1 修复轮）
- 2026-09-12: 批 5 OIDC Provider 落地（oidc-provider 9 挂载 onRequest 劫持+前缀剥离、Drizzle adapter（Client 持久化+瞬时内存 catch-all）、seed 15 码双注册、/v1/clients CRUD 一次性密钥+AES-256-GCM 落库、interaction 契约端点+consent 页+login redirect 门、Clients 管理页+密钥一次性揭示；14 commits 298b75f..HEAD，vitest 437/437、e2e 92 过+13 预存债；安全审查 10 项 1-7 全 PASS+1 MED 挂起请求健壮性 follow-up；T4c 控制器直接实现（3 次子代理中止后用户拍板）、T6 修复轮修 consent-bypass 门控）
- 2026-09-12: MCP 修复 + 三批收官 + 开放项清偿（MCP: playwright/antd devDep 固化+github server 禁用 d87ace0；批 1-3 见上；批 4 options 见上；批 5 OIDC 见上；MED 挂起修复 aa2af2b；预存 e2e 债 13 个清偿 65a2a0d——auth/dashboard 补 GlobalGuard mock、health 条件 skip；终态 vitest 437/437、e2e 102 passed+3 skipped 0 failed；PIT-038/039/040 入库）
- 2026-09-12: 批次 A「P0 安全堵洞+基建解锁」落地（差距分析四路团队报告驱动；主计划 686 行 7 任务 + 审核修订附录 99 行（三路对抗审核 0 违规+5HIGH+7M 全部吸收）；subagent-driven 执行 7 任务全 TDD + 每任务独立审查 + 修复轮闭环 + 终审修复波）。核心：禁用立即生效全链（verifyPassword 前置拒 ACCOUNT_SUSPENDED→login 403 AUTH_004 不计锁→authenticate claim 复查→suspend 吊销全会话→refresh fail-closed 前置门→OAuth/WebAuthn 签发路径同门）；register 501 stub→pending 语义真注册；Mailer 服务+options 表 SMTP 配置+forgot-password 真投递；.env.example 40 键；Redis 收口（getRedis 单例+rate-limit 共享存储 skipOnError fail-open+health 真话）。审查网实绩：T2 totpEnabled 回归（MFA 全局静默失效）、T5 rate-limit 爆炸半径、终审 OAuth/WebAuthn 绕过（推翻早期 safe-bounded 裁定）——三处套件测不到。14 commits 575e4ed..d90631d，终态 vitest 466/466、e2e 104 passed+3 skipped 0 failed、tsc 双闸净
- 2026-09-12: 批次 B「性能+OIDC RP+UI 快赢」落地（spec 9cbe366 + 计划 3171441 + 三路对抗审核附录 R1-R21 fd72b40——6M+6m/3C+3H+4M/PASS 全吸收；subagent-driven 7 任务全 TDD + 每任务审查 + 3 修复轮 + 终审修复波）。核心：B1 权限解析 30s TTL 缓存（零依赖叶子模块 permission-cache.ts 断循环 import）+ 8 处写路径失效接线（矩阵逐行验证）+ RoleManager.findAll N+1 根除；B2 options 驱动通用 OIDC provider（arctic OAuth2Client+PKCE、密钥拆 oauth_<name>_client_secret 掩码键、providers 公开端点、登录页动态按钮零硬编码）；B3 暗色模式（ui-storage persist 仅存偏好、LocaleGate algorithm、data-theme 同步）+ Dashboard 空态 + Users 两态筛选。审查网实绩：T2 终审抓 jsonb 对象 vs JSON.parse 字符串假设（真实配置路径静默失效，测试 seam 字符串直灌掩盖）+ KEY_FORMAT 连字符交叉契约（密钥键写不进去）——两处配置链路端到端缺陷，修复波根因解决（f13e32c/f7ed5fc）。11 commits 9cbe366..f7ed5fc，终态 vitest 491/491、e2e 107 passed+3 skipped 0 failed、tsc 双闸净
- 2026-09-12: 批次 C「管理面功能包」落地（spec bf98357 + 计划 12ba11a + 三路对抗审核附录 R1-R14 a9e819e——cross-checker 1MED / correctness 3M+4m / blockers 6B+3M 全吸收；subagent-driven 7 任务全 TDD + 每任务审查 + 终审修复波）。核心：C1 API Key 全链（api_keys 表 sha256+一次性揭示 ab_35 位、JWT/API-key 双读 authenticate、CRUD 路由+3 权限码 15→18 双注册、管理页）；C2 密码策略 5 维可配（options+env 回退、分调用点默认零破坏、jsonb 双型 seam）；C3 force-logout 路由+行操作；C4/C5 CSV 导出（注入防护）+用户导入两段式（dry-run→commit，落 active）。审查网实绩：迁移链真目录（packages/migration 非 identity）、seed 漏 RESOURCES 数组致 admin 全 403、API key 授权死锁（requirePermission 加 apikey 分支）、密码策略三调用点策略不一致（补第 5 维 special）、终审 jsonb 字符串假设+KEY_FORMAT 连字符交叉契约+apikey 管理面自我增殖（PERM_002 carve-out）。14 commits bf98357..590371f，终态 vitest 561/561、tsc 双闸净、e2e 112 passed+3 skipped 0 failed（执行期间遇限额墙/CPU 过载/socket 断连多次，全部经断点恢复+后台重派消化——PIT-047 纪律生效零同步阻塞）
- 2026-09-15: 批次 D「审计归属修复+LDAP 真实现」落地（spec 8c3ed50 + 计划 553e522 + 三路对抗审核附录 R1-R10 0dc49a0——cross-checker 全过 / correctness 4M+6m / blockers 3H+4M+1LOW 全吸收；subagent-driven 4 任务全 TDD，T1∥T2 并行后台派发零中断）。核心：D1 audit 四处 actor 归属（sub 优先/id 回退/anonymous·unknown·system 分档兜底，终结 CSV 导出全 anonymous）；D2 LdapProvider 真实现（ldapts 9.0 Admin Bind 七步、escapeLdapFilter RFC4515 注入防护 RED 先行、AuthResult 真形 claims 独立接口、AUTH_063/064/065 预留码落位）+ POST /auth/ldap/login（options 五键映射、find-or-provision 路由层供给、毒 getter 结构测试）+ suspended 前置门（对齐 oauth/webauthn 签发同门）+ rateLimit 10/min 对齐。审查网实绩：根 tsc 门禁 9×TS4111（identity 包 tsconfig 不 extends 根配置漏抓 noPropertyAccessFromIndexSignature）、LDAP filter 注入面、签发侧 suspended 门缺失、AuthResult/LdapConfig/ldapts 三处接口现实不符——全部前置拆解或终审捕获。8 commits 8c3ed50..1f05a8f，终态 vitest 598/598、tsc 双闸净、e2e 116 passed+3 skipped 0 failed
- 2026-09-15: 批次 E「MFA step-up 三路对齐」落地（bounded 级：短设计确认 + 66 行计划 b48a443 + 双 Momus 附录 R1-R7 5d473ef——flows 2M+3m / blockers 3H+1H+1M+1L 全吸收；2 任务全 TDD）。核心：WebAuthn select 扩 totpEnabled 列（原投影缺失致分支永假的 R1 缺陷）+ LDAP 200 schema 补 mfaRequired/flowToken（fast-json-stringify 剥字段陷阱 R2）+ OAuth mfaPending 通道（callback 只发 oauth_exchange {userId,mfaPending}，exchange 时现签 mfa_verify——redirect 链零 token）+ 前端 exchangeOAuthCode/Login 两分支（"零前端改动"被双 critic 推翻）+ FlowTokenService 共享 Map stub 测试接缝（R3，跨路由 consume 可断言）+ verify 单门不动（R5）。四签发点（login/ldap/webauthn/oauth-exchange）全同形 {userId}+300s+mfa_verify，PIT-052 矩阵 MFA 列全绿。审查网实绩："无前端改动"前提为假（exchangeOAuthCode 无 mfaRequired 分支会写 undefined token+假认证态）、webauthn 投影缺列、FlowTokenService 跨实例 vitest 不可消费。2 commits 09628be+70c592a，终态 vitest 604/604、tsc 双闸净、e2e 116+3skip 零新失败。发现全 Low：MFA 分支不清旧 token（旧会话复活 wart）/oidcRedirect 死胡同/stub mismatch-burn 偏差——均 backlog 登记
