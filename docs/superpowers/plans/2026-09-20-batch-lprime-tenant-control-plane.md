# 批次 L′ 实施计划 — 多租户控制面

**日期**: 2026-09-20
**依据**: docs/superpowers/specs/2026-09-20-batch-lprime-tenant-control-plane-design.md（D1-D6 / 判据 1-7 / 风险账 R-A~F）
**执行方式**: subagent-driven（每任务 brief → 实现 → 独立审查 → 报告），组内并行、组间串行

## 事实基线（本轮核查，HEAD 5cddd20）

| 事实 | 位置 | 结论 |
|---|---|---|
| tenants CRUD 五端点全在（GET/POST/PUT/DELETE + :id GET） | routes/tenants.ts:37-184 | 后端控制面只差 bootstrap |
| routePermissions 最长前缀段裁剪 | authorize.ts:27-28 | `POST:/api/v1/tenants` 自动覆盖 `/tenants/:id/bootstrap`，零映射改动 |
| permissions 表全局无 tenant 列；rolePermissions 绑 | schema.ts:79- | 隔离靠「租户角色不绑平台码」即可闭合 |
| 21 码 seed + seedBuiltinPermissions 全量绑定 | permissions-seed.ts:17-37,68+ | 需第三参 bindNames 收口租户绑定 |
| ensureSeedForAdmin 只给**默认租户** admin 绑 21；stamp 全租户 | permissions-seed.ts:119,123-129 | 租户 admin 角色不会吃到平台码（R-B 已实证安全，仍需测试钉） |
| setup.ts 向导三步模式（role find-or-create → user → assignToUser → seed） | setup.ts:242-302 | bootstrap 的直接参考形 |
| /auth/me 返回无 tenantId/tenantName | auth.ts:377-393 | D4 补两字段 |
| roles PUT body 无 parentId；setParent 已实现（同租户+环检测）；update 拒 isSystem | roles.ts:125-152 / RoleManager.ts:195-235,286+ | D6 路线=update 后条件调 setParent |
| Role.findAll 已批取 permissions[]（B2 成果） | RoleManager mapToRole | 计数列纯前端 `permissions.length` |
| api/tenants.ts 只有 list | admin-ui/src/api/tenants.ts | 补 create/update/delete/bootstrap |
| audit redactFields 递归遮 password | audit/types.ts:149 | bootstrap 体不落密（R-C 实证） |
| 前端路由门形制 | App.tsx:130 `PrivateRoute permission=` | tenants 路由照抄 clients 行 |
| K-T2 isSystem 行锁控件先例 | Roles.tsx（批 K） | 默认租户行锁形制复用 |
| 死岛租户存量 | 无 UI 前手建过 | bootstrap 即 G5 修复路径 |

## 任务分解

### 第一组（文件面互斥，可 4 路并行）

**T1 — seed 分区地基**（identity/server 共享面最小化：只动 permissions-seed.ts + 测试）
- 导出 `TENANT_BINDABLE_PERMISSIONS`（11）/ `PLATFORM_ONLY_PERMISSIONS`（10）两清单 + `seedBuiltinPermissions(db, roleId, bindNames?)` 第三参（缺省 = 现行为全 21，**默认租户路径逐字不变**）。
- 分区不变量单测：两清单不交叠、并集 = BUILTIN 21、名字与 authorize 映射 diff 空（并入既有 conventions 检查命令族）。
- RED→GREEN：bindNames 子集只绑子集；重复调用幂等。
- 判据：`vitest apps/server` 全绿 + 两清单常量被 T2 消费。

**T2 —（第二组，依赖 T1）bootstrap 端点**
- `POST /v1/tenants/:id/bootstrap`（routes/tenants.ts 内加）：门禁=route 层 tenants:write 已覆盖 + handler 内 `request.tenantId === DEFAULT_TENANT` 硬闸（403 TENANT_PLATFORM_ONLY 信封，错误码新建或复用 PERM 族——T2 定，注记 conventions 检查命令不受影响）。
- 六步（spec D2）：租户存在/active → 拒默认租户 409 → email 全局查重 409 → find-or-create 角色 admin(isSystem) → `seedBuiltinPermissions(db, roleId, TENANT_BINDABLE_PERMISSIONS)` → user create（密码策略=users POST 同源函数，禁 inline 字面量）→ assignToUser → 201。
- 测试矩阵（route 层 vitest，mock manager 忠实两键建模——PIT 教训：mock findById 必须带 tenantId 参数）：happy path 全步序断言、五守卫各一、apikey 分支（G batch apikey 路 request.tenantId 来自 key 行——租户 key 打 bootstrap → 403）、**selfHeal 后仍 11 码**（R-B 钉）、幂等重放（二次 409 email-exists，角色/绑定不翻动）。
- 判据：curl 真后端验真（T6 执行）。

**T3 — /auth/me 租户暴露 + 顶栏 Tag（后端+前端一任务闭合）**
- auth.ts /me data 加 `tenantId: user.tenantId ?? DEFAULT_TENANT`、`tenantName`（TenantManager.findById，**失败短路 undefined**——批 G 只读列短路先例，禁 me 因租户查询崩 500）。
- 前端：MeResponse 类型补两字段；`<AppLayout>` 用户区旁 Tag（tenantName 且 !== 'Default' 才渲染）；locales en/zh 一 key；既有 me 消费面（auth store/GlobalGuard mock）同步补字段防 TS 漂。
- 测试：me 路由 test 断言两字段 + tenantName 缺失容错；e2e GlobalGuard mock 族补字段（回归锁）。
- 判据：curl `/auth/me` 见 tenantId/tenantName。

**T4 — Tenants 管理页**
- api/tenants.ts 补 createTenant/updateTenant/deleteTenant/bootstrapTenant；pages/Tenants.tsx（Clients/ApiKeys 五件套形制 + K-T3 LockOutlined 默认租户行锁）；App.tsx 路由 `tenants` + PrivateRoute `tenants:read` + 菜单项（TeamOutlined）；locales 成对。
- 列：name/slug/status Tag/createdAt/操作；动作：Init admin 模态（email/name/password + 密码策略提示复用 UserCreate 组件形制、错误 inline Alert data-testid、409 高亮——批 UserCreate B 包先例）、Edit（name/slug）、Suspend/Activate、Delete confirm（软删文案注明 suspend 语义）。
- 行操作路由门：无 tenants:write 隐藏写动作（复用 usePermission 族现成 hook——T4 自查）。
- e2e：`e2e/tenants-crud.spec.ts` 局部 page.route 六例（列表/创建/init-admin 模态流/suspend/默认租户行锁/错误态 409）——route 标志断言用 expect.poll（K 批约束）。
- 判据：visual-qa 一轮（列表+两模态截图对 Clients 形制）。

**T5 — RBAC 三小收尾**
- roles.ts PUT schema+handler：`parentId?: string | null`，present 时 update 后调 `setParent(id, parentId ?? null, tenant)`（ROLE_PROTECTED/环 → 既有 sendConflictError 409 族）；测试三支（持久化/null 解除/isSystem 拒）。
- Roles.tsx：模态 parent Select（选项=当前租户 roles 排除自身，数据源复用列表 state 零新端点；isSystem 行整行锁已存在→parent 编辑随锁不可达）；列表 permissions 计数列 `permissions?.length ?? 0`。
- e2e：roles-crud spec 扩 parent 选择 + 计数渲染两例。
- 判据：curl PUT parentId 后 GET /roles/:id 见 parent；环 409。

### 第二组（串行收尾，控制器亲执）

**T6 — 真后端验真 + 全量门禁**
- reset:native（或独立库）→ 向导 → curl：建租户→bootstrap→新 admin 登录→`/auth/me` 11 码无 tenants:*/options:*/clients:*/permissions:write→该 admin 打 POST /v1/tenants 得 403→users POST 建租用户→租 admin 自见列表仅本租户。V1-V6 记录进 execution-log。
- vitest 全量 / 双 tsc / eslint 改动面 / e2e workers=1 权威数 / coverage 门。
- 记忆收口（status/conventions/pitfalls/decisions 按需）。

## 并行组与派发

- 组一：T1 ∥ T3 ∥ T4 ∥ T5（四路后台，文件面互斥矩阵：seed / auth.ts+Layout / pages+App.tsx+api/tenants+e2e / roles.ts+Roles.tsx——App.tsx 仅 T4 触碰）
- 组二：T2（吃 T1 产物；与 T3/T4/T5 无交集亦可先行派发但 brief 依赖 T1 常量名，**必须**T1 绿后）
- 组三：T6 控制器
- 每任务：独立审查员（spec-conformance + code-quality 合一，批 L 形制）；审查发现 Critical/Important → 修复轮 → scoped re-review。

## 门禁基线期望

- vitest：857 起步，T1-T5 预计 +25~35（终数审查后定）
- e2e：126+3skip 起步，+8~10（workers=1 权威）
- 权限码期望值不变（21）；conventions 检查命令 1 计数不动
- DEFAULT_TENANT keep-list 不动（bootstrap 的 DEFAULT_TENANT 引用走 constants.ts import；**检查**：新文件不得出字面量）

## 风险与预防（承 spec 风险账）

- R-A 分区漂移 → T1 不变量测试 + 检查命令并入 conventions
- R-E apikey 分支 → T2 测试矩阵强制两分支
- R-F 密码策略调用点 → T2 brief 钉死「users POST 同源函数名，禁字面量复制」
- e2e mock 漂移 → T3/T4 brief 要求从 routes 实际返回拷贝（PIT-033 纪律）
- 「me 加字段打炸 GlobalGuard mock 族」→ T3 任务内含 mock 全扫（grep -l auth/me e2e/）

## 完成判据

spec §5 七条全过 + T6 execution-log 落 docs/superpowers/plans/ 本文件尾部「执行记录」节 + 记忆四件套。
