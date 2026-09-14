# Batch B Implementation Plan — Permission Cache + Generic OIDC RP + UI Quick Wins

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kill the hottest N+1 in the system (per-request permission resolution) with a TTL cache + explicit invalidation; make OAuth providers configuration-driven (any generic OIDC provider via options JSON); ship the UI quick wins (dark mode, empty-state alignment, users status filter).

**Architecture:** B1 adds an in-process TTL cache inside PermissionManager (key `perm:{tenantId}:{userId}`, 30s default) with explicit invalidation on every write path that can change effective permissions; RoleManager.findAll collapses its per-role permission queries into one JOIN. B2 merges built-in GitHub/Google (env) with options-table `oauth_providers` JSON config at request time, building generic providers from arctic's `OAuth2Client` (explicit endpoints, PKCE by default). B3 is pure frontend: ConfigProvider dark algorithm + `ui` zustand persist store, shared EmptyState alignment, users status column filters.

**Tech Stack:** TypeScript strict, Drizzle ORM, arctic 3.7 (OAuth2Client), antd 5 theme algorithms, zustand persist, vitest, Playwright (mock-API mode).

**Spec:** docs/superpowers/specs/2026-09-12-batch-b-perf-oidc-ui-design.md (committed 9cbe366)

## Global Constraints

- TDD (D114 红先行)：每任务先写失败测试；vitest mock 不连真 PG；e2e mock-API 模式（跑前 curl 5101 应 000）
- identity 包改动后 `pnpm --filter @accessbase/identity build`（dist 同步陷阱）
- 提交/注释英文；计划与对话中文
- 无 as any / @ts-ignore / @ts-expect-error；pino 对象式日志
- 不新增权限码（零双注册负担）；不新增 npm 依赖（arctic/zustand/antd 均已在库）
- e2e 全量基线：104 passed + 3 skipped，零新失败
- 缓存失效必须覆盖全部写路径（spec §2 清单为准，遗漏 = P0 级审查发现）
- 前端改动：tsc 双闸 + e2e 无新失败

---

## Task 1: PermissionManager TTL 缓存（命中/失效/隔离）

**Files:**
- Modify: `packages/identity/src/managers/PermissionManager.ts`（getUserEffectivePermissions 加缓存层）
- Test: `packages/identity/src/__tests__/PermissionManager.test.ts`（追加缓存 describe）

**Interfaces:**
- Consumes: 现有 `getUserEffectivePermissions(userId, tenantId): Promise<Permission[]>`（PermissionManager.ts:146）
- Produces: `invalidatePermissionCache(tenantId?: string, userId?: string): void`（公开方法——tenantId+userId 都传清单条；只传 tenantId 清该租户全量；都不传清全部）；缓存 TTL 常量 `PERMISSION_CACHE_TTL_MS = 30_000`；构造器可选参数 `options?: { cacheTtlMs?: number }`（测试注入短 TTL）

- [ ] **Step 1: 写失败测试**（PermissionManager.test.ts 追加，沿用该文件既有 db mock 模式）：

```typescript
describe('permission cache', () => {
  it('caches effective permissions within TTL (one db round for two calls)', async () => {
    const mgr = new PermissionManager(undefined, { cacheTtlMs: 1000 });
    const spy = vi.spyOn(mgr as unknown as { roleManager: { getUserRoles: ReturnType<typeof vi.fn>; resolveInheritedPermissions: ReturnType<typeof vi.fn> } }, 'roleManager', 'get');
    // 按 PermissionManager.test.ts 既有 mock 风格设置 getUserRoles/resolveInherited 返回值
    await mgr.getUserEffectivePermissions('u1', 't1');
    await mgr.getUserEffectivePermissions('u1', 't1');
    expect(spyValueCountOfGetUserRolesCalls()).toBe(1); // 第二次走缓存
  });

  it('expires after TTL', async () => {
    vi.useFakeTimers();
    const mgr = new PermissionManager(undefined, { cacheTtlMs: 50 });
    await mgr.getUserEffectivePermissions('u1', 't1');
    vi.advanceTimersByTime(60);
    await mgr.getUserEffectivePermissions('u1', 't1');
    expect(callCountIsTwo()); // 过期后重查
    vi.useRealTimers();
  });

  it('invalidatePermissionCache(userId) forces re-fetch for that user only', async () => {
    const mgr = new PermissionManager(undefined, { cacheTtlMs: 60_000 });
    await mgr.getUserEffectivePermissions('u1', 't1');
    await mgr.getUserEffectivePermissions('u2', 't1');
    mgr.invalidatePermissionCache('t1', 'u1');
    await mgr.getUserEffectivePermissions('u1', 't1');
    await mgr.getUserEffectivePermissions('u2', 't1');
    expect(u1CallsIsTwoAndU2IsOne());
  });

  it('cross-tenant isolation: same userId different tenant does not share cache', async () => {
    const mgr = new PermissionManager(undefined, { cacheTtlMs: 60_000 });
    await mgr.getUserEffectivePermissions('u1', 't1');
    await mgr.getUserEffectivePermissions('u1', 't2');
    expect(bothFetchedOnceEachKey());
  });
});
```

（执行者注：以上 spy/断言辅助为示意——按 PermissionManager.test.ts **现有** db mock 写法落地同等语义；关键断言四个：TTL 内单查、过期重查、定向失效、跨租户隔离。mock 辅助函数放 describe 内，命名自定但语义不变。）

- [ ] **Step 2: 跑测试确认失败** — `pixi run npx vitest run packages/identity/src/__tests__/PermissionManager.test.ts -t "permission cache"`，预期 FAIL（无缓存层，两次调用两次 DB）

- [ ] **Step 3: 实现缓存** — PermissionManager.ts：

```typescript
const DEFAULT_PERMISSION_CACHE_TTL_MS = 30_000;

interface CacheEntry { permissions: Permission[]; expiresAt: number }

export class PermissionManager {
  private readonly permCache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;

  constructor(databaseUrl?: string, options?: { cacheTtlMs?: number }) {
    // 保留既有 ctor 逻辑（db 初始化），追加：
    this.cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_PERMISSION_CACHE_TTL_MS;
  }

  private cacheKey(tenantId: string, userId: string): string {
    return `perm:${tenantId}:${userId}`;
  }

  invalidatePermissionCache(tenantId?: string, userId?: string): void {
    if (!tenantId) { this.permCache.clear(); return; }
    if (!userId) {
      for (const k of this.permCache.keys()) {
        if (k.startsWith(`perm:${tenantId}:`)) this.permCache.delete(k);
      }
      return;
    }
    this.permCache.delete(this.cacheKey(tenantId, userId));
  }

  async getUserEffectivePermissions(userId: string, tenantId: string): Promise<Permission[]> {
    const key = this.cacheKey(tenantId, userId);
    const hit = this.permCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.permissions;
    const permissions = await this.computeEffectivePermissions(userId, tenantId);
    this.permCache.set(key, { permissions, expiresAt: Date.now() + this.cacheTtlMs });
    return permissions;
  }

  private async computeEffectivePermissions(userId: string, tenantId: string): Promise<Permission[]> {
    // 原 getUserEffectivePermissions 方法体原样搬入
  }
}
```

注意：既有 ctor 签名是 `constructor(databaseUrl?)` —— 新可选参数放第二位，既有调用零破坏。

- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 命令 4/4；全量 `pixi run npx vitest run` 无回归
- [ ] **Step 5: Commit**

```bash
pnpm --filter @accessbase/identity build
git add -A && git commit -m "feat(identity): permission resolution TTL cache with targeted invalidation (B1)"
```

---

## Task 2: 写路径失效接线（缓存正确性的关键）

**Files:**
- Modify: `packages/identity/src/managers/RoleManager.ts`（update/delete → 失效）
- Modify: `packages/identity/src/managers/UserManager.ts`（changeStatus → 失效该用户；角色分配写路径若有 → 同）
- Modify: `packages/identity/src/managers/PermissionManager.ts`（自身 CUD → 失效租户）
- Test: `packages/identity/src/__tests__/cache-invalidation.test.ts`（new）

**Interfaces:**
- Consumes: Task 1 的 `invalidatePermissionCache(tenantId?, userId?)`
- Produces: 全部写路径调用失效后的最终一致性；跨 manager 调用方式 = 同进程同实例不可得（各 manager 独立实例），**采用静态/模块级共享缓存注册表**：Task 1 的缓存 Map 改为模块级 `export const permissionCache = new Map<...>()`（PermissionManager 实例持有引用），失效函数同为模块级 `export function invalidatePermissionCache(...)`——各 manager import 同一模块级函数，实例无关

- [ ] **Step 1: 重构缓存为模块级**（Task 1 的 Map 与 invalidate 移出类、变为模块级导出；PermissionManager 方法委托之）。先加回归测试：两个 PermissionManager 实例共享缓存（实例 A 写缓存，实例 B 命中）——先写测试确认现实现不共享（FAIL），再重构（PASS）

- [ ] **Step 2: 写失效测试**（新文件 cache-invalidation.test.ts，沿用 identity 测试 mock 风格）：

```typescript
describe('cache invalidation on write paths', () => {
  it('RoleManager.update clears tenant namespace', async () => {
    // arrange: 预热 u1@t1 缓存
    // act: roleManager.update('r1', {...}, 't1')
    // assert: getUserEffectivePermissions('u1','t1') 重新查库（db spy 计数 +1）
  });
  it('RoleManager.delete clears tenant namespace', async () => { /* 同上形态 */ });
  it('PermissionManager.create/update/delete clears tenant namespace', async () => { /* 三操作各一断言 */ });
  it('UserManager.changeStatus clears only that userId', async () => {
    // 预热 u1@t1 与 u2@t1；changeStatus('u1',...) 后仅 u1 重查
  });
  it('users_roles write (assign/unassign) clears that userId', async () => {
    // 若角色分配方法在 RoleManager/UserManager 内，按实际归属测试
  });
});
```

（执行者注：先 `grep -n "assignRole\|removeRole\|users_roles\|userRoles" packages/identity/src/managers/*.ts` 找到角色分配写路径的真实归属，归属哪个 manager 就在哪接线；上表每条写路径一个用例，无遗漏。）

- [ ] **Step 3: 跑测试确认失败** — 预期全部 FAIL（写路径未调用失效）

- [ ] **Step 4: 接线** — 每个 CUD 方法成功分支末尾（返回前）调用模块级 `invalidatePermissionCache(tenantId)`（RoleManager/PermissionManager）或 `invalidatePermissionCache(tenantId, userId)`（UserManager.changeStatus/角色分配）。pino 对象式日志一行（debug 级）可选

- [ ] **Step 5: 跑测试确认通过 + 全量无回归**；`pnpm --filter @accessbase/identity build`
- [ ] **Step 6: Commit** — `feat(identity): invalidate permission cache on all write paths (B1)`

---

## Task 3: RoleManager.findAll N+1 消除（JOIN 一次取回）

**Files:**
- Modify: `packages/identity/src/managers/RoleManager.ts:116-160`（findAll 的每角色 getRolePermissions 循环 → 单次 JOIN 查询 + 内存分组）
- Test: `packages/identity/src/__tests__/RoleManager.test.ts`（追加 findAll 形状断言）

**Interfaces:**
- Consumes: drizzle `inArray`；rolePermissions 表 schema
- Produces: findAll 返回形状不变（`PaginatedResult<Role>`，role.permissions 字段语义不变）——纯内部优化，调用方零感知

- [ ] **Step 1: 写失败测试**——关键不是性能是**形状**：mock db 层断言「一次查询取回 N 角色权限」（db.select 调用计数=1 次 role_permissions 查询而非 N 次）+ 返回的 roles[].permissions 与现行为等价（沿用 RoleManager.test.ts:78 现有 mock 风格补 thin 测试；该文件测试最薄，本步同时是补网）：

```typescript
describe('findAll permissions fetch', () => {
  it('fetches role permissions in ONE query (no N+1)', async () => {
    // arrange: 3 roles, db mock 记录 select 调用序列
    // act: findAll({page:1,pageSize:20}, 't1')
    // assert: role_permissions 表查询恰 1 次（用 inArray 包含 3 个 roleId）；每 role.permissions 正确分组
  });
  it('returns identical shape to previous behavior (regression lock)', async () => {
    // 断言 PaginatedResult 形状：{data:[{...role, permissions:[...]}], total, page, pageSize}
  });
});
```

- [ ] **Step 2: 确认 FAIL**（现实现每角色一查，计数=N）
- [ ] **Step 3: 实现**——findAll 内权限获取替换为：

```typescript
const roleIds = roles.map((r) => r.id);
const perms = roleIds.length
  ? await this.db
      .select({ roleId: rolePermissions.roleId, permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(inArray(rolePermissions.roleId, roleIds))
  : [];
const byRole = new Map<string, string[]>();
for (const p of perms) {
  const list = byRole.get(p.roleId) ?? [];
  list.push(p.permissionId);
  byRole.set(p.roleId, list);
}
// 组装 roles[].permissions —— 若现行为 join 完整 Permission 行，则改为 select 全字段并同样分组
```

（执行者注：先读 RoleManager.ts:116-160 现实现确认 permissions 字段是完整 Permission 对象还是 id 数组，**以现行为为准**保持形状——上面示意按 id；若是完整对象就 select join permissions 表取全字段。）

- [ ] **Step 4: 确认 PASS + 全量**；identity build
- [ ] **Step 5: Commit** — `perf(identity): RoleManager.findAll single-query permissions fetch (B1)`

---

## Task 4: 通用 OIDC RP 后端（options 驱动 + arctic OAuth2Client）

**Files:**
- Modify: `apps/server/src/routes/oauth.ts`（provider 解析从硬编码 switch 改为注册表合并）
- Test: `apps/server/src/__tests__/oauth.test.ts`（追加 generic provider 用例）

**Interfaces:**
- Consumes: OptionsManager（`get(key, envValue, defaultValue)` 三参，auth.ts 既有 getOptionsManager 单例先例）；arctic 3.7 `OAuth2Client`（显式 endpoints：`createAuthorizationURLWithPKCE(authEndpoint, state, 'S256', verifier, scopes)` / `validateAuthorizationCode(tokenEndpoint, code, verifier)`）；options 表读走 auth.ts 既有 getOptionsManager()
- Produces: `resolveProviders(): Promise<Record<string, ResolvedProvider>>`（oauth.ts 模块内；ResolvedProvider = { client: OAuth2Client|GitHub|Google; pkce: boolean; scope: string[]; name: string }）——内置 github/google（env 凭据齐全时）+ options `oauth_providers` JSON 里的动态 provider 合并；options JSON 格式：

```json
{ "my-oidc": { "authUrl": "https://idp.example.com/authorize", "tokenUrl": "https://idp.example.com/token", "userinfoUrl": "https://idp.example.com/userinfo", "clientId": "xxx", "clientSecret": "yyy", "scope": "openid profile email" } }
```

- 行为契约：options JSON 畸形（非 JSON/缺字段）→ 该 provider 跳过 + warn 日志（不炸启动、不影响内置）；provider 名非法字符（非 `[a-z0-9-]`）→ 跳过；内置与动态同名 → 内置优先；`/oauth/:provider/authorize` 对未配置 provider → 404（现行为）；generic provider 走 PKCE（state cookie + verifier cookie 机制复用现有）；profile 标准化：userinfoUrl 响应 `{ sub, email?, name? }` → NormalizedProfile（email 缺省 `${sub}@${name}.oauth.invalid` 与现 fallback 一致）

- [ ] **Step 1: 写失败测试**（oauth.test.ts 追加，沿用该文件既有 mock 前奏）：

```typescript
describe('generic OIDC providers (options-driven)', () => {
  it('authorize redirects for an options-configured provider', async () => {
    // mock getOptionsManager: oauth_providers = JSON with my-oidc (valid endpoints)
    // act: GET /api/v1/auth/oauth/my-oidc/authorize
    // assert: 302 → authUrl 包含 client_id=xxx & state cookie 设置 & verifier cookie 设置（PKCE）
  });
  it('skips malformed options JSON with warn (built-ins unaffected)', async () => {
    // oauth_providers = 'not-json' → GET /my-oidc/authorize → 404；GET /github/authorize 正常
  });
  it('invalid provider names are rejected (404)', async () => {
    // name = '../evil' 或 'UPPER' → 404
  });
  it('built-in takes precedence over same-name dynamic provider', async () => {
    // options 里配 github → resolve 走内置 env 凭据
  });
});
```

- [ ] **Step 2: 确认 FAIL**
- [ ] **Step 3: 实现**——oauth.ts 内：

```typescript
import { OAuth2Client, generateState, generateCodeVerifier } from 'arctic';

interface DynamicProviderConfig {
  authUrl: string; tokenUrl: string; userinfoUrl: string;
  clientId: string; clientSecret: string; scope?: string;
}

async function loadDynamicProviders(): Promise<Record<string, DynamicProviderConfig>> {
  // getOptionsManager() 单例 → get('oauth_providers', process.env['OAUTH_PROVIDERS'], '')
  // JSON.parse try/catch → warn+{}；键名 /^[a-z0-9-]{1,32}$/ 过滤；缺必填字段跳过
}

async function resolveProvider(name: string): Promise<ResolvedProvider | null> {
  // 内置优先：github/google 且 env 凭据齐全 → 现 getProvider 路径（pkce=false for github D109, true for google）
  // 否则 dynamic[name] → new OAuth2Client(clientId, clientSecret, `${config.oauthRedirectBase}/api/v1/auth/oauth/${name}/callback`)
}
```

authorize/callback 两个 handler 的 provider 解析改走 `resolveProvider(params.provider)`；generic 分支：authorize 用 `createAuthorizationURLWithPKCE(authUrl, state, CodeChallengeMethod.S256, verifier, scopes)`；callback 用 `validateAuthorizationCode(tokenUrl, code, verifier)` 后 fetch userinfoUrl（Bearer token）→ 标准化。内置 GitHub/Google 分支原逻辑不动。
- [ ] **Step 4: 确认 PASS**（含既有 github/google 用例零回归）+ 全量
- [ ] **Step 5: Commit** — `feat(server): options-driven generic OIDC providers via arctic OAuth2Client (B2)`

---

## Task 5: 登录页动态 provider 按钮（前端消费）

**Files:**
- Modify: `apps/server/src/routes/oauth.ts`（追加公开端点 GET /auth/oauth/providers → `{success:true,data:{providers:['github','google','my-oidc']}}`——仅返回已配置 provider 名，无任何凭据/URL 细节；无权限码需求，公开端点）
- Modify: `apps/admin-ui/src/api/`（现有 oauth api 文件加 listOAuthProviders()）
- Modify: `apps/admin-ui/src/pages/Login.tsx`（GitHub/Google 硬编码按钮区改为 map 渲染；空数组则不渲染该区块）
- Test: `e2e/oauth-login.spec.ts`（追加 1 例：mock providers 端点返回含动态 provider → 按钮渲染）

**Interfaces:**
- Consumes: Task 4 的 resolveProviders
- Produces: 前端零硬编码 provider 列表；新端点响应形状 `{success:true,data:{providers:string[]}}`（信封合规）

- [ ] **Step 1: 后端端点 TDD**——oauth.test.ts 加 1 例（mock options 无配置 → 恰为 env 配置的内置名；有配置 → 合并去重）；实现 10 行
- [ ] **Step 2: 前端改造**——Login.tsx 按钮区：`useEffect` fetch providers（失败静默 fallback `['github','google']` 且按钮仍按各自 env 配置渲染现状——前端无凭据知识，保持向后兼容：**只渲染后端返回的名单**）；按钮 label 用 i18n key `login.oauth.<provider>`（缺失 fallback 为 provider 名大写）；icon 缺省用通用 key 图标
- [ ] **Step 3: e2e**——mock `**/api/v1/auth/oauth/providers` 返回 `['github','google','acme']` → 断言第三按钮出现 + 文案 fallback 'ACME'
- [ ] **Step 4: 门禁**——vitest 全量绿、tsc 双闸净、e2e 该 spec 绿
- [ ] **Step 5: Commit** — `feat(server,admin-ui): dynamic provider list endpoint + login buttons (B2)`

---

## Task 6: 暗色模式（ConfigProvider + ui store + 空态/筛选快赢）

**Files:**
- Create: `apps/admin-ui/src/stores/ui.ts`（zustand persist：theme 'light'|'dark'|'auto'）
- Modify: `apps/admin-ui/src/App.tsx`（ConfigProvider theme algorithm 切换 + html[data-theme] effect；locale 绑定处同层）
- Modify: `apps/admin-ui/src/components/`（布局头部加主题切换按钮——先读布局组件定位文件）
- Modify: `apps/admin-ui/src/pages/Audit.tsx` `Clients.tsx` `Dashboard.tsx`（空态统一 EmptyState 组件——Roles 页先例；先 grep 该组件实际路径与 props）
- Modify: `apps/admin-ui/src/pages/Users.tsx`（status 列加 antd table filters）
- Test: `e2e/theme.spec.ts`（new）

**Interfaces:**
- Consumes: antd `theme`（darkAlgorithm/lightAlgorithm）、zustand persist 既有模式（auth.ts:37 先例——只持久化业务字段，theme 属用户偏好可持久化）
- Produces: `useUiStore`：`{ theme: 'light'|'dark'|'auto'; setTheme(t): void }`；html 根元素 `data-theme` 属性同步（e2e 断言锚点）

- [ ] **Step 1: ui store + ConfigProvider**——store 15 行；App.tsx 在既有 ConfigProvider（locale 绑定处）加 theme prop：`theme={{ algorithm: resolved === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm }}`；`resolved` 处理 auto → matchMedia('(prefers-color-scheme: dark)')；useEffect 同步 `document.documentElement.dataset.theme`
- [ ] **Step 2: 切换按钮**——布局头部（Moon/Sun 图标 Toggle）调 setTheme；auto 态下切到 light/dark 即脱离 auto
- [ ] **Step 3: e2e**（theme.spec.ts，mock-API 模式含 GlobalGuard setup/status mock）：

```typescript
test('theme toggle switches data-theme and persists across reload', async ({ page }) => {
  // 既有 login helper → 点击切换按钮 → expect html[data-theme=dark]
  // page.reload() → 仍 dark（persist 恢复）
});
```

- [ ] **Step 4: 空态对齐**——grep EmptyState 组件真实位置与 props（Roles.tsx 5 处 Empty 先例），Audit/Clients/Dashboard 空数据分支替换为同款（无独立组件则抽 components/EmptyState.tsx 一次、三页复用）；Users status 列 filters：`filters: [{text:'Active',value:'active'},{text:'Suspended',value:'suspended'},{text:'Pending',value:'pending'}], onFilter: (v, r) => r.status === v`（前端本地过滤，数据量级内 YAGNI 服务端化）
- [ ] **Step 5: 门禁**——tsc 双闸、vitest 全量、e2e 全量（theme.spec 新增 1-2 例 + 全量无回归）
- [ ] **Step 6: Commit** — `feat(admin-ui): dark mode with persisted ui store; empty-state alignment; users status filter (B3)`

---

## Task 7: 全局收官门禁

**Files:**
- 无新产物（验证性任务）；如 e2e 暴露回归则修复归本任务

**Interfaces:**
- Consumes: Task 1-6 全部交付

- [ ] **Step 1: 前置**——5101 后端停（curl 应 000）；`export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1`
- [ ] **Step 2: 全量门禁**——`pixi run npx vitest run`（预期 466+新增 全绿）；`tsc --noEmit` ×2（root + admin-ui）；`pixi run npx playwright test --project=chromium --reporter=line`（基线 104+3skip + 本批新增 ≥2 例，零失败）
- [ ] **Step 3: 性能抽查（可选但推荐）**——写一个临时 vitest 断言：requirePermission 命中缓存时 roleManager 方法零调用（Task 1 测试已覆盖则跳过）
- [ ] **Step 4: 若有失败**——修复归本任务 commit：`fix(server,admin-ui): batch B final gate fixes`
- [ ] **Step 5: 汇报**——精确数字（vitest X/X、e2e P/F/S、tsc 状态）

---

## 验收清单（批次 B 完成定义）

- [ ] requirePermission 缓存命中 = 0 SQL（单测断言）；权限/角色/状态任一写路径变更后 ≤ 即时失效
- [ ] options JSON 畸形不炸、provider 名非法拒收、内置优先
- [ ] 通用 provider 完整流：authorize 302（PKCE）→ callback → session（e2e 或集成测试）
- [ ] 登录页按后端返回名单渲染按钮，零前端硬编码
- [ ] 暗色切换 + persist 重载保持 + html[data-theme] 同步
- [ ] Audit/Clients/Dashboard 空态统一；Users status 可筛
- [ ] vitest 全绿 / tsc 双闸净 / e2e 基线零新失败
