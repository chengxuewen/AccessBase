# Admin UI 审查修复计划

- 日期: 2026-09-03
- 来源: Web UI 全面审查（静态机械检查 + 4 路 explore 代理交叉验证），发现编号 A1–A5 / B1–B8 / C1–C10 / D1–D4
- 证据基线: `tsc --noEmit` 0 错误；工作区干净；E2E 实际 66 例（chromium 60 + setup-real 6，文档旧值 62 待更新）；本环境 chromium 二进制缺失 → Phase 0 前置 `npx playwright install chromium`
- 硬约束: 只动 `apps/admin-ui/src` 与 `apps/server/src/routes`；不改 `.refinfo/`；禁 `as any`；每步改后跑 typecheck

## Phase 0 实施记录（2026-09-03 已完成・实跑验证）

- chromium 项目 66 用例实跑：**55 passed + 11 expected-fail(RED)，0 unexpected-pass，exit 0**（health/setup-real 项目不在本轮）
- 11 条 RED 逐条核对失败原因均命中目标断言（R2 "observed 5 refresh calls"、R4 "never called POST /auth/logout"、R9 localStorage 含 password 等），非脚手架错误
- T0.4 执行：`e2e/users.spec.ts` 已删，分页用例并入 users-crud；T0.1 console 门激活后已按其真实暴露问题（见实施报告）
- 环境陷阱：本机 `http_proxy` 未配 `no_proxy` 时 Playwright webServer 探活被外网代理 502 卡死 → 跑 E2E 前必须 `export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1`
- RED 用例的 UI 契约（Phase 1-3 实现须满足）：MFA 输入 `[data-testid="mfa-code-input"]`；页内错误 `.ant-alert-error`；反馈 toast `.ant-message-notice-content`；角色编辑须发 `GET /roles/:id`（详情真实字段是 `permissions:[{id,…}]`，非 `permissionIds`）
- 覆盖面：上条 66 用例即 12 个 spec 文件全量（auth-session/settings/auth/setup/users-crud/roles-crud/profile/dashboard/layout/audit-viewer/error-pages/oauth-login）；health（需真后端 5101 直连）与 setup-real 项目留待 Phase 2 验收时随真后端跑
- 执行状态（2026-09-03 实跑）：Phase 1 ✓（66/66）；T2-1 MFA ✓（17/17，R6 转 GREEN）；Phase 3 ✓（T3-1～T3-4 全部落地：密码不入库/错误呈现/当前会话标记+二次确认/站点设置事件实时应用；全量 chromium 69/69 + vitest 314/314 + 前后端 tsc 0）。注：Phase 3 代理因 API 配额断流被 stale 杀掉，但工作树经主编排实跑验证完整，非盲信
- 执行状态续：Phase 2 全部 ✓（T2-2/2-3/2-4/2-5 落地，R8/T0.5 转绿；Agent X 额外修复了并发断流污染的 6 个测试文件）；至此 11 条 RED 全部转正，`grep "^ *test.fail()" e2e/` 归零；基线：vitest 321/321 + chromium e2e 69/69 + 前后端 tsc 0（p4 前实测）
- Phase 4 ✓：lint 0 error（92 warning 均在 packages 既有测试/源码，非 admin-ui）；react-hooks 插件注册，4 处 exhaustive-deps disable 全部以 useCallback 提真修移除（grep eslint-disable = 0）；api/*.ts 全量 ApiEnvelope/PaginatedEnvelope 类型化；CSV 公式注入防护落地；status.md/PIT-030/conventions 同步
- 追加修复（审查遗留项）：C7 侧边栏裸 key（真浏览器快照坐实）→ 菜单名过 t()；C6 sr-only 无 CSS → src/index.css 新增标准工具类；C8 齿轮无标注 → title+aria-label（common.language en/zh）。修复后 chromium 69/69 重跑全绿
- 真后端验收：health 3/3 ✓；setup-real 首跑 T5.1 因本机负载冷 reset 超 180s 预算失败（非回归：快照显示向导全链通过，热重跑 6/6 ✓）；curl 验真：/setup/admin 引导 → login → /auth/me 返回真实 roles:[{id,name}]（T2-4 ✓）→ POST /users {isActive:false, roleIds:[admin]} 持久化且详情回显（T2-2 ✓）。注意：dev DB 已被 setup-real 例行重置，现含 audit-verify@test.local 验证管理员

## 0. 决策点（实施前需用户拍板；默认按"推荐"执行）

| # | 议题 | 推荐 | 备选 |
|---|------|------|------|
| D-1 | A2 反馈可见性方案 | **bridge**：`App.useApp()` 实例经 `<AppBridge>` 存入模块 ref，页面仅改 import 行（7 文件 / 20+ 调用点零改动）；同步更新 conventions.md 措辞 | 全量重写为 inline `<Alert>`（diff 大，布局侵入） |
| D-2 | B1 角色分配 | **server 补齐** `POST/PUT /users` 对 `isActive`/`roleIds` 的支持 | 移除 UserCreate/UserEdit 的角色/状态控件 |
| D-3 | B8 忘记密码/重置 UI | **本期不做**（记入 Deferred） | 本期加页面 |
| D-4 | C5 前端 RBAC 路由门禁（/403 可达） | **本期不做** | 本期做 |

## Phase 0 — E2E 基建修复 + RED 回归网（本计划批准后立即实施，仅动 `e2e/`，不修应用码）

> 原则：每个已知 bug 对应一条可执行回归测试。当前失败的用 `test.fail()` 标注（Playwright 语义：意外通过会报 "Fixed"，提醒删标注）。修复任务完成的判据 = 移除对应 `test.fail()` 后全绿。

### 0.1 基建缺陷修复（应即刻 GREEN）

| ID | 文件:行 | 改动 |
|----|---------|------|
| T0.1 | `e2e/settings.spec.ts:219-236` | console 错误监听器注册从 afterEach 移到 beforeEach（当前是死代码，永不检查测试期错误） |
| T0.2 | `e2e/auth.spec.ts:38,73` | login mock 对齐真实：`expiresIn: 900` + `user: {id,email,name,roles:[]}` |
| T0.3 | `e2e/setup.spec.ts` `/auth/me` mock | 改为裸对象 `{id,email,name,roles:[]}`（与 `routes/auth.ts:234-239` 当前契约一致；T2-4 改信封时再同步） |
| T0.4 | `e2e/users.spec.ts` | 迁移其独有分页用例到 `users-crud.spec.ts` 后**删除该文件**（legacy，断言弱且与 users-crud 重叠） |
| T0.5 | `e2e/users-crud.spec.ts:146-159` | 保留现有 error 用例（接受退化行为=空表），**另加** `test.fail` 用例"500 应显示错误提示/重试 UI"（→ 关联 T2-5 列表页错误处理） |

### 0.2 RED 回归用例（新文件 `e2e/auth-session.spec.ts` + 各页补充）

| ID | 覆盖发现 | 断言（mock 层） | 期望 | 关联任务 |
|----|----------|-----------------|------|----------|
| R1 | A1 | 首个业务请求 401 → `/auth/refresh` 返回信封 `{success,data:{accessToken:t2,…}}` → 重试请求 `Authorization: Bearer t2` 且**停留在已登录页** | `test.fail`（现解包错→登出） | T1-1 |
| R2 | A5 | 同时触发 3 个 401 → 观测到 `/auth/refresh` 请求数 **== 1** | `test.fail`（现并发各刷） | T1-2 |
| R3 | A4 | change-password 成功响应含新 token 对 → 后续请求用**新** accessToken，不登出 | `test.fail` | T1-3 |
| R4 | B2 | 点击登出 → 观测到 `POST /api/v1/auth/logout`（body 含 refreshToken） | `test.fail` | T1-4 |
| R5 | B3 | 应用带 session 加载时 `/auth/me` 返回 500 → 仍在受保护页 + 可见错误提示，**未被登出** | `test.fail` | T1-5 |
| R6 | A3 | login mock 返回 `{mfaRequired:true,flowToken}` → 出现验证码输入 UI；`/mfa/verify` mock 返回 token 对 → 进入 dashboard | `test.fail` | T2-1 |
| R7 | B1 | UserCreate 提交 → 捕获 `POST /v1/users` payload **包含 isActive 与 roleIds**（前端侧契约，server 侧由 T2-2+curl 验证） | GREEN（常规用例） | T2-2 |
| R8 | B7 | 点编辑角色 → 断言发出 `GET /roles/:id`；保存 payload 的 `permissionIds` == 详情返回值（非 `[]`） | `test.fail`（现直接用列表行，必为空→清空权限） | T2-3 |
| R9 | B4 | 向导 AdminStep 填写后刷新 → localStorage `accessbase-setup-store` 序列化 JSON **不含 password 字段**；email 进度仍在 | `test.fail`（现已明文持久化） | T3-1 |
| R10 | B5 | `POST /setup/complete` 返回 500 → CompleteStep 显示错误 Alert，"进入控制台"按钮禁用 | `test.fail` | T3-2 |
| R11 | A2 | 删除用户成功 → `.ant-message` 反馈可见（bridge 修复后由 App context 渲染） | `test.fail`（现静态 message 不挂载） | T1-6 |

**Phase 0 验证**：`npx playwright test --list` 解析通过 → 跑 `settings/auth/setup/users-crud/roles-crud/profile/auth-session` 六个 spec：GREEN 项 0 失败，RED 项全部以 expected-fail 呈现。

## Phase 1 — Auth 链路（文件：`api/client.ts`、`stores/auth.ts`、`api/auth.ts`、`pages/Profile.tsx`、feedback 相关）

| 任务 | 改动 | 验收 |
|------|------|------|
| T1-1 | `client.ts:34` `data.accessToken/refreshToken` → `data.data.accessToken/refreshToken`（+缺 data 防御） | R1 GREEN |
| T1-2 | `client.ts` 模块级 `refreshInFlight: Promise \| null`；并发 401 共享同一次 refresh；失败统一 reject 后 logout | R2 GREEN |
| T1-3 | `api/auth.ts` `changePassword` 返回 `{accessToken,refreshToken}`；`Profile.tsx` 成功后 `setTokens(...)` 再提示 | R3 GREEN |
| T1-4 | `stores/auth.ts` `logout()` → async：best-effort `POST /v1/auth/logout {refreshToken}`（忽略失败）→ 清本地；`AdminLayout.handleLogout` await 后 navigate | R4 GREEN |
| T1-5 | `fetchUser` catch 分类：401（refresh 已失败）→ logout；其余 → `set({error})` 保留 session；AdminLayout 顶栏读 `auth.error` 渲染可重试 inline Alert | R5 GREEN |
| T1-6 | 新建 `src/api/feedback.ts`（module ref + `setFeedback()`）+ `<AppBridge>` 挂到 `<AntdApp>` 内（`App.useApp()` 存入 ref）；7 文件 import 从 `'antd'` 的 message/notification 改为 `api/feedback`；`.agents/memorys/conventions.md` 规则改为"禁静态调用，允许经 feedback bridge" | R11 GREEN |

回归门：`tsc 0` + vitest 无新失败 + 六 spec 全 GREEN（此时 R1–R5、R11 的 `test.fail()` 全部移除）。

## Phase 2 — 数据完整性（server + 表单）

| 任务 | 改动 | 验收 |
|------|------|------|
| T2-1 | `stores/auth.ts` login() 处理 `mfaRequired/flowToken`（不写 token，置 mfa 状态）；`Login.tsx` 增加 TOTP 步骤（验证码 + 恢复码输入，`POST /v1/auth/mfa/verify` → setTokens）；i18n en/zh 补 key | R6 GREEN + 新 vitest（store 分支） |
| T2-2 | server `routes/users.ts`：`isActive` 并入 create/update 处理，`roleIds` 落 RoleManager 关联（确认 UserManager/RoleManager 已有 assign API；schema + handler + 新 server vitest ×3） | R7 + `curl POST /v1/users` 带 roleIds → `GET /v1/users/:id` 返回角色 |
| T2-3 | `Roles.tsx openEdit`：先 `GET /v1/roles/:id`（确认 detail 含 permissionIds；不含则 detail handler 补 join 查询）回填 Transfer 再开 Modal；保存时 `permissionIds` 为空 → 二次确认弹窗 | R8 GREEN |
| T2-4 | server `/auth/me` 与 login：返回真实 `roles:[{id,name}]`（替换硬编码 `[]`，`routes/auth.ts:238`）；顺带统一 `/auth/me` 为 `{success,data}` 信封（C2）；前端 `User.roles` 类型统一 + `fetchUser`/E2E mock（T0.3 产物）同步改 | `curl /v1/auth/me` 非空 + 相关 E2E 无回归 |
| T2-5 | Users/Roles ProTable request 加 try/catch + inline 错误 Alert（对齐 Audit 模式 `.audit-load-error`）+ 空态统一 `EmptyState` | T0.5 新增的 error 用例 GREEN |

## Phase 3 — 安全与向导

| 任务 | 改动 | 验收 |
|------|------|------|
| T3-1 | `stores/setup.ts` partialize 剔除 `formData.admin.password` 与 `config.smtpPassword`（进度保留 email/name；密码重输可接受）；`createAdmin` 成功后立即清 `formData.admin.password` | R9 GREEN |
| T3-2 | `CompleteStep` finalize catch 的 store error 渲染为 inline Alert + 禁用"进入控制台" | R10 GREEN |
| T3-3 | Settings 会话列表标记 current session（server `GET /sessions` 补 `current:true` 或前端按 token 指纹），吊销当前会话需 Modal 二次确认 | 新用例（可并入 T3-3 PR） |
| T3-4 | 站点设置生效：AdminLayout title/logo 读 `SITE_SETTINGS_KEY`（保存即应用）；`General` 表单补 logoUrl 格式校验；保存成功后编辑时清除 `siteSaved` Alert | settings.spec 扩展断言 |

## Phase 4 — 工程门禁

| 任务 | 改动 | 验收 |
|------|------|------|
| T4-1 | 修根 `eslint.config.mjs`：去 `--ext` 用法（flat config files glob）、配 browser/node globals、注册 `eslint-plugin-react-hooks`；处理 4 处 `eslint-disable exhaustive-deps`（Dashboard:59 / Login:44 / Profile:56 / Settings:135）——Phase1/3 修完后据实改 deps 再删注释 | `pnpm lint` 全仓 0 error |
| T4-2 | API 响应类型化：`client` 增加 `ApiEnvelope<T>` helper，`api/*.ts` 逐个去 `any`（auth→users→roles→audit→setup 增量）；根治 D2 类信封错 | tsc 0；新增类型编译期防回归 |
| T4-3 | 文档同步：`status.md`（E2E 计数、Phase 记录）、`pitfalls.md`（PIT-023 补修复记录 + 新 PIT：refresh 信封）、本计划勾选状态 | doc-audit 可查 |
| T4-4 | 顺手项：`api/auth.ts:101` 死代码重复 return 删除（C1）；Audit CSV 对 `=+-@` 开头单元格加 `'` 前缀防公式注入 | grep 验证 |

## Deferred（本期不做，留档）

- B8 忘记密码/重置密码前端页面（server 已就绪）
- C5 RBAC 前端路由门禁 / /403 可达性
- WebAuthn 真实浏览器 ceremony E2E、i18n 切换 E2E、rate-limit 429 UI、Audit 日期范围筛选 E2E、角色搜索/分页 E2E
- OAuth 登录绕过 MFA 的 step-up（DESIGN-1，需产品决策）

## E2E 覆盖矩阵（现状 → 目标）

| 发现 | 现有覆盖 | 动作 |
|------|----------|------|
| A1/A4/A5/B2/B3 refresh 与登出链路 | ❌ 零（E2E 不触发过期） | R1–R5 新增 |
| A2 反馈可见性 | ❌ 测试不查 toast | R11 新增 + T0.1 修复 console 检查 |
| A3 MFA step-up | ❌ 零 | R6 新增 |
| B1 契约 | ❌ mock 无脑兜底 | R7 payload 断言 + T2-2 curl 真实验证 |
| B4/B5 向导安全/错误 | ⚠️ wizard happy-path only | R9/R10 |
| B7 权限回读 | ❌ mock 列表带 permissionIds 掩盖真实缺口 | R8 + mock 改为列表**不含** permissionIds |
| C3 站点设置 | ⚠️ settings.spec 只测 localStorage 写入 | T3-4 扩展 |
| D3 mock 漂移 | — | T0.2/T0.3 |

## 执行顺序与依赖

1. 决策点 D-1…D-4 确认 → **Phase 0**（回归网，独立可先行）
2. Phase 1（T1-1 是一行修复且解锁 15min 会话存活；T1-2 依赖 T1-1；T1-6 独立可并行）
3. Phase 2（T2-1 依赖 Phase 1 完成才有意义；T2-2/3/4 相互独立可并行）
4. Phase 3 并行于 Phase 2 后段；Phase 4 全程可并行
5. 每阶段收口：移除对应 `test.fail()` → 六 spec 全绿 → vitest → tsc → `pnpm lint`（T4 后）

## 总体验收标准

- [ ] `e2e/auth-session.spec.ts` 等所有 RED 标注清除，chromium 项目 0 失败（本机实跑，非声称）
- [ ] setup-real 项目（真后端）无回归：登录 → 15 分钟后仍在会话内（人工或 TTL 缩短验证）
- [ ] `pnpm lint` 全仓通过；admin-ui 纳入 react-hooks 规则
- [ ] curl 验证：users 创建带 roleIds 持久化；/auth/me 返回真实角色
- [ ] vitest 300+ 无新失败；`.agents/memorys`（status/pitfalls/conventions）同步
