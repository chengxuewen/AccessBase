# Setup Guard 容错与 dev 生命周期修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复"reset → stop → dev 后无法进入 Setup Wizard"的三缺陷组合：①前端 guard 对后端不可达 fail-open 到 /login（改为三态 + 自动重试）；②`dev` 的 EXIT trap 越权停掉 PG/Redis（改为只杀 dev 进程，infra 生命周期归 `stop` 命令）；③(由①自动消解) /login 落点无恢复路径。

**Architecture:** `checkSetupStatus` 返回三态 `needsSetup: boolean | null`（null = 检查失败/后端不可达），两个 guard 共享一个新 hook `useSetupGuardState()`（单一实现，消除双份 catch）；guard 对 null 渲染"连接后端中 + 3s 自动重试"页。`accessbase.sh` 的 `cleanup_native` 拆分：dev 进程击杀保留在 EXIT trap，infra 停止仅属于 `stop` 命令与 `wait -n` fail-fast 主动清理路径。

**Tech Stack:** React 19 / TypeScript / Zustand persist / bash / Vitest / Playwright

**Spec:** 2026-09-02 会话诊断（三缺陷实验证据链：backend-down 窗口 `/`→`/login`、trap 停 infra 后 5432 ECONNREFUSED、恢复后刷新即恢复）

## Global Constraints

- 禁止 `as any` / `@ts-ignore` / `@ts-expect-error`
- tsc 双绿：`pixi run npx tsc --noEmit` + `-p apps/admin-ui/tsconfig.json`
- vitest 313 基线，0 新失败；E2E 基线 chromium 59 pass / 1 pre-existing（users-search）+ setup-real 5 pass / 0 fail；命令 `NO_PROXY="localhost,127.0.0.1" pixi run npx playwright test --project=chromium` / `--project=setup-real`
- PIT-023：inline Alert，禁 antd static message
- E2E mock-passthrough 教训：改 guard 行为后 `layout.spec`/`error-pages.spec` 等所有真实渲染 App 路由树的 spec 都会走 GlobalGuard——任何新增 status 请求失败模式必须逐 spec 检查
- dev server 已在跑（5101/5173/5432/6379），前端改动 tsx/Vite 热重载生效
- 环境事实：手动起后端需 `DATABASE_URL`+`REDIS_URL`（PIT-025）；本机代理需 NO_PROXY；`reset` 会删库（测试用 T5 既有 `resetBackend` helper 模式）

---

### Task 1: useSetupGuardState hook（三态 + 重试）+ guard 接入

**Files:**
- Create: `apps/admin-ui/src/hooks/useSetupGuardState.ts`
- Modify: `apps/admin-ui/src/api/setup.ts:28-32`（`checkSetupStatus` 返回 `{ needsSetup: boolean; ok: boolean }`，永不 reject——网络错误转为 `{ needsSetup: false, ok: false }`，调用方判 `ok`）
- Modify: `apps/admin-ui/src/App.tsx`（删 GlobalGuard/SetupGuard 内的 useState+useEffect+catch，改用 hook；null 态渲染重试页）
- Test: `e2e/setup-real-flow.spec.ts` T5.3 增强 + 新增 backend-down 用例

**Interfaces:**
- Produces: `useSetupGuardState(): { needsSetup: boolean | null }` — `null`=检查中或失败后重试中；`true`=需 setup；`false`=无需。内部：挂载即查；`ok=false` 时 3s 后自动重查（无限重试，无 toast/console 噪音）；返回前值（不闪跳）
- Consumes: `client.get('/v1/setup/status')`（现有 axios client）

- [ ] **Step 1: 写失败 E2E（backend-down 窗口用例）**

`e2e/setup-real-flow.spec.ts` 新增（T5.3 后追加）：

```typescript
test('T5.4 backend down → guard shows retry state, NOT login; recovers when backend returns', async ({ page }) => {
  // abort status 请求模拟后端不可达（不依赖真实杀进程——CI 友好）
  await page.route('**/api/v1/setup/status', (r) => r.abort());
  await page.goto('/');
  // 不得落在 /login（旧缺陷行为），不得白屏
  await page.waitForTimeout(1000);
  expect(page.url()).not.toMatch(/\/login/);
  await expect(page.getByTestId('setup-guard-retry')).toBeVisible({ timeout: 5000 });
  // 恢复后端 → 自动重试应把用户带进 setup（DB 当前为未初始化状态时）
  await page.unroute('**/api/v1/setup/status');
  await page.route('**/api/v1/setup/status', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, data: { isInitialized: false, adminExists: false, configComplete: false } }),
  }));
  await expect(page).toHaveURL(/\/setup/, { timeout: 10_000 }); // 3s 重试间隔 + 断言余量
});
```

注意：T5.4 是 mock 层用例但放进 setup-real project 的 serial 流末尾（复用其后端无关性；不依赖 DB 状态）。

- [ ] **Step 2: 运行确认失败**

Run: `NO_PROXY="localhost,127.0.0.1" pixi run npx playwright test e2e/setup-real-flow.spec.ts -g "T5.4" --project=setup-real`
Expected: FAIL——当前行为 abort→catch(false)→落在 /login，无 `setup-guard-retry` testid

- [ ] **Step 3: 实现**

`api/setup.ts`：

```typescript
export async function checkSetupStatus(): Promise<{ needsSetup: boolean; ok: boolean }> {
  try {
    const { data } = await client.get('/v1/setup/status');
    return { needsSetup: !data.data?.isInitialized, ok: true };
  } catch {
    return { needsSetup: false, ok: false };
  }
}
```

`hooks/useSetupGuardState.ts`：

```typescript
import { useEffect, useState } from 'react';
import { checkSetupStatus } from '../api/setup';

const RETRY_MS = 3000;

export function useSetupGuardState(): { needsSetup: boolean | null } {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = () => {
      checkSetupStatus().then(({ needsSetup: ns, ok }) => {
        if (cancelled) return;
        if (ok) setNeedsSetup(ns);
        else {
          // 保持 null（重试态），3s 后再试
          timer = setTimeout(poll, RETRY_MS);
        }
      });
    };
    poll();

    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  return { needsSetup };
}
```

`App.tsx` 两个 guard：

```typescript
function GlobalGuard({ children }: { children: React.ReactNode }) {
  const { needsSetup } = useSetupGuardState();
  if (needsSetup === null) return <SetupGuardRetry />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  return <>{children}</>;
}
// SetupGuard 同构（!needsSetup → /login）
function SetupGuardRetry() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '40vh' }} data-testid="setup-guard-retry">
      <Spin size="large" />
      <p style={{ marginTop: 16 }}>Connecting to server…</p>
    </div>
  );
}
```

- [ ] **Step 4: 运行通过 + 全量门禁**

Run: T5.4 → PASS；`pixi run npx vitest run`（313 基线 0 新失败）；tsc 双绿
Run: `NO_PROXY=... playwright test --project=chromium` → 59/1 无新失败（重点观察 layout/error-pages spec 是否被 guard 行为变化影响——它们渲染真实路由树）

- [ ] **Step 5: Commit**

```bash
git add apps/admin-ui/src/hooks/useSetupGuardState.ts apps/admin-ui/src/api/setup.ts apps/admin-ui/src/App.tsx e2e/setup-real-flow.spec.ts
git commit -m "fix(ui): setup guard three-state + auto-retry — backend-down no longer dumps to /login"
```

---

### Task 2: dev EXIT trap 不再停 infra

**Files:**
- Modify: `accessbase.sh:158-175`（`cleanup_native` 拆分：dev 进程击杀留 trap，infra 停止移除）

**Interfaces:**
- Consumes: `scripts/native/{pg-stop,redis-stop}.sh`（`stop` 命令继续直接调用它们）
- Produces: `dev` 被杀/正常退出都**不再**碰 PG/Redis；infra 停止的唯一入口是 `bash accessbase.sh stop`；`wait -n` fail-fast 路径（accessbase.sh:199 附近）同步更新——进程崩了停另一个 dev 进程，但 infra 留给用户诊断/复用

- [ ] **Step 1: 改造 cleanup_native**

```bash
    # Cleanup on exit — kill dev server processes ONLY.
    # Infra (PG/Redis) lifecycle belongs to `accessbase.sh stop`:
    # a killed dev session must not take the database down with it
    # (reset→stop→dev boot-window bug, 2026-09-02).
    _native_cleaned=0
    cleanup_native() {
        [ "$_native_cleaned" -eq 1 ] && return
        _native_cleaned=1
        log_info "Stopping dev servers..."
        if [ -f "$pidfile" ]; then
            while IFS= read -r pid; do
                if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                    kill -15 "$pid" 2>/dev/null || true
                fi
            done < "$pidfile"
            rm -f "$pidfile"
        fi
        # orphan sweep — mirrors cmd_stop_native exactly (incl. PIT-028 fix)
        pkill -15 -f "tsx watch src/index.ts" 2>/dev/null || true
        pkill -15 -f "@accessbase/server dev" 2>/dev/null || true
        pkill -15 -f "watch src/index.ts" 2>/dev/null || true
        pkill -15 -f "vite -- --host" 2>/dev/null || true
        sleep 1
        log_ok "Dev servers stopped (infra left running — use 'accessbase.sh stop' to stop PG/Redis)"
    }
    trap cleanup_native EXIT
```

（以脚本实际代码为准：sweep 三行改为与 cmd_stop_native 现状一致——`tsx watch src/index.ts`、`@accessbase/server dev`、`vite -- --host`，PIT-028 修正模式 `watch src/index.ts` 已在 stop 里，dev 的 trap 对齐即可。上述代码块是意图说明，实施时读脚本现文。）

同时 `wait -n` fail-fast 分支（~line 199）：删去其中的 `cleanup_native` 对 infra 的部分——它调用的就是同一个 `cleanup_native`，拆分后自动只剩 dev 进程击杀，确认日志文案即可。

- [ ] **Step 2: 手验（真杀真起）**

```bash
# 场景 A: dev 运行中 Ctrl+C（SIGINT）→ dev 进程死，PG/Redis 存活
bash accessbase.sh dev &   # 或前台跑后 Ctrl+C
kill -INT <dev 的进程组>
# 验证: 5101/5173 down；psql -c "SELECT 1" 仍通；redis-cli ping → PONG
# 输出含 "infra left running"

# 场景 B: SIGKILL 外力杀 → 同 A（trap 不保证执行，orphan 由 stop 兜底——已有行为）
# 场景 C: stop → 4 端口全清（回归确认 stop 未被破坏）
bash accessbase.sh stop
# 验证: 5101/5173/5432/6379 全 free

# 场景 D（原 bug 闭环）: reset → stop → dev → 立即开页面
#   → 落 /setup（不再 /login），向导出现
```

- [ ] **Step 3: 手验场景 D 后重建基线 admin（若场景 D 用了 reset）**

```bash
ADMIN_EMAIL=admin@accessbase.local ADMIN_PASSWORD='bQ0zGWZHX2hp0sJ5' \
DATABASE_URL=... REDIS_URL=... pixi run pnpm --filter @accessbase/server dev  # 起→bypass 日志→停
curl /api/v1/setup/status → adminExists:true
```

- [ ] **Step 4: Commit**

```bash
git add accessbase.sh
git commit -m "fix(dev): EXIT trap kills dev servers only — infra lifecycle belongs to stop"
```

---

### Task 3: E2E 全量回归 + 文档

**Files:**
- Modify: `.agents/memorys/status.md`（近期工作行）
- Modify: `.agents/memorys/pitfalls.md`（PIT-029: guard fail-open 陷阱）

- [ ] **Step 1: PIT-029 记录**

```markdown
## PIT-029: 前端 guard 对后端不可达 fail-open → reset 后无法进入向导 (2026-09-02)

- **症状**: reset→stop→dev 后访问站点落在 /login，向导不出现；后端恢复后需手动刷新才恢复
- **根因**: GlobalGuard/SetupGuard 的 checkSetupStatus().catch(() => setNeedsSetup(false)) 把"检查失败"等同"无需 setup"；dev EXIT trap 连带停 PG/Redis 加长不可达窗口
- **解法**: checkSetupStatus 三态（ok 标志）+ useSetupGuardState 3s 自动重试；dev trap 只杀 dev 进程
- **验证**: T5.4 E2E（abort status → retry testid → 恢复后自动进 /setup）；dev 被杀后 psql 仍通
- **禁止**: guard catch 分支做路由决策；EXIT trap 停 infra
```

- [ ] **Step 2: 全量回归**

```bash
NO_PROXY="localhost,127.0.0.1" pixi run npx playwright test --project=chromium   # 59/1 无新失败
NO_PROXY="localhost,127.0.0.1" pixi run npx playwright test --project=setup-real # 6/6（T5.4 加入后）
pixi run npx vitest run   # 313 0 新失败
pixi run npx tsc --noEmit; pixi run npx tsc --noEmit -p apps/admin-ui/tsconfig.json
```

- [ ] **Step 3: status.md 近期工作追加**

```markdown
- 2026-09-02: Guard 容错修复（backend-down 三态+自动重试 / dev trap 不停 infra / PIT-029；E2E +T5.4，基线无回归）
```

- [ ] **Step 4: Commit**

```bash
git add .agents/memorys/
git commit -m "docs: PIT-029 guard fail-open pitfall + status sync"
```

---

## 验收清单（人工，实施完成后逐项打勾）

- [ ] 场景 D 闭环：`reset → stop → dev` → 立即开页面 → 重试态出现 → 数秒内自动进 /setup 向导（不再落 /login）
- [ ] dev Ctrl+C / 被杀后：`psql SELECT 1` 通、`redis-cli ping` PONG、页面若开着会自动恢复
- [ ] `stop` 后 4 端口全清（stop 行为未被破坏）
- [ ] 全量门禁：vitest 313 / E2E 59+1 与 6/6 / tsc 双绿
