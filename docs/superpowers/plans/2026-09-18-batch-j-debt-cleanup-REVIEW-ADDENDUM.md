# 批次 J 计划审核修订附录（Review Addendum）

**审核:** 双 Momus 并行（bg_050c86d0 流程正确性 / bg_35a33a9f 阻塞面+爆炸半径），2026-09-18
**结论:** 无维持原样的阻塞项；1 HIGH 前提修正 + 3 MEDIUM/LOW 吸收进计划。

## R1 (HIGH — 前提修正，交叉自 Critic 1)

D3 的前提「静态读码链路闭合」**不成立**。`Login.tsx` auto-approve effect 中 `postInteractionDecision` 返回 `Promise<void>`（api/oidc.ts:18），promise 解包后 `approved` 恒为 `undefined`，`.then((approved) => approved !== undefined && assign(oidcRedirect))` 的续跳**永不执行**——approve 成功后用户卡在 /login，OIDC 登录环在最后一米断裂。既有 e2e「login with valid redirect」走的是表单提交后的 `navigateAfterAuth` 直跳路径（不经过 interaction effect），所以缺陷在绿色套件下存活——正是「测试测不到」家族（batch A/B 审查网同款）。

**处置:** Task 3 从「纯 e2e 加锁」升为「RED 暴露缺陷 → GREEN 一行修复（`return postInteractionDecision(uid, 'approve').then(() => true)`）→ e2e 锁死」。服务端零改动维持。

## R2 (MEDIUM — 双 critic 交叉命中，C1+BC-B2)

Task 1 GREEN 漏了 `scim.ts` GET /Users handler 的 `emailExact` 透传：`filterToQuery` 返回类型需加 `emailExact?: string`，handler L269-275 解包处 + L297 `findAll({...})` 调用点都要带上新键。照原文只改 filterToQuery = emailExact 静默丢失、列表退回全量（RED 会抓到，但白烧一个修复轮）。

**处置:** 计划 Task 1 GREEN 补显式步骤。

## R3 (MEDIUM — Critic 1)

Task 1 RED 的 identity 层「行数据命中/不命中」断言在 mock db 接缝下**不可实现**（`UserManager.test.ts` 的 `chain.where = vi.fn(() => chain)` 不执行 SQL）。行为锁唯一可实现落点 = `scim.test.ts` 路由级两键 mock，且 mock 的 `search` 分支必须忠实建模真 findAll 的 `email OR name ILIKE` 语义（现 mock 只查 email），否则 name 误命中的 RED 不红。

**处置:** 计划 Task 1 RED 改写：identity 层仅留结构 tripwire（where 被调 + 不抛错）；语义断言全部收敛到 scim.test.ts。`lower(email)=` 谓词本身由读码审计 + R-A ponytail 注记背书；首个真 IdP 撞出问题时补 PG-backed 测试（backlog）。

## R4 (MEDIUM — Critic 2 B1)

Task 3 新建 `e2e/oidc-login.spec.ts` = 重复造轮子 + 踩已知陷阱：`/login` 包在 `<GlobalGuard>`（useSetupGuardState）内，新文件漏拷 `mockSetupAndStats` 会渲染 `<SetupGuardRetry/>` 而非登录表单（批 1-3「auth×5 缺 /setup/status mock 债」同款）。`oidc-consent.spec.ts` 已具备全部基建（`seedSession` persist 形状 / `mockInteractionGet` / GET-POST 分流 route / `waitForURL('/oidc/auth/uid-123')` 先例——该先例同时证伪计划 R-B 的哨兵页担忧）。

**处置:** Task 3 改为扩展 `e2e/oidc-consent.spec.ts`（beforeEach 三件套免费继承）；R-B 哨兵方案删除。

## R5 (LOW — Critic 2 B3)

`lower(email)=` 读语义与 SCIM POST 写侧唯一性（`findByEmail` 精确大小写 `eq` + 区分大小写 unique 约束）不对称——库里可同存 `A@x.io`/`a@x.io` 两行，GET 会返回 2 Resources。严格优于现状（ILIKE 全子串），不动代码。**处置:** 并入 R-A 的 `ponytail:` 注释（升级路径：写入侧全量归一 + `lower(email)` functional unique index）。

## R6 (LOW — Critic 1)

计划头「3 任务」实为 4；batch-gate 基线 352/0/7 的**数字**会随新增测试上浮，不变的是语义（0 失败 / PG-down 7 skip）。执行时以语义为准。

## 维持区（审查确认 CLEAN）

- Task 2 SOUNDED（双证）：blast radius 零——MFA 表单渲染只读 `mfaFlowToken`；sessionStorage handoff 读 `mfaFlowToken` 不被擦除；effect 门（L127）在 MFA 挂起期不再被陈旧会话误触发 auto-approve——擦除的**正向安全副作用**，写进测试注释。RED 落既有 `stores/__tests__/auth.test.ts`（`mfaPendingPayload` helper + 三胞胎锁先例）。
- 爆炸半径 CLEAN：`UserQueryParams` 全量调用方 4 处（users.ts 显式白名单解包，`?emailExact=` 无法从 query string 注入）。
- 租户隔离 CLEAN：`findAll` 无条件 `eq(tenantId)`，SCIM tenantId 来自 key 行 + `!tenantId → 500` 门；email 存在性 oracle 限租户内 = SCIM 协议本意。
- email 写路径六处全原样落库（oauth/ldap/saml/admin/CSV/register）——`lower(email)=` 谓词必要性实锤，spec 结论正确。
