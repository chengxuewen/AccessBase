# AccessBase 项目状态

**更新日期**: 2026-09-20
**当前阶段**: Phase 8a 完成 + 增强批次 A-N 全部落地（安全堵洞/性能/OIDC RP/API Key/审计+LDAP/MFA 对齐/SAML+Magic Link/多租户/SCIM/SMS OTP/清债/防线/运维P0/多租户控制面/运维剩余/OIDC持久化），详见近期工作尾部

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
- 2026-09-16: 批次 F「SAML SP + Magic Link + 清债」落地（spec 63d636b + 双 Momus 附录 63d636b——3H 双证交叉命中全吸收 R1-R14；6 任务全 TDD + 每任务审查 + 终审 + 修复波 + scoped re-review ALL-ADDRESSED）。核心：F1 SAML SP（node-saml v5.1.0 lazy import R5、5 端点同插件、exchange 通道双变体 payload、ACS 恒 302 零 RelayState 消费 R1/R2、五路限流 R6、ACS 审计排除 R10、InResponseTo:'always' 重放防护终审补）；F2 magic link（request 恒 202 枚举免疫、R13 六链 consume、site.url 三臂 origin 链 R3 含向导 setIfAbsent 写半终审补、R7 per-IP 限流）；F3 清债（三 action MFA 分支 token 卫生三胞胎锁死、oidcRedirect sessionStorage handoff R14 声明序、stub burn-first、env 透传 dev/native/container 三路 R4、audit redact 补 accesstoken/refreshtoken 终审补）。审查网实绩：双 Momus 3H 交叉（ACS 通道自相矛盾/RelayState 开放重定向/site_url 幽灵键）；终审 2+1 Important（InResponseTo 缺失=node-saml 默认 never 可重放、R3 写半丢失、audit token-pair 裸奔——全部修复波清偿）；控制器实测抓 T4 saml/status 探针 16-spec console 净检回归（修复轮 e9dbfd4 per-spec mock B2 先例）。10 commits 63d636b..b157edc，终态 vitest 590/590（+audit）、tsc 双闸+根闸净、e2e 123 passed+3 skipped 0 failed（126 登记，workers=1 低负载窗口权威数）。教训：远程 subagent 会话可落 detached HEAD（修复波 b157edc 曾脱管，控制器 branch -f master 收编）——新 commit 后必查 git branch --show-current
- 2026-09-16: 批次 G「多租户地基」落地（spec a1e3e21 + 双 Momus 附录 R0-R9——5H+4M+1L 全吸收，3H 双证交叉：JWT 无 tenantId claim 前提修正/refresh 漏门/site_url 式清单缺漏；7 任务含 Task 0 地基；subagent-driven 全 TDD + 每任务审查 + 终审 + 修复波 + scoped re-review ALL-ADDRESSED）。核心：tenants 表+迁移三件套（drizzle-kit generate 0002）+TenantManager（TENANT_PROTECTED 软删+缓存失效+默认租户保护）；CRUD+权限码 21 双注册；tenantId claim 六签发点（Task 0）；挂起门 helper 内收敛 4+refresh 门（fail-open 裁定 ACCEPT+findByIdAny 修非 default 租户失效 H1+空洞绿 probe 实测 H2+浏览器通道一致性 M2）；request.tenantId 注入（JWT claim/apikey key-row 双分支 R7）+DEFAULT_TENANT 退役 ~27 处（R3 收敛 grep keep-list 四件套入册 conventions）；前端只读列（失败缓存短路零重试）+7 e2e mocks。审查网实绩：T3 双 HIGH（refresh 门非 default 失效=mock seam 掩盖端到端缺陷 batch-B-T2-jsonb 教训复现 + oauth callback 空洞绿 probe 实测 tenantFindById calls=[]）；终审 1 Important（change-password 重签漏 tenantId——H1 同族）+2 文档（docblock 残渣/期望值翻 21+keep-list 入册）——修复波 7588839 全清偿。11 commits a1e3e21..7588839，终态 vitest 351/1/7（3 预存 PG-down A/B 实证）+identity 240/240、tsc 双闸+根闸净、e2e 123+3skip 0 failed（双 session 互证 workers=1 低负载）。教训：mock findById 忽略 tenantId 参数即 seam 掩盖（tenant-scoped 查询的测试 mock 必须两键建模）；probe 实测（mock 调用计数断言）是空洞绿的最廉价照妖镜；conventions 期望值翻转必须与码数落地同 commit
- 2026-09-16: 批次 H′「清债+测试信号卫生」落地（bounded 级：spec+计划 f4bd335，全部预审事项执行免双 Momus；4 任务串行全 TDD）。核心：T1 测试信号归零（PG probe skipIf 条件跳过 + rate-limit [429,423] 确定性断言——lockoutMaxFailures=5 < rate-limit max=10 根因入注）——四批复发的 A/B 劳动终结，conventions 门禁基线 352/0/7 入册；T2 Host 投毒缓解（TRUST_PROXY 门控 x-forwarded-host + fallthrough 一次性 warn + .env.example 运维注记）+ SMTP fire-and-forget（magic+forgot-password 双站点，枚举时序面持平）；T3 login schema 剥字段实锤（RED 证实 wire user=undefined → schema 补 user 声明 + mock seam 诚实化 verifyPassword 补 name）；T4 卫生清扫 4 done + 2 skip 实证（SAML_003 fold 注释 / R2 expect.poll 去 5s 固定睡 / oauthBusy→authBusy / MagicLogin 403 独立文案）。4 commits f4bd335..6abcc53，终态 vitest 356/0/7（PG down 全绿零失败——信号归零达成）、双 tsc+根闸净、e2e 123+3skip 0 failed。教训：rate-limit 429→423 漂移根因是中间件优先级（lockout 先于 rate-limit 触达），断言应接受全部"受限"状态而非钉死单一码
- 2026-09-16: 批次 H「SCIM 2.0 用户供给」落地（spec cf8eff7 + 双 Momus 附录 R1-R10——3H 双证交叉：scope 隔离机制不存在（requirePermission 不读 key.scopes）+POST 租户归属矛盾+e2e page.route 对 S2S 不可执行；4 任务含 T0 地基；subagent-driven 全 TDD + 每任务审查 + T2 修复轮 + 终审 BATCH-H-APPROVED 零 Critical/Important）。核心：api_keys.scopes 双向隔离（authenticate 读行内 scopes+requirePermission PERM_003 收紧——R1 两处代码变更）；SCIM 协议挂载（scoped scim+json parser 无条件 R5+自有 bearer preHandler 非 app.authenticate+discovery ×3+scoped setErrorHandler M1）；Users CRUD（POST find-or-create 409 uniqueness+密码策略/GET filter push-down+1-based 分页 ceil 校正公式/PUT 全量替换+不可变校验/DELETE 软停用+revoke parity/PATCH Operations 顺序执行+未知 attr invalidPath+fresh-response）。审查网实绩：T2 双 HIGH（PUT 陈旧快照响应 mock 别名掩盖 seam 家族第三例 + 分页映射 brief 0-based 与 findAll 1-based 冲突→ceil 校正公式）均修复轮清偿；终审 backlog 首位=filter userName eq ILIKE 过匹配（需 exact-email manager 方法，首个真 IdP 集成即撞）。8 commits cf8eff7..2a4c737，终态 vitest 416/416+identity 240/240、双 tsc+根闸净、R4 协议面 vitest-only（curl 验真待首批 IdP 集成）。教训：T2 外部 IdP 分页契约（startIndex 1-based 行偏移 vs findAll 1-based 页号）须以 manager 真实 offset 公式为准而非直觉直传
- 2026-09-17: 批次 I「SMS OTP 登录」落地（spec 655d992 + 计划 3c41633 + 双 Momus 附录 R1-R9；3 任务全 TDD + 每任务审查 T1 APPROVED）。核心：T0 SmsProvider 抽象（aliyun|twilio 双实现、凭据 env-only 不入 options 表、sms_provider/sms_sign_name/sms_template_code 键三级优先）+ users.phone 部分唯一索引（migration 0004）+ findByPhone；T1 OTP 请求/验证端点（恒 202 枚举免疫、复用 flow_token mfa_verify 通道对齐 PIT-052）；T2 PIT-052 矩阵扩至八签发点 + 全量回归。5 commits 655d992..181d390，终态 vitest 433 全绿（server 262）、根 tsc 净。backlog：SMS 真投递验真待首批凭据配置；TWILIO_FROM_NUMBER 补入 .env.example 随本记录清偿
- 2026-09-18: 批次 J「清债包」落地（spec fa6bd5e + 双 Momus 附录 R1-R6——1H+3M+2L 全吸收）。核心：J-T1 SCIM userName eq 精确匹配（UserQueryParams.emailExact + lower(email)= 谓词 else-if 抑制 search + filterToQuery/handler/findAll 三点透传，scim.test 两键忠实 mock 锁子串过匹配+name 误命中双杀，H 终审 backlog 首位清偿）；J-T2 login MFA 分支旧会话清零（对齐三胞胎，auth.test 第四支 wipe 锁，正向副作用：effect 门不再被陈旧会话误触发 auto-approve）；J-T3 双 Momus 抓出真缺陷——Login.tsx auto-approve effect 对 postInteractionDecision 的 Promise<void> 解包值做 !== undefined 判据恒假，approve 成功后永不 resume（既有 e2e 走 navigateAfterAuth 直跳路径不覆盖 mount effect，缺陷存活于绿色套件），.then(()=>true) 一行修复 + oidc-consent.spec 扩展两例锁死。执行期发现：StrictMode 双发 mount effect + assign-on-load 竞态→e2e 硬导航断言用 toHaveURL 轮询不用 waitForURL（入 conventions）；pixi node 版本切换后 vite 陈旧 symlink 断 e2e webServer→pnpm install --frozen-lockfile 修复（入 PIT-059）。5 commits fa6bd5e..00b0b5d，终态 vitest 796/796、双 tsc+根闸+eslint 净（2 预存 warning 零新增）、e2e 125 passed+3 skipped 0 failed。教训：PIT-058（void 解包判据恒假）入库
- 2026-09-18: 批次 K「防线批」落地（三路体检驱动（多租户读侧/RBAC 配置面/运维就绪 audit → 用户拍板防线优先）+ spec 1c119a8 + 双 Momus 附录 R1-R7——2 BLOCKER+4M+1L 全吸收）。核心：K-T1 audit/stats 读侧租户隔离（buildWhere 增 tenantId 参数、DEFAULT 见 [t,'system'] inArray 分支否则 eq、list/export 双调用点、stats 四计数+recent 全挂谓词、sessions 经 innerJoin users 归租户，audit-logs/csv-export/stats 三测试文件 + helpers/tenant-where.ts 忠实 SQL 求值 mock）；K-T2 RBAC 护城河——isSystem 死码守卫活化（create input 收 isSystem、init/setup/向导三创建点落 true、selfHealSeed direct-SQL 无租户过滤 stamp UPDATE WHERE name='admin'（R4：不走 manager.update 保幂等））+ last-admin 谓词入共享模块 last-admin-guard.ts（R1 非私有）+ 四道闸全落 manager 漏斗（setUserRoles/revokeFromUser/delete/changeStatus→suspended——R2 BLOCKER 清偿：SCIM 五处直调 changeStatus 同闸，route 级预查方案被否）+ conflict-mapper 共享 409 映射（ROLE_PROTECTED/LAST_ADMIN_GUARD tag，R5 PUT 降权主路径入矩阵）+ R6 伪前提清偿（apiErrorMessage 无 code→key 机制→透传服务端英文 message 不补 locales）；K-T3 Roles 页 isSystem 行锁控件（disabled+LockOutlined）+ roles-crud e2e 局部 route 覆盖两例；K-T4 CORS 生产 fail-fast + R3 BLOCKER 清偿（docker-compose.prod.yml :? 镜像 JWT_SECRET + .env.example 注记——纯 config throw 会 brick 随附生产路径）。执行事故：bg 派发通道 4 次死（quota×3+stale-timeout×1），resume 到已终结任务假续跑（80min 零动静，入 PIT-060），T2/T3 按 H-T4c 先例控制器直接实现；全量 e2e 抓 users-crud 预存竞态 flake（route 标志同步断言抢跑请求，expect.poll 硬化）。7 commits 1c119a8..b34d986，终态 vitest 826/0/7（PG-down 全绿）、双 tsc+根闸净、eslint 改动面 0 error（11 warning 全预存零新增）、e2e 126 passed+3 skipped 0 failed。基线注记：users-crud search 测试在 J 终态亦偶发（A/B 实证预存），本批 poll 修复后转确定绿
- 2026-09-20: 批次 L「运维 P0」落地（三路体检驱动（多租户控制面/RBAC 配置面/运维就绪）→ 用户拍板运维 P0 优先；spec 3c90e64 + 双 Momus 附录——flows 2CRITICAL+2MAJOR+4MINOR / blockers 2BLOCKER+1HIGH+3MED+6LOW 全吸收 R1-R9/B1-B2/H1/M1-M3/L1-L6）。核心：L-T1 scripts/migrate.sh（bash+psql 链应用器，schema_migrations(id,applied_at,note) 追踪表、users 存在+空追踪⇒baseline stamp、stamp 后链尾哨兵 SELECT phone 响亮不阻断、链文件实测 0 DROP 故误 stamp 响亮可恢复、调用方显式链目录 out/ 零依赖、entrypoint/start.sh 删 || true 双接线、Dockerfile COPY migrate.sh+start-period）；L-T2 selfHealSeed 6×5s 有界重试（探针 SELECT 1 FROM permissions 修 flows R1 吞错死环，ensureSeedForAdmin never-throws 契约保留，identity db 新增 WeakMap closeDb 修终审 F2 池泄漏×6）；L-T3 进程防线（index.ts uncaughtException/unhandledRejection→fatal+exit(1)、deploy start.sh 重启环四硬事实 wait||code=$?/.startpid wrapper 先杀/PIDFILE 每轮重写/15s×3 crash-loop 帽[实战触发验证]、NODE_ENV 默认前移使 JWT/ADMIN/CORS pre-flight 真生效）；L-T4 warnDegradedChecks 纯函数 env-only 降级告警（options 表 boot 不可见措辞入册，MFA 行 env-only 真相）；L-T5 CI（e2e job 去服务化=install+browser+vite-only webServer CI 分支[flows R2 递归 watch 饿死修复]+junit 透传保留、coverage 分母修 [node_modules 假 55.46% 根因=exclude 无 **/ 前缀]+实测地板 51.01/76.19/75.05/51.01→阈值 46/71/70/46 drift 0、终审裁定新增 migrate job postgres:16 service+单文件）；T6 实弹全过（fresh deploy 5/5→16 表→RS256 真登录、幂等 0/5、kill -9 复活 PG 存活、复活后 stop 全栈归零、legacy stamped+chain-head 行+exit 0、坏 env 干净拒启、容器 fresh 16+5/重启零重放/migrate.sh 在镜像）。实弹抓出厂缺陷：oidc provider require(ESM) 仅编译后 dist 崩（dev/vitest shim 掩盖+prod-only 路径套件不可达）→静态 import+全仓 eslint no-require-imports error 门禁（PIT-061）。终审 APPROVED-WITH-FIXES：F1 CORS pre-flight 补齐/F2 真路径 pool-end 锁（亲手回归证红）/F4/F5/minor-d 全清。14 commits 3c90e64..0315494，终态 vitest 857/0/11（PG-down）、双 tsc+根闸净、eslint 改动面 0 error（permissions-seed.test 警告 8→7）、e2e 126 passed+3 skipped 0 failed。**开放项（用户拍板）**：origin=Gitee → .github/workflows 从不存在执行环境，本批 CI 线（e2e/migrate/coverage 门）为休眠配置，需 GitHub 镜像或 Gitee Go 方生效（F3）
- 2026-09-20: 批次 L′「多租户控制面」落地（用户拍板开批；spec 5f15d6d+rev.2/3/3.1 吸收双 Momus FLOWS-REJECT+BLOCKERS-APPROVE-WITH-FIXES 与 scoped re-review GAPS×4（G-2 实测定驳保留原文）——核心战果 X1 三步提权链（permissions:read 枚举→roles 绑平台码→自授）与 X2 分区算术 9+9≠21 全在实现前拦截）。核心：L′-T1 identity 加固包（permission-partition.ts 9 bindable/12 platform-only 含 apikeys 裁决、setRolePermissions 绑定漏斗（非 DEFAULT 租户越界 throw PERMISSION_NOT_BINDABLE→409）、checkInheritanceCycle 收 roleId 修真自环/互环漏检、setParent 补 isSystem 守卫、assignToUser onConflictDoNothing、'user_create' 策略档、Tenant.isDefault 投影、seedBuiltinPermissions 拆严格内核 bindPermissions+best-effort 包壳、conflict-mapper 第三 tag）；T2 bootstrap 端点（九步序 belt 首查/默认租户拒启/同租户 email 幂等重放 200/路由层 user_create 策略/无条件 isSystem 直 UPDATE 补 B6 窗/严格绑 9 码先于建用户）+ tenants POST/PUT/DELETE platform belt（'*'-scope apikey 骨架键类闭合）+ force-logout 租户闸；T3 /me 三字段（tenantId/tenantName/tenantIsDefault，getTenantManager 单例 fail-closed）+ AdminLayout 数据驱动 Tag（零前端 UUID 字面量零 locale）；T4 Tenants 管理页+菜单+i18n 43 键+e2e 7 例；T5 roles 收尾（PUT parentId→setParent-先行、parent Select touched-gate、权限计数列、ROLE_INHERITANCE_CYCLE 409）。配额墙屠灭 4/5 派发通道（T4/T5 attempt-3 死前真提交=意外之喜，控制器 T1/T2/T3 直接实现+全数 salvage 审计）。实弹抓出厂缺陷：create 路径漏斗拒绝无路由映射（PUT 有 POST 无）→500，fix 915fdfd+测试锁。9 commits c7b67d1..915fdf0，终态 vitest 914（+57）、双 tsc+根闸净、eslint 改动面 0 error、e2e 137 passed+3 skipped 0 failed（+11）、coverage 门 PASS（51.14/77.56/77.35/51.14 地板升）、V1-V9 curl 真后端电池 11/11（独立库验后销毁）。遗留：租户 admin 自助改密路径未审计（backlog）、Tenants 页 visual-qa 未跑（e2e 已过）
- 2026-09-21: 批次 M「运维剩余」落地（spec de87a23+rev.2 吸收双 Momus——1 BLOCKER（restore 无目标身份回显=擦错库路径）+3 HIGH（dump 含明文 session token 须 0600、/metrics 漏 setup-guard 豁免=每抓取拨 DB+PG-down 门炸、裸奔论据与 JWT fail-fast 相反→warn+cors 守卫）+R1/R3 事实纠偏全吸）。核心：M-T1 health 就绪探针 memoized-promise 池单例+onClose 双复位（修每探针 new Pool 永不关的慢泄漏）；M-T2 prom-client /metrics（accessbase_ 前缀默认指标+duration 直方图 request.routeOptions.url??unmatched+in-flight 对称守卫；fastify-plugin 提升根作用域——封装版只测自己实锤修正；METRICS_TOKEN sha256-timingSafe 403 METRICS_AUTH 统一、Origin 头 404 拒浏览器顺路、setup-guard ALLOWED_PATHS 豁免、路由级 rateLimit:false 免共享 100/min 桶、prod 无 token boot WARN 不 fail-fast 承 K-T4）；M-T3 scripts/backup.sh+restore.sh 挂 accessbase.sh（umask 077/600 机密姿态、URL→PG* env 不上 argv、%XX 解码、identity-echo+键入库名+独立 RESTORE_CONFIRM 三重闸、find 白名单 retention、round-trip 实测+checksum+错误名零写 abort 全验）；M-T4 entrypoint-dev push 响亮化（重试3+显式退出——原 2>/dev/null||echo skipped 吞败=compose dev 死向导根因，rev.1 机制误判修正：compose server 实走 entrypoint-dev）。审查网抓 e2e 5 败（modal-root 断言层级/全局 footer 撞 forceRender 隐藏兄弟/strict cell 撞 slug 复制按钮 accessible-name）→scoped 修复 7/7；dist 冒烟（prod 形态+RS256 fail-fast 咬合现场）histogram route 标签/token 403/origin 404 全过。6 commits 9ce47ae..c5e22e0，终态 vitest 924/0（PG-down 全绿零 A/B 债）、双 tsc 净、e2e 137+3skip 0 fail（6.6m）、coverage PASS 地板升 51.45/77.9。教训：pkill 模式命中派发 shell 自身两次（自杀坑）、@fastify/cors v9 无路由级 cors 类型（Origin-404 等价守卫）、prom-client 默认指标需显式 collectDefaultMetrics 一行。遗留：entrypoint 响亮化无 docker 环境 NOT VERIFIED（机制单点已读码核对）。
- 2026-09-21: 批次 N「OIDC provider 状态持久化」落地（spec/plan 297afdd+rev 修正；双 Momus 再屠：BLOCKERS APPROVE-WITH-FIXES——B1 kind-blind revoke 会杀在飞 Interaction（官方 grantable 集排除 Interaction/Session，kind 作用域修正）、B2 migrate.sh 哨兵对 0005 失明（legacy 卷静默缺表→OIDC 全 500，改 SENTINELS 数组每链文件一探针+测试双断言钉）+B3 行 id=活 opaque bearer token（never-log-id 入册）；FLOWS APPROVE-WITH-FIXES——consume 规范冲突（spec 风险账残留 DELETE 形→统一 UPDATE-mark，重放防御 consumeGrantSource 依赖标记）、$i/$j 标记系我编造（v9 grep 零命中，B8 清文）、v7→9.12.2 实版修正、clockTolerance=0+Interaction.save 必带数值 ttl 实证）。核心：oidc_adapter_state 表（kind,id 复合主键+uid(仅Session)/user_code(lower)/grant_id 派生列+not_after TTL）手工 0005 三件套（partial index 超 0.20 generate 词汇表，snapshot 含 where 防再 generate 漂移）；adapter 重写（memory Map 全灭、upsert ON CONFLICT、find lazy 清理、consume UPDATE jsonb_set、sweepExpired 吞错+5min unref 定时器+stopSweeper→onClose）；provider kindAdapter 转发 kind。跨实例=重启代理证明（真 PG 集成 6 例：verbatim 往返/双实例可见/consume 标记存活/过期 lazy 删/kind-scoped revoke+Interaction 幸存/userCode lower 双向）；oidc-flow 真 PG 全链重跑绿+dist 生产形态冒烟（discovery 200/metrics 88 行）。8 commits 297afdd..本提交，终态 vitest 949（+18：12 单元+6 集成）· 双 tsc · e2e 137+3（server-only 改动零接触面注记）· migrate 链 7/7 幂等+双哨兵。教训 PIT-071~073（哨兵 staleness 家族/consume 语义对等盲区/revoke kind 作用域）。

- 2026-09-23: F3 closed + PIT-076 skill upgrade (user decisions A+A). D122: GitHub mirror exists (Gitee-side one-way sync), ci.yml (YAML-valid, 7 jobs) executes on mirror Actions — green-run pending first push (NOT VERIFIED until then); conventions CI-topology addendum. openspec-propose SKILL.md gained mandatory step 3.5 fact checklist + design.md interface-facts bullet + guardrail (proposals must ship file:line/grep evidence per PIT-076). Known leftover: openspec-propose body still MSRCS-branded (C++/Qt/ROS2 package table, .sisyphus/plans path) — retarget to AccessBase pending user decision. Language policy D121 finalized: English persisted everywhere, chat mirrors user input language.

- 2026-09-23: openspec skill family retired (R0, user-approved; D123). git rm -r of all 8 .agents/skills/openspec-* dirs: the whole chain targets .sisyphus/plans/ (never existed in this repo), 5 bodies carry MSRCS-branded leftovers, 3 others require an uninstalled openspec CLI, and the live proposal pipeline is docs/superpowers specs+plans with dual-Momus review. Reference sites synced: AGENTS.md x2, .agents/AGENTS.md structure block, rules/common/skills-router.md architecture-change edge -> /writing-plans, skill-router SKILL.md design row. Revival path: git revert of the deletion commit, then retarget under real usage pressure (see D123). PIT-076 fact-checklist added earlier today to openspec-propose is retired along with the file it lived in — the discipline itself persists in conventions (设计文档事实纪律) and applies to the live spec pipeline.

- 2026-09-23: Batch O "drizzle toolchain upgrade" landed (spec 2a2ff38+rev.2 dual-Momus R1-R9 absorbed — R1 caught the batch: F4 "up fixes everything" was false, T0 scratch probe killed it before repo changes; +T0 VERDICT section post-review). Core: drizzle-kit 0.20.18→0.31.11 + drizzle-orm 0.29.5→0.45.3 (devDep single source packages/migration, PIT-072 root:230 false-fact corrected), scripts/config to post-0.21 shape (dialect/url, :pg suffixes off — db:push/db:generate/db:migrate npm-script layer untouched), v7 snapshot ritual = up converts 0000-0003 + authoritative-rebuild 0004/0005 (D124: fresh-generate head, uuid chain re-hung, table-qualified where), schema.ts gains canonical phone partial-index declarations + uniqueIndex import. Hand-written-trio workaround RETIRED (generate idempotency proven: zero new files; new chain files may be tool-produced). Gates: double tsc 0 (orm fallout zero), vitest 931/0 (incl. 18 real-PG integration; N-era "949" was a count-rollup artifact — 931 is the authoritative full-run figure), eslint touched-files 0, migrate.sh live-fire fresh 6/6 17 tables/6 tracked + idempotent 0/6 + real-DB indexdef WHERE verified, e2e 137+3 0 failed. Commits: T1a deps+config, T1b snapshots+schema, this record.
