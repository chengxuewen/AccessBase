# 批次 J 实施计划 — 清债包

**Spec:** `docs/superpowers/specs/2026-09-18-batch-j-debt-cleanup-design.md`
**日期:** 2026-09-18
**级别:** bounded（三项点位实锤；双 Momus 审核 → 附录 R1-R6 已吸收进本文）
**基线:** master `748fb96` · vitest batch-gate 语义 0 失败/7 skip（数字随新测试上浮）· e2e 123+3skip

## 任务分解（4 任务，T1 ∥ T2；T3 在 T2 落地后执行——e2e 回归须 seeing 同一棵树）

### Task 1 — SCIM userName 精确匹配（后端，D1）

**RED（先行）：**
1. `apps/server/src/__tests__/scim.test.ts`（语义锁唯一落点，附录 R3）：
   - 改 `findAll` mock 为两键忠实建模（PIT-055）：`search` 分支 = email OR name 大小写不敏感子串（与真 findAll 对齐，现 mock 只查 email）；`emailExact` 分支 = email 精确相等（小写值对行 email `.toLowerCase()`）。
   - 改既有 PIT-056 用例断言：`findAll` 收到 `objectContaining({ emailExact: 'hit@x.io' })`（原 `{ search: ... }`）。
   - 新增行为用例：两行数据（email `hit@x.io`；email `partial-hit@x.io-in-name` 且 name=`HIT@X.IO`），GET `filter=userName eq "HIT@X.IO"` → 只返回第 1 行（子串过匹配 + name 误命中双杀，旧实现红）。
2. `packages/identity/src/__tests__/UserManager.test.ts`：结构 tripwire 一条——`findAll({ emailExact: 'A@B.com' }, tenant)` 在 mock 链上 resolve 且 `where` 被调用一次（SQL 语义断言在 mock 接缝不可实现，见附录 R3；`lower(email)=` 谓词由读码审计背书）。

**GREEN：**
3. `packages/identity/src/types.ts`：`UserQueryParams` 增 `emailExact?: string`。
4. `UserManager.findAll`：`emailExact` 存在时 push `sql\`lower(${users.email}) = ${params.emailExact.toLowerCase()}\`` 且不叠加 search 条件；旁挂 `ponytail:` 注释（全表扫上限 + 升级路径 functional index；并列记录写侧唯一性 `findByEmail` 精确大小写不对称分叉，附录 R5）。
5. `apps/server/src/routes/scim.ts`（附录 R2 全链三处）：`filterToQuery` 返回类型加 `emailExact?: string` 且 userName 分支返回 `{ emailExact: normalized }`；GET /Users handler 解包处加 `emailExact = mapped.emailExact`；`findAll({ page, pageSize: count, search, emailExact }, tenantId)` 透传。

**禁改：** `routes/users.ts` 管理端 search 语义、`findByEmail`（登录契约不动）、SCIM POST 唯一性检查。
**验证：** `pnpm --filter @accessbase/identity build`（R-C dist 陷阱）→ server vitest scim.test.ts → `pixi run npx tsc --noEmit` 根闸。

### Task 2 — login MFA 分支旧会话清理（前端，D2）

**RED：** 扩展既有 `apps/admin-ui/src/stores/__tests__/auth.test.ts`（`mfaPendingPayload` helper + 三胞胎 wipe 锁先例，就近加第四支）：预置 token/refreshToken/user/isAuthenticated → `login()` 收 mfaPending → 断言四字段全清 + `mfaFlowToken` 就位 + `isLoading:false`。注释记录正向安全副作用：effect 门（Login.tsx:127）自此不会用陈旧会话 auto-approve OIDC interaction。
**GREEN：** `apps/admin-ui/src/stores/auth.ts` login() mfaPending 分支：`set({ mfaFlowToken: payload.flowToken, isAuthenticated: false, token: null, refreshToken: null, user: null, isLoading: false })`。
**验证：** admin-ui vitest + admin-ui tsc。

### Task 3 — OIDC auto-approve 断裂修复 + e2e 锁（前端，D3，附录 R1/R4）

**背景修正:** 原前提「链路闭合」为假——`postInteractionDecision` 返回 `Promise<void>`，effect 里 `approved !== undefined` 恒假，**approve 后永不 resume**（卡在 /login）。既有 e2e「login with valid redirect」走 `navigateAfterAuth` 直跳路径不经过该 effect，故缺陷存活于绿色套件。

**RED：** 扩展 `e2e/oidc-consent.spec.ts`（不新建文件——`seedSession`/`mockInteractionGet`/GET-POST 分流/`mockSetupAndStats`/`waitForURL('/oidc/auth/*')` 先例全部免费继承，附录 R4）新增 describe「login-prompt auto-approve effect」：
1. 正例：seedSession（token 在 mount 时已存在）→ interaction mock 分方法：GET 返 `{promptName:'login'}`、POST 记调用返 200 envelope → goto `/login?redirect=%2Foidc%2Fauth%2F<uid>` → 断言 POST 被调用 **且 `waitForURL('/oidc/auth/<uid>')`**（当前代码：POST 过、导航永不到 → RED 于导航断言）。
2. 反例：GET 返 `{promptName:'consent'}` → 断言导航到 `/consent?uid=<uid>` 且 POST **零调用**。
**GREEN：** `apps/admin-ui/src/pages/Login.tsx` 一行：`if (details.promptName === 'login') return postInteractionDecision(uid, 'approve').then(() => true);`（`approved !== undefined` 判据随之成立）。服务端零改动。
**验证：** `export no_proxy=...` → `pixi run npx playwright test --project=chromium e2e/oidc-consent.spec.ts` → 该文件全绿。

### Task 4 — 收官回归 + 记忆（控制器自执行）

全量 vitest（batch-gate 语义：0 失败、PG-down 全绿）+ 双 tsc + 根闸 + 全量 e2e（workers=1 低负载窗口）→ status.md 批次 J 记录 + pitfalls（R1 缺陷入 PIT：「void 解包判据恒假」家族）。

## 风险与裁定点（审核后）

- ~~R-B~~ 删除：`waitForURL` 先例已证伪（oidc-consent 既有测试在 5101 停时通过）。
- R-A/R-C：已并入 Task 1 步骤 4/验证行。
- 新增注记：T3 的 e2e 文档导航目标 `/oidc/auth/*` 由 vite SPA fallback 兜住（返回 index.html 即可，断言只看 URL）。
