# Phase 8a 实施计划：UI 速赢包 + 授权强制接线 + MFA 自助面板

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 偿还 UI 审查 45 项中的 TOP-10+根因族，接通 G1 授权强制链（后端→/auth/me→菜单/路由门），补 U2/G1' MFA 自助面板。

**Architecture:** 三批独立交付：批一纯前端速赢（零后端改动）；批二授权强制采用 `requirePermission` preHandler 工厂（**不**启用 identityPlugin——其 authenticateHook 与已验证的 app.authenticate 单飞链冲突）；批三 MFA 面板为纯贴皮（后端 setup/enable/verify/disable 全就绪）。

**Tech Stack:** TypeScript / Fastify / Drizzle / React + AntD / Zustand / Vitest / Playwright

**Spec:** `.omo/reports/gap-ui-2026-09-04/FINAL.md`（缺口来源）+ `.omo/reports/gap-2026-09-04/SYNTHESIS.md`（功能 G1）+ `docs/modules/identity-sdd.md` §3.2-3.3（权限语义）

**⚠ 架构决策点（审核时请裁决）：** identity-sdd §3.3 的路线图是"启用 identityPlugin 全局 hook"，但实测 plugin.ts 的 authenticateHook 会与 app.ts:109 `app.authenticate`（Phase 7 单飞刷新验证链）双重验签且响应形不一致。本计划改走**最小侵入**：保留 app.authenticate 唯一验签入口，路由级 `requirePermission` preHandler 强制。authorize.ts 的权限映射表**保留为单一事实源**（导出复用，修掉 :id 路径匹配 bug）。若不同意此偏离，请改判方案 B（重构 plugin 删 authenticateHook）。

## Global Constraints

- 禁 `as any` / `@ts-ignore` / `@ts-expect-error`
- 信封：server 端点 `{success,data}`；前端 `client.get<ApiEnvelope<T>>` 泛型（Phase 7 门禁）
- toast 一律经 `src/api/feedback.ts` bridge；禁 `import { message } from 'antd'` 静态用法
- persist 禁存密码/密钥类
- 跑测试前 `export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1`
- 每任务收尾：`pixi run npx tsc --noEmit`（相关工程）0 错误；批末全量 vitest + `npx playwright test --project=chromium` 0 新失败
- commit 格式 `<type>: <desc>`；lockfile 随依赖变更
- 权限码格式以 authorize.ts 现有为准：`users:read` / `users:write` / `users:delete` / `roles:*` / `permissions:*`

## 文件结构（新增/修改总览）

```
apps/server/src/
  routes/users.ts roles.ts permissions.ts   # 修改：挂 requirePermission
  routes/auth.ts                            # 修改：/me 加 permissions+mfaEnabled；setup/init 种权限
  utils/permission.ts                       # 新建：preHandler 工厂（从 authorize.ts 导出的映射）
packages/identity/src/
  hooks/authorize.ts                        # 修改：导出 getRequiredPermission + 参数化路径匹配修复
  managers/PermissionManager.ts             # 修改：补实 6 桩方法
  __tests__/PermissionManager.test.ts       # 新建
apps/admin-ui/src/
  api/errors.ts                             # 新建：apiErrorMessage()
  api/mfa.ts                                # 新建
  i18n/index.ts                             # 修改：lng 探测+持久化
  stores/auth.ts                            # 修改：permissions/mfaEnabled + hasPermission
  layouts/AdminLayout.tsx                   # 修改：菜单过滤/fetchUser/persistCollapsed/双登出/语言按钮
  App.tsx                                   # 修改：PrivateRoute permission + 语言接线
  pages/{Users,Roles,Audit,Dashboard,Profile,Settings}.tsx + users/{UserEdit,UserDetail}.tsx
  pages/setup/steps/{WelcomeStep,AdminStep,ConfigStep}.tsx
  i18n/locales/{en,zh}.json                 # 修改：新 key 双语对称
e2e/
  ui-quality.spec.ts  auth-rbac-ui.spec.ts  mfa-panel.spec.ts   # 新建
```

---

## 批一：UI 速赢包（TOP-10 + 两根因族）

### Task 1: apiErrorMessage helper + 错误文案族（FO-1/FO-3/FO-7/FO-8/FE-4）

**Files:**
- Create: `apps/admin-ui/src/api/errors.ts`
- Modify: `pages/Login.tsx:83-93`, `pages/users/UserEdit.tsx:25`, `pages/users/UserDetail.tsx:20`, `pages/Users.tsx:63-64`, `pages/Roles.tsx:74-75`, `pages/Profile.tsx:85-104`, `pages/setup/steps/AdminStep.tsx:44-47`, `pages/setup/steps/ConfigStep.tsx:38-41`
- Test: `apps/admin-ui/src/api/__tests__/errors.test.ts`

**Interfaces:**
- Produces: `apiErrorMessage(err: unknown, fallback: string): string` — 从 axios 错误提取服务端信封 `response.data.error.message`，无则 fallback。

- [x] **Step 1: 写失败测试**

```typescript
// api/__tests__/errors.test.ts
import { describe, it, expect } from 'vitest';
import { apiErrorMessage } from '../errors';
import { isAxiosError } from 'axios';

describe('apiErrorMessage', () => {
  it('extracts server envelope message from axios error', () => {
    const err = { isAxiosError: true, response: { data: { error: { message: 'Role name already exists' } } },
      toJSON: () => ({}) } as unknown as Parameters<typeof isAxiosError>[0];
    expect(apiErrorMessage(err, 'fb')).toBe('Role name already exists');
  });
  it('falls back when no envelope message', () => {
    expect(apiErrorMessage(new Error('Request failed with status code 401'), 'fb')).toBe('fb');
  });
  it('falls back on 429 with hint key handled by caller', () => {
    const err = { isAxiosError: true, response: { status: 429, data: {} }, toJSON: () => ({}) };
    expect(apiErrorMessage(err as never, 'fb')).toBe('fb');
  });
});
```

- [x] **Step 2: 跑测确认 FAIL**（`pixi run npx vitest run src/api/__tests__/errors.test.ts`，cwd=apps/admin-ui）
- [x] **Step 3: 实现**

```typescript
// api/errors.ts
import { isAxiosError } from 'axios';

/** 从任意 catch 值提取服务端信封 error.message；无则返回 fallback。
 *  调用方对 401/429 可先查 apiErrorStatus() 做专门文案。 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) {
    const msg = (err.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
  }
  return fallback;
}

export function apiErrorStatus(err: unknown): number | undefined {
  return isAxiosError(err) ? err.response?.status : undefined;
}
```

- [x] **Step 4: 接线（机械替换，逐点）**
  - FO-7 两处 key 错位：UserEdit.tsx:25 的 `users.updateError` 与 UserDetail.tsx:20 的 `users.deleteError`（加载失败弹错动作文案）均→`users.loadError`（key 已存在 locales:112）；同点对 `.catch(() => ...)` 改为 `.catch((err) => message.error(apiErrorMessage(err, t('users.loadError'))))`
  - Users.tsx:63-64、Roles.tsx:74-75、Profile 更新路径、Settings 各 catch：fallback 保持现有 t() key，前置 `apiErrorMessage(err, …)`
  - Login.tsx:83-93：`loginError` 布尔改为存 `apiErrorStatus`，429→`t('login.tooManyRequests')`、锁定信封→透出服务端 message；新增两 locale key（en/zh 对称：`login.tooManyRequests` = "Too many attempts, try again later"/"尝试过于频繁，请稍后再试"）
  - AdminStep/ConfigStep 向导：description 用 `apiErrorMessage(err, '')`，空串时不渲染 description（FO-8）
- [x] **Step 5: FE-4 改密成功反馈** — Profile.tsx:96（`pwdForm.resetFields()` 后）加 `message.success(t('profile.passwordChangeSuccess'));`（孤儿 key 接线，en/zh 均已有）
- [x] **Step 6: vitest 全绿 + tsc 0 错**
- [x] **Step 7: Commit** `fix(admin-ui): apiErrorMessage 收敛错误文案族（FO-1/3/7/8 + FE-4）`

### Task 2: 语言持久化 + 探测 + 英文孤串（I18-1/I18-3/I18-4）

**Files:**
- Modify: `i18n/index.ts:11`, `layouts/AdminLayout.tsx:66-69`, `pages/Dashboard.tsx:30-38`, `App.tsx:34`
- Test: `e2e/ui-quality.spec.ts`（新建，本任务起）

**Interfaces:**
- Produces: localStorage key `'lng'`；`i18n.t` 相对时间；后续任务共用。

- [x] **Step 1: i18n 初始化改**

```typescript
// i18n/index.ts —— 替换 lng: 'en'
const probed = typeof navigator !== 'undefined' && navigator.language.startsWith('zh') ? 'zh' : 'en';
const stored = (typeof localStorage !== 'undefined' && localStorage.getItem('lng')) === 'zh' ? 'zh'
  : (typeof localStorage !== 'undefined' && localStorage.getItem('lng')) === 'en' ? 'en' : probed;
i18n.use(initReactI18next).init({ resources: { en: { translation: en }, zh: { translation: zh } },
  lng: stored, fallbackLng: 'en', interpolation: { escapeValue: false } });
```

- [x] **Step 2: 切换即持久化** — AdminLayout.tsx:66-69 `toggleLanguage`：`i18n.changeLanguage(next)` 后加 `localStorage.setItem('lng', next);`
- [x] **Step 3: Dashboard 相对时间** — 删自研 `relativeTime`（:30-38），改：

```typescript
const relTime = (ts: number | string) => {
  const diffMin = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
  if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, 'minute');
  return rtf.format(-Math.round(diffMin / 60), 'hour');
};
```

- [x] **Step 4: 英文孤串** — App.tsx:34 `Connecting to server…` → `t('common.connecting')`（SetupGuardRetry 组件内 useTranslation；key 新增双语："正在连接服务器…"/"Connecting to server…"）；GlobalErrorBoundary.tsx:34,38 文案接 i18n（import i18n 用 `i18n.t('common.errorTitle'/'common.retry')`，按钮 `handleRetry` 改 `location.reload()`，key 双语新增）
- [x] **Step 5: E2E 锁**（新建 `e2e/ui-quality.spec.ts`，沿用现有 mock 登录 fixture 模式）：

```typescript
test('语言切换后刷新保持中文（I18-4）', async ({ page }) => {
  await loginWithMock(page); // 拷现有 spec 的 mock 登录 helper
  await page.getByTestId('lang-toggle').click();
  await expect(page.locator('.ant-layout-sider')).toContainText('用户管理');
  await page.reload();
  await expect(page.locator('.ant-layout-sider')).toContainText('用户管理');
});
```

（需给语言按钮加 `data-testid="lang-toggle"`——同任务内加）
- [x] **Step 6: vitest/tsc + 单跑该 spec 绿**
- [x] **Step 7: Commit** `fix(admin-ui): 语言探测+持久化，相对时间接 Intl（I18-1/3/4）`

### Task 3: 状态与数据加载修复（ST-1/ST-2/ST-3）

**Files:**
- Modify: `layouts/AdminLayout.tsx:40-50`（mount fetchUser）, `pages/Dashboard.tsx:61-99`（卡片 loading）, `pages/Roles.tsx:152-164`（try/catch+error Alert）
- Test: `e2e/ui-quality.spec.ts` 追加

**Interfaces:**
- Consumes: `stores/auth.ts fetchUser`（已有，Phase 7）。

- [x] **Step 1: fetchUser 上布局** — AdminLayout 加 `useEffect(() => { if (token) void fetchUser().catch(() => {}); }, []);`（token 从 store 取；仅 mount 一次，勿进依赖数组造成循环——fetchUser 引用稳定则 `[]`+eslint-disable 不允许，改写为把 fetchUser 存 ref 或确认 store action 引用恒定后用 `[fetchUser]`）。验收：mock `/auth/me` 改名 → 硬刷新头部用户名跟变
- [x] **Step 2: Dashboard 假零值** — cards 数组渲染处：`<Statistic value={…} loading={loading} />`（antd Statistic 原生 loading prop），去掉 `stats?.users ?? 0` 的 ?? 0 兜底（loading 时不显示数字即无需兜底值）
- [x] **Step 3: Roles request 补错态** — 抄 Users.tsx:105-124 模式：try/catch + `setLoadError(true)` + 表上方 `<Alert type="error" showIcon message={t('roles.loadError')} action={<Button size="small" onClick={() => actionRef.current?.reload()}>{t('common.retry')}</Button>} data-testid="roles-load-error" />`（`roles.loadError` key 双语新增，若无则用现有）
- [x] **Step 4: E2E**：mock `/v1/stats` 延迟 300ms → 首帧断言 `.ant-statistic-content` 内不出现 `0`；mock roles 列表 500 → `roles-load-error` 可见
- [x] **Step 5: 全绿 + Commit** `fix(admin-ui): mount fetchUser + 统计卡 loading + Roles 错态（ST-1/2/3）`

### Task 4: 假排序修复 + 行操作可达性（TA-1/AC-1）

**Files:**
- Modify: `pages/Users.tsx:21-50,105-113`（sorter 映射 + `<a>`→`<Link>`/`<Button type="link">`）, `pages/Roles.tsx:119,137`
- Test: vitest 单元（排序参数映射纯函数）+ e2e

- [x] **Step 1: 提取纯函数并写失败测试**

```typescript
// pages/users/sortParams.ts
export function mapSort(sort: Record<string, 'ascend' | 'descend' | undefined> | undefined):
    { sortBy?: string; sortOrder?: 'asc' | 'desc' } {
  const entry = Object.entries(sort ?? {})[0];
  if (!entry) return {};
  return { sortBy: entry[0], sortOrder: entry[1] === 'ascend' ? 'asc' : 'desc' };
}
```

测试：`mapSort({name:'ascend'})` → `{sortBy:'name',sortOrder:'asc'}`；`mapSort(undefined)`/`mapSort({})` → `{}`；两键取第一。
- [x] **Step 2: Users.tsx request 中 `...rest` 前显式展开 `...mapSort(params.sort)`，并从 rest 中排除 sort**（`const { current, pageSize, name, sort, ...rest } = params`）
- [x] **Step 3: AC-1** — Users.tsx 名称列 `<a onClick=…>` → `<Link to={…}>`（react-router）；操作列三个 `<a onClick>` → `<Button type="link" size="small">`；Roles.tsx:119,137 同
- [x] **Step 4: E2E**：点击 name 表头 → 断言请求 URL 含 `sortBy=name&sortOrder=ascend→asc`（`page.on('request')` 捕获）；键盘 Tab 序列可 focus 到行操作按钮
- [x] **Step 5: 全绿 + Commit** `fix(admin-ui): 表头排序接线 sortBy/sortOrder + 行操作键盘可达`

### Task 5: 杂项快修包（NA-4/FE-1/FE-2/AC-3/I18-5）

**Files:**
- Modify: `layouts/AdminLayout.tsx`（persistCollapsed prop、删 actionsRender 裸登出、语言按钮 `GlobalOutlined`+当前语言文本+`data-testid` 保留）, `#999` 四处（`Users/Audit` 无关；AdminLayout.tsx:113、Profile.tsx:227、Settings.tsx:155,201 → `<Typography.Text type="secondary">`）, `api/setup.ts:54-59 + pages/setup/steps/WelcomeStep.tsx:34-37,112`（检查项 label：`{database:'setup.checkDatabase', redis:'setup.checkRedis', …}[c.name] ?? c.name`，模式同旁 recoveryMap；key 双语已有则复用）

- [x] **Step 1-4:** 逐项小改（各 ≤5 行），每项完成后 `tsc`；WelcomeStep 改后 mock setup check 跑 e2e 向导步断言中文 label 不回落英文（现有 setup spec 顺带扩展或加断言）
- [x] **Step 5: 全绿 + Commit** `fix(admin-ui): persistCollapsed/登出按钮去重/语言图标/对比度/向导 label i18n`

### Task 6: 批一收口回归

- [x] 全量：`pixi run npx vitest run`；`export no_proxy=… && npx playwright test --project=chromium`（0 新失败，基线 69 全绿 + 本批新 spec）；`pnpm lint` 0 error
- [x] `docs/superpowers/plans/` 本文档勾选状态更新；`.agents/memorys/status.md` 近况一行
- [x] Commit `test(e2e): 批一速赢回归锁 + 文档状态`

---

## 批二：G1 授权强制接线（按顶部决策点 A 方案）

### Task 7: PermissionManager 补实 6 桩方法

**Files:**
- Modify: `packages/identity/src/managers/PermissionManager.ts:104-172`
- Test: `packages/identity/src/__tests__/PermissionManager.test.ts`（新建，mock drizzle 同 RoleManager 测试模式）

**Interfaces:**
- Consumes: `RoleManager.getUserRoles(userId, tenantId)`（RoleManager.ts:399）、`RoleManager.resolveInheritedPermissions(roleId, tenantId)`（:309，继承引擎已实现）
- Produces: `getUserEffectivePermissions(userId, tenantId): Promise<Permission[]>`；`hasPermission(userId, 'resource:action', tenantId): Promise<boolean>`；`hasPermissions(...)`；`setRolePermissions(roleId, permissionIds, tenantId?)`；`update/delete`

- [ ] **Step 1: 写失败测试**（4 例）：①effective = 多角色 resolveInheritedPermissions 合并去重（按 permission.id）②hasPermission 命中 `'users:read'`（resource+action 拼接）③hasPermissions 任一即真④setRolePermissions 委托 roleManager 私有不泄漏——若 RoleManager.setRolePermissions 为 private（:462），PermissionManager 自实现 role_permissions 表 delete+insert 事务（照抄 :462-475 查询体为私有辅助，非跨类调用）
- [ ] **Step 2: 实现**——effective 核心：

```typescript
async getUserEffectivePermissions(userId: string, tenantId: string): Promise<Permission[]> {
  const roles = await this.roleManager.getUserRoles(userId, tenantId);
  const seen = new Map<string, Permission>();
  for (const role of roles) {
    for (const p of await this.roleManager.resolveInheritedPermissions(role.id, tenantId)) {
      seen.set(p.id, p);
    }
  }
  return [...seen.values()];
}
async hasPermission(userId: string, permission: string, tenantId: string): Promise<boolean> {
  const [resource, action] = [permission.slice(0, permission.lastIndexOf(':')), permission.slice(permission.lastIndexOf(':') + 1)];
  const list = await this.getUserEffectivePermissions(userId, tenantId);
  return list.some((p) => p.resource === resource && p.action === action);
}
// hasPermissions: Promise<boolean> —— 任一命中即 true（空数组 → false）
// update/delete: 按 :104/:112 已有前置读取（findById+引用检查）后落 drizzle update/delete（参照同文件 create 的 try/catch + logger 模式）
```

- [ ] **Step 3: 测试全绿 + `pixi run npx tsc --noEmit`（packages/identity）**
- [ ] **Step 4: Commit** `feat(identity): PermissionManager 补实 effective/has/set/update/delete`

### Task 8: 内置权限种子 + admin 全量绑定（启动守卫）

**Files:**
- Modify: `apps/server/src/routes/auth.ts`（/setup/init 或 admin 创建成功处）或新建 `apps/server/src/startup/seedPermissions.ts` 并在 app.ts build() 迁移后调用
- Test: `apps/server/src/__tests__/permissions-seed.test.ts`

**Interfaces:**
- Produces: 种子清单常量 `BUILTIN_PERMISSIONS: {resource:string; action:string; description:string}[]`，值**必须与 authorize.ts 映射表逐字一致**：3 资源（users/roles/permissions）× 3 动作（read/write/delete）= **9 条**，description 用固定英文说明串

- [ ] **Step 1: 失败测试**：init 完成后 permissions 表含 9 条、admin 角色 role_permissions 关联 9 条、重复执行幂等（ON CONFLICT DO NOTHING）
- [ ] **Step 2: 实现**：drizzle `insert(permissions).values(...).onConflictDoNothing()` → 回读 id → `insert(rolePermissions).values(adminRole.id × ids).onConflictDoNothing()`；挂在 admin 创建成功后（同事务不必要，best-effort + logger.error 兜底）
- [ ] **Step 3: 绿 + Commit** `feat(server): 内置权限种子 + admin 绑定（幂等）`

### Task 9: requirePermission preHandler + 路由挂线（含 authorize.ts 匹配 bug 修复）

**Files:**
- Modify: `packages/identity/src/hooks/authorize.ts`（导出 `getRequiredPermission`，**前缀匹配**修复：最长前缀命中 `/api/v1/users/xxx` → `users:read`），`apps/server/src/utils/permission.ts` 新建，`routes/{users,roles,permissions}.ts` 挂线
- Test: `apps/server/src/__tests__/route-guard.test.ts`

**Interfaces:**
- Consumes: Task 7 `PermissionManager.hasPermission`；`request.user`（@fastify/jwt payload `{sub, email, jti?, tenantId?}`——实现前先读 auth.ts 登录签发处确认含 sub；若无 tenantId 字段用 DEFAULT_TENANT）
- Produces: `requirePermission(app: FastifyInstance)` 或 `preHandler: [app.authenticate, requirePermission()]`——工厂无参，内部按 `getRequiredPermission(method, url)` 查表；**无映射 = 不强制**（渐进面同 authorize.ts 语义）

- [ ] **Step 1: authorize.ts**：`export function getRequiredPermission(...)`；映射键改为 `${method}:/api/v1/${resource}` 仅资源根段，匹配逻辑：按 url 路径段逐段裁剪找首个命中（防 `/users/123` 漏网）；原 authorizeHook 行为不变
- [ ] **Step 2: utils/permission.ts 失败测试**：三例——无 token→401（由 authenticate 保证，测 403 即可）、角色无 `users:delete` 的 user 调 `DELETE /api/v1/users/:id` → 403 `{success:false,error:{code:'PERM_001',…}}`、admin → 2xx；用现有 server 测试 app 工厂 + inject
- [ ] **Step 3: 实现 + 挂线**：

```typescript
// apps/server/src/utils/permission.ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getRequiredPermission } from '@accessbase/identity'; // index.ts 增导出
import { PermissionManager } from '@accessbase/identity';
// DEFAULT_TENANT 现定义于 routes/auth.ts:6 —— 先提到共享位置（如 utils/constants.ts）再引用，不复制字面量

export function requirePermission() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const required = getRequiredPermission(request.method, request.url);
    if (!required) return;
    const user = request.user as { sub: string; tenantId?: string };
    const ok = await new PermissionManager().hasPermission(user.sub, required, user.tenantId ?? DEFAULT_TENANT);
    if (!ok) {
      await reply.status(403).send({ success: false, error: { code: 'PERM_001', message: 'Insufficient permissions' } });
    }
  };
}
```

挂线：users.ts/roles.ts/permissions.ts 各文件顶部现有 `app.addHook('preHandler', …authenticate)` **之后**追加一行 `app.addHook('preHandler', requirePermission())`——Fastify 同阶段 hook 按注册顺序执行，authenticate 先填 `request.user`，本 hook 后读。同时消掉原 `(app as any).authenticate` 的 `as any`：在 server 既有 fastify 类型增强文件声明 `authenticate(request, reply): Promise<void>`（禁 as any）。
- [ ] **Step 4: 全量 server vitest 绿（现有测试全走 admin → 种子后全放行）**
- [ ] **Step 5: Commit** `feat(server): requirePermission 路由强制（users/roles/permissions）+ authorize 前缀匹配修复`

### Task 10: /auth/me 暴露 permissions + mfaEnabled

**Files:**
- Modify: `apps/server/src/routes/auth.ts`（:243-252 me 返回体；rolesOf 旁新增 `permissionsOf`）
- Test: `apps/server/src/__tests__/auth.test.ts` 追加 2 例

- [ ] **Step 1: 失败测试**：admin me → `data.permissions` 数组含 `'users:read'`、`data.mfaEnabled === false`；无角色用户 → `permissions: []`
- [ ] **Step 2: 实现**：`permissions: (await permissionManager.getUserEffectivePermissions(user.id, DEFAULT_TENANT)).map(p => `${p.resource}:${p.action}`)`；`mfaEnabled: user.mfaEnabled ?? false`（读 users 表既有列名核实后引用）；me 处 new PermissionManager 复用 Task 9 实例化方式
- [ ] **Step 3: 绿 + Commit** `feat(server): /auth/me 返回 permissions 与 mfaEnabled`

### Task 11: 前端权限门（store + 菜单过滤 + 路由守卫 + /403 可达）

**Files:**
- Modify: `stores/auth.ts`（User 加 `permissions: string[]`、`mfaEnabled: boolean`；state 加 `hasPermission(code): boolean`——admin 语义**不**硬编码 bypass，数据驱动：种子已给 admin 全量）, `layouts/AdminLayout.tsx:25-37`（menuRoutes 过滤：`{path→code}` 表 dashboard/profile/settings=null 恒显，users/roles/audit→`users:read`/`roles:read`/`audit:read`；audit 暂不在 authorize 表 → 过滤表用 `'audit:read'` 但后端不强制本批维持现状，注释标注 ponytail 上限）, `App.tsx:21-25`（PrivateRoute 加可选 `permission` prop，未通过 `<Navigate to="/403" replace />`；users 路由传 `'users:read'`，roles/permissions 同）
- Test: `e2e/auth-rbac-ui.spec.ts`（mock：/auth/me 返回 `permissions:['users:read']` → 侧栏无 Roles/Audit 项、直访 `/roles` 落 403 页、`/users` 正常）

- [ ] **Step 1-4:** 先写 e2e（红：当前无过滤）→ 实现 → 绿。store 改动注意 persist partialize 不含函数；fetchUser 映射 `permissions ?? []`（向后兼容旧后端）
- [ ] **Step 5: Commit** `feat(admin-ui): 菜单/路由权限门，/403 可达`

### Task 12: 批二收口

- [ ] 真后端 curl 验真：非 admin 新用户（无角色）`GET /api/v1/users` → 403；admin → 200（PIT 纪律：交付层实测，不只 vitest）
- [ ] 全量 vitest + e2e chromium（mock 登录的旧 spec：/auth/me mock 缺 permissions 字段 → Step 兼容 `?? []` 不得让现有 69 用例红；红了就补 mock 字段而非放宽断言——PIT-032 同源诚实性）
- [ ] `.agents/memorys/decisions.md` 记 D115（requirePermission 偏离 §3.3 plugin 路线及理由）+ conventions 权限码表更新；status.md 行更新
- [ ] Commit `docs(memory): D115 授权强制路线决策 + 权限码种子表`

---

## 批三：MFA 自助面板（U2 / G1'，纯贴皮）

### Task 13: 前端 api/mfa.ts + Settings TOTP 卡片

**Files:**
- Create: `apps/admin-ui/src/api/mfa.ts`
- Modify: `pages/Settings.tsx`（sessionsTab :147-193 与 passkeys 之间插 `totpCard`）, `i18n/locales/{en,zh}.json`
- Test: `e2e/mfa-panel.spec.ts`

**Interfaces:**
- Consumes: 后端契约（已实测存在）：`POST /v1/auth/mfa/setup` → `{success,data:{otpauthUrl:string, qrDataUrl:string, recoveryCodes:string[]}}`（MfaManager.setup:50-53 QRCode.toDataURL 已是 dataURL，**零新依赖**）；`POST /v1/auth/mfa/enable` body `{code:string}`（6-8 位）；`POST /v1/auth/mfa/disable` body `{password:string}`；Task 10 的 `user.mfaEnabled`
- Produces: `mfaApi.setup()/enable(code)/disable(password)`，`ApiEnvelope` 泛型（Phase 7 门禁）

- [ ] **Step 1: 失败 e2e**（mock setup/enable/disable + /auth/me mfaEnabled=false→true）：Security tab 见"未开启"态卡片（data-testid="mfa-card"）→ 点"设置身份验证器"→ modal 显示 `img[data-testid="mfa-qr"]` + secret 文本 + 6 位码输入 → 输码提交 → 恢复码一次性 modal（"我已保存"门控）→ 成功 toast + 卡片变"已开启"+ 出现"关闭"入口（密码确认 Modal）
- [ ] **Step 2: api/mfa.ts**：三函数，信封解包同 api/auth.ts 既有模式；恢复码仅存 modal 组件 state，**不入 zustand/persist**（conventions 敏感字段约束）
- [ ] **Step 3: Settings totpCard**：三态渲染（disabled → setting(modal) → enabled）；错误全走 Task 1 `apiErrorMessage`；用户取消弹窗不当错误（FO-5 同族注意：NotAllowedError 静默，此卡无 WebAuthn 天然规避）；文案 key `settings.mfa*` 双语
- [ ] **Step 4: e2e 绿 + tsc/lint**
- [ ] **Step 5: Commit** `feat(admin-ui): Settings TOTP 自助面板（扫码/验证/恢复码/关闭）`

### Task 14: 批三收口 + 全局回归

- [ ] 全量 vitest + `npx playwright test --project=chromium` + lint + tsc；`test.fail()` 存量保持 0
- [ ] FINAL.md/SYNTHESIS.md 对应条目（G1'/U2/TOP-10）标注"已交付 @commit"
- [ ] status.md 近况 + 本计划勾选终态；Commit `test+docs: Phase 8a 收口`

---

## 验证总清单（三批各自完成判据）

| 判据 | 命令 | 标准 |
|------|------|------|
| 类型 | `pixi run npx tsc --noEmit`（server/admin-ui/identity） | 0 错误 |
| 单测 | `pixi run npx vitest run` | 全绿（321+新增） |
| E2E | `export no_proxy=… && pixi run npx playwright test --project=chromium` | 69 基线 + ~8 新用例全绿 |
| Lint | `pnpm lint` | 0 error |
| 真后端 | curl：无权限 403 / admin 200；mfa setup→enable→登录挑战 | 实测输出贴报告 |

## 明确不做（防范围失控）

租户 UI、监控页、应用/Client 管理、注册/找回闭环（等产品定位决策）、暗色主题/全局搜索/batch（设计自延期）、骨架屏与快捷键层（U3，另立计划）、React.lazy 分包（PE-2，独立小改进）、packages/admin 六件套接线（FINAL 路线图第 3 波）。
