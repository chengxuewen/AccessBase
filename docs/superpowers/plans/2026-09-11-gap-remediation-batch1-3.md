# Gap Remediation Batch 1-3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the P0 security gaps and P1 UX/a11y defects ratified in the gap-analysis review: permission-code the audit/stats routes, fail-fast on missing production JWT secret, fix the stray-comma rendering bug, wire antd locale to i18n, unify detail-page error states, add a11y semantics, remove the Roles permission-transfer truncation, and backfill ui.md with implementation notes.

**Architecture:** Batch 1 adds two permission codes (`audit:read`, `stats:read`) to the existing seed → routePermissions dual-registration pipeline and gates the frontend routes with the existing `PrivateRoute permission=` pattern; JWT secret becomes fail-fast in production. Batch 2 is frontend-only fixes reusing existing primitives (`EmptyState` error variant, `aria-label`, `autoComplete`, i18n). Batch 3 is doc-only notes in ui.md. No schema changes, no new dependencies (batch 1-3).

**Tech Stack:** TypeScript (strict), Fastify + Drizzle, React 19 + AntD 5 + react-router v7 (declarative element guards, D116), Vitest + Playwright.

**Spec:** `.agents/memorys/decisions.md` (D115 requirePermission route), `.agents/memorys/conventions.md` (Phase 8a dual-registration constraint), team reports 2026-09-11 (ui-gap/feature-gap/quality/librarian synthesis), user ratification transcript (11 items, options A).

## Global Constraints

- Seed ↔ routePermissions dual registration: a code in seed with NO consumer, or a route mapped to a code NOT in seed, is a permanent 403/dead-code (Phase 8a convention)
- Verify counts after batch 1: `grep -c "resource: '" apps/server/src/routes/permissions-seed.ts` = **11**; routePermissions diff vs seed must be empty
- DEFAULT_TENANT from `apps/server/src/utils/constants.ts` only
- English commit messages; English code comments; English architecture/design docs (ui.md notes in English)
- Plans/AI conversation in Chinese
- No `as any` / `@ts-ignore` / `@ts-expect-error` / `eslint-disable` / console.log in prod code
- i18n new keys: strict en/zh symmetry
- Toasts only via `src/api/feedback` bridge (never static `message`/`notification` from 'antd')
- Verification env preamble: `export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1` (PIT-031)
- After every code step: `pixi run npx tsc --noEmit -p apps/admin-ui/tsconfig.json` (admin-ui changes) or root `pixi run npx tsc --noEmit`
- Baseline at plan time: vitest 364 green, e2e chromium 84 green, tsc/eslint clean

---

## Batch 1 — Security (audit:read, stats:read, JWT fail-fast)

### Task 1: Seed `audit:read` + `stats:read` permission codes

**Files:**
- Modify: `apps/server/src/routes/permissions-seed.ts` (:15-24 BUILTIN_PERMISSIONS, :27 RESOURCES, :3/:12/:31 count comments)
- Modify: `apps/server/src/__tests__/permissions-seed.test.ts` (:41 EXPECTED_PERMISSION_COUNT, :42 RESOURCES mirror)

**Interfaces:**
- Produces: two new entries in `BUILTIN_PERMISSIONS` **plus `'audit','stats'` added to `RESOURCES`** — consumed by Task 2's route mappings and by the seed read-back WHERE clause (permissions-seed.ts:44-47 `inArray(permissions.resource, RESOURCES)`) which binds the new codes to the admin role. Seed count 9 → 11.
- ⚠️ CRITICAL (review B1): extending BUILTIN_PERMISSIONS WITHOUT extending `RESOURCES` inserts the rows but never binds them to admin → admin 403 on audit/stats. The two arrays MUST move together.

- [ ] **Step 1: Add the two codes + extend RESOURCES**

In `BUILTIN_PERMISSIONS` after the permissions entries (line 24):

```typescript
  { name: 'audit:read', resource: 'audit', action: 'read', description: 'View audit logs' },
  { name: 'stats:read', resource: 'stats', action: 'read', description: 'View deployment stats' },
```

Line 27 — extend the resource whitelist:

```typescript
const RESOURCES = ['users', 'roles', 'permissions', 'audit', 'stats'];
```

Update the THREE stale count comments (`Seeds 9`/`Insert the 9 builtin permissions` — lines :3, :12, and repeat at :31 if present) to 11.

- [ ] **Step 2: Sync the test mirror constants**

`apps/server/src/__tests__/permissions-seed.test.ts`: `EXPECTED_PERMISSION_COUNT` 9 → 11 (:41); mirror `RESOURCES` add `'audit','stats'` (:42) so fake select rows cover the new codes; if fake rows derive from RESOURCES×ACTIONS the row count grows automatically — verify assertions still match.

- [ ] **Step 3: Run seed tests**

Run: `pixi run npx vitest run apps/server/src/__tests__/permissions-seed.test.ts`
Expected: PASS with count 11.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes/permissions-seed.ts apps/server/src/__tests__/permissions-seed.test.ts
git commit -m "feat(server): seed audit:read and stats:read permission codes (9->11)"
```

### Task 2: Map routes to the new codes (routePermissions)

**Files:**
- Modify: `packages/identity/src/hooks/authorize.ts` (routePermissions map, after existing entries)

**Interfaces:**
- Consumes: seed codes from Task 1.
- Produces: `GET:/api/v1/audit-logs` → `audit:read`; `GET:/api/v1/stats` → `stats:read` enforcement via existing requirePermission hook.

- [ ] **Step 1: Add mappings**

```typescript
  'GET:/api/v1/audit-logs': 'audit:read',
  'GET:/api/v1/stats': 'stats:read',
```

- [ ] **Step 2: Run authorize hook tests**

Run: `pixi run npx vitest run packages/identity`
Expected: PASS (authorize tests cover routePermissions resolution; add a case for the two new routes if the test file enumerates mappings — update enumeration expectations).

- [ ] **Step 3: Commit**

```bash
git add packages/identity/src/hooks/authorize.ts packages/identity/src/__tests__/
git commit -m "feat(identity): map audit-logs and stats routes to new permission codes"
```

### Task 3: Frontend gates — /audit route + menu + dashboard redirect

**Files:**
- Modify: `apps/admin-ui/src/App.tsx:111` (audit route), `apps/admin-ui/src/layouts/AdminLayout.tsx` (menu gating + :26 ponytail comment removal + dashboard menu `codeOf` mapping), `apps/admin-ui/src/pages/Login.tsx` (FOUR navigate('/') sites: :44 OAuth callback, :61 passkey, :72 MFA verify success, :89 password login)
- Create: `apps/admin-ui/src/utils/landing.ts` + `apps/admin-ui/src/utils/landing.test.ts`
- Modify (e2e fixtures, review B2): `e2e/auth-rbac-ui.spec.ts:5` FULL_PERMISSIONS 9→11, `e2e/layout.spec.ts` + `e2e/ui-quality.spec.ts` me-mocks (add stats:read/audit:read if permissions arrays are self-seeded), `e2e/roles-crud.spec.ts:39` permissions array

**Interfaces:**
- Consumes: `PrivateRoute permission=` (App.tsx:24-34, undefined-permissions-pass semantics), `useAuthStore` permissions array.
- Produces: `landingPath(permissions: string[] | undefined): '/' | '/profile'` pure helper — imported by all four Login.tsx navigate sites.

- [ ] **Step 1: Write landingPath helper + unit test (pure function, node env)**

`apps/admin-ui/src/utils/landing.ts`:

```typescript
export function landingPath(permissions: string[] | undefined): '/' | '/profile' {
  // undefined permissions = legacy backend → keep '/' (mirrors PrivateRoute :30 semantics)
  if (permissions === undefined) return '/';
  return permissions.includes('stats:read') ? '/' : '/profile';
}
```

`landing.test.ts` (runs under existing node-environment vitest): asserts `undefined → '/'`, `['users:read'] → '/profile'`, `['stats:read'] → '/'`, `[] → '/profile'`.

- [ ] **Step 2: Gate the /audit route**

```tsx
<Route path="audit" element={<PrivateRoute permission="audit:read"><Audit /></PrivateRoute>} />
```

- [ ] **Step 3: Gate the audit + dashboard menu items**

In `AdminLayout.tsx` menu config: wrap audit item with `hasPermission('audit:read')` (same pattern as users/roles items); ensure the dashboard menu item goes through the same `codeOf` mapping so a stats:read-less user doesn't see a clickable menu item that 403s. Delete the now-outdated ponytail comment at :26 ("audit gate waits… always visible").

- [ ] **Step 4: Dashboard route gate + landing redirect at all FOUR Login sites**

App.tsx:

```tsx
<Route path="dashboard" element={<PrivateRoute permission="stats:read"><Dashboard /></PrivateRoute>} />
```

Login.tsx: import `landingPath`; before each of the four `navigate('/')` calls (:44 OAuth, :61 passkey, :72 MFA verify, :89 password), resolve the freshest permissions and navigate via the helper. Password path: `login()` response may not include permissions → `await fetchUser()` first. MFA path (review m-D): `verifyMfa` (stores/auth.ts) only sets the token and does NOT call fetchUser — at the :72 success branch add `await fetchUser()` BEFORE reading permissions, otherwise an MFA user without stats:read lands on '/' via undefined-pass and then eats a /stats 403 — inconsistent with the other three paths. OAuth/passkey paths already populate the store via fetchUser (:43/:60). Then `navigate(landingPath(perms), { replace: true })`.

- [ ] **Step 5: Sync existing e2e me-mocks (review B2 — otherwise Final gate fails)**

`e2e/auth-rbac-ui.spec.ts:5` FULL_PERMISSIONS: append `'audit:read', 'stats:read'` + update the :4 comment "The 9 codes" → 11. Then audit every spec that self-seeds a permissions array on the /auth/me mock — `layout.spec.ts`, `ui-quality.spec.ts`, `roles-crud.spec.ts:39` (permissions: []) — any case that navigates to /dashboard or / must include stats:read. (`dashboard.spec.ts` has no permissions field → undefined → pass-through, safe.)

- [ ] **Step 6: Typecheck + lint**

Run: `pixi run npx tsc --noEmit -p apps/admin-ui/tsconfig.json && pixi run npx eslint apps/admin-ui/src/App.tsx apps/admin-ui/src/pages/Login.tsx apps/admin-ui/src/utils/landing.ts`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-ui/src/App.tsx apps/admin-ui/src/layouts/AdminLayout.tsx apps/admin-ui/src/pages/Login.tsx apps/admin-ui/src/utils/landing.ts apps/admin-ui/src/utils/landing.test.ts e2e/
git commit -m "feat(admin-ui): gate audit and dashboard routes behind audit:read/stats:read"
```

### Task 4: JWT_SECRET production fail-fast

**Files:**
- Modify: `apps/server/src/config.ts:44` (module-level `export const config`; jwtSecret property)
- Test: `apps/server/src/__tests__/config.test.ts` (create)
- Already done (review C6 confirmed): `accessbase.sh:463` passes JWT_SECRET through; `.env.example:8` has the entry — Step 5 is verify-only.

**Interfaces:**
- Produces: importing `../config` with NODE_ENV=production and no JWT_SECRET throws at module evaluation (config is a module-level const — dynamic import + `vi.resetModules()` is the test seam).

- [ ] **Step 1: Write the failing test (env-safe, review M7)**

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  vi.resetModules();
});

describe('config jwtSecret', () => {
  it('throws at import time in production without JWT_SECRET', async () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['JWT_SECRET'];
    vi.resetModules();
    await expect(import('../config')).rejects.toThrow(/JWT_SECRET/);
  });

  it('falls back to dev secret outside production', async () => {
    process.env['NODE_ENV'] = 'test';
    delete process.env['JWT_SECRET'];
    vi.resetModules();
    const { config } = await import('../config');
    expect(config.jwtSecret).toBe('dev-secret-do-not-use-in-production');
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `pixi run npx vitest run apps/server/src/__tests__/config.test.ts`
Expected: first case FAIL (no throw today), second case PASS.

- [ ] **Step 3: Implement fail-fast**

In config.ts, replace the bare fallback at line 44 with:

```typescript
function requireJwtSecret(env: NodeJS.ProcessEnv): string {
  if (env['NODE_ENV'] === 'production' && !env['JWT_SECRET']) {
    throw new Error('JWT_SECRET must be set in production. Generate: openssl rand -hex 32');
  }
  return env['JWT_SECRET'] ?? 'dev-secret-do-not-use-in-production';
}
```

Use `jwtSecret: requireJwtSecret(process.env)` at line 44 (module evaluation order: helper must be declared before the `config` const).

- [ ] **Step 4: GREEN + full server vitest**

Run: `pixi run npx vitest run apps/server` → all PASS (env restore in afterEach guards other suites from NODE_ENV leakage, review M7).

- [ ] **Step 5: Verify deploy passthrough (should already pass)**

Run: `grep -n "JWT_SECRET" accessbase.sh .env.example` → expect :463 and :8 hits. Only if missing, add following the file's existing env pattern.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/config.ts apps/server/src/__tests__/config.test.ts
git commit -m "feat(server): fail fast when JWT_SECRET missing in production"
```

### Task 5: e2e regression locks for 403 behavior

**Files:**
- Create: `e2e/route-guard-403.spec.ts`
- Modify (review m3): `apps/admin-ui/src/pages/Forbidden.tsx` — the "back to dashboard" button becomes a dead loop for stats:read-less users (dashboard now 403s them); change it to `navigate(landingPath(useAuthStore.getState().user?.permissions))` so it lands on '/' or '/profile' correctly. Also fix stale review m2 comment `e2e/auth-rbac-ui.spec.ts:4` ("The 9 codes" → 11 — also handled in Task 3 Step 5).

**Interfaces:**
- Consumes: Tasks 1-3 codes. Mock-API e2e (default convention).

- [ ] **Step 1: Add mock-driven 403 cases**

Two cases in a NEW spec `e2e/route-guard-403.spec.ts`, reusing the REAL helper `seedSessionWithMe` (review m6: `mockMe` does not exist) — read `e2e/auth-rbac-ui.spec.ts` first and copy its me-mock + `setup`/`stats` beforeEach route blocks verbatim per PIT-033 discipline (mocks mirror real route returns). 403 assertion uses the existing `.ant-result-403` selector (error-pages.spec.ts:66 precedent) — `getByText('403')` would collide with the subTitle.

```typescript
test('audit page shows 403 for user without audit:read', async ({ page }) => {
  await seedSessionWithMe(page, { permissions: ['users:read'] }); // no audit:read
  await page.goto('/audit');
  await expect(page.locator('.ant-result-403')).toBeVisible();
});
```

For the landing-redirect case (review M1): `seedSessionWithMe` plants a token WITHOUT going through Login.tsx, so the landingPath helper never runs — goto('/') → /dashboard → 403, NOT /profile. Verify the redirect behavior at the UNIT layer instead: `landing.test.ts` (Task 3 Step 1) already locks `['users:read'] → '/profile'`. In e2e, lock only what the browser can see:

```typescript
test('direct /dashboard shows 403 for user without stats:read', async ({ page }) => {
  await seedSessionWithMe(page, { permissions: ['users:read'] });
  await page.goto('/dashboard');
  await expect(page.locator('.ant-result-403')).toBeVisible();
});
```

(The real login → landing flow stays covered by auth-session e2e which drives the actual login form — extend one of its admin cases to assert final URL stays '/' for full-permission users.)

- [ ] **Step 2: Run e2e subset**

Run: `export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1 && pixi run npx playwright test e2e/route-guard-403.spec.ts e2e/auth-rbac-ui.spec.ts --project=chromium`
Expected: PASS (new cases green; zero regressions in the file).

- [ ] **Step 3: Commit**

```bash
git add e2e/
git commit -m "test(e2e): lock 403 behavior for audit/dashboard permission gates"
```

### Task 6: Update Phase-8a check commands in conventions + verify curl 403

**Files:**
- Modify: `.agents/memorys/conventions.md` (Phase 8a section count expectations 9 → 11)

**Interfaces:**
- Produces: updated expected count in the two check commands.

- [ ] **Step 1: Update conventions counts**

`应 =9` → `应 =11`; also update the seed/routePermissions diff command note if it mentions 9.

- [ ] **Step 2: Real-backend curl verification (setup-real pattern)**

Run: `export no_proxy=... ; bash accessbase.sh start:native` if infra down; login as admin; then:
`curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" http://localhost:5101/api/v1/audit-logs` → **200**
And with a non-admin user token (register via API): → **403** with `PERM_001`.
(If real-backend run is unavailable in this environment, mark this step NOT VERIFIED and rely on e2e locks; do not claim curl results without running them.)

- [ ] **Step 3: Commit**

```bash
git add .agents/memorys/conventions.md
git commit -m "docs(memory): update permission seed count expectations to 11"
```

---

## Batch 2 — UX / a11y (frontend only)

### Task 7: Remove stray comma after delete buttons (Users + Roles)

**Files:**
- Modify: `apps/admin-ui/src/pages/Users.tsx:74`, `apps/admin-ui/src/pages/Roles.tsx:141`

**Interfaces:**
- Consumes: nothing. Pure JSX text-node fix.

- [ ] **Step 1: Delete the comma inside Popconfirm children**

Both files share the same shape:

```tsx
          <Button type="link" size="small" danger>
            <DeleteOutlined /> {t('common.delete')}
          </Button>,        ← delete this comma; keep the </Popconfirm>, array comma
        </Popconfirm>,
```

Result:

```tsx
          </Button>
        </Popconfirm>,
```

- [ ] **Step 2: Typecheck**

Run: `pixi run npx tsc --noEmit -p apps/admin-ui/tsconfig.json` → 0 errors.

- [ ] **Step 3: Run affected e2e**

Run: `export no_proxy=... && pixi run npx playwright test e2e/users-crud.spec.ts e2e/roles-crud.spec.ts --project=chromium`
Expected: PASS (no assertion referenced the stray comma).

- [ ] **Step 4: Commit**

```bash
git add apps/admin-ui/src/pages/Users.tsx apps/admin-ui/src/pages/Roles.tsx
git commit -m "fix(admin-ui): remove stray comma rendered after delete buttons"
```

### Task 8: antd ConfigProvider locale + html lang sync

**Files:**
- Modify: `apps/admin-ui/src/main.tsx:15` (replace the existing `<AntdApp>` mount with LocaleGate — avoid double-mount, review C5)
- Modify: `apps/admin-ui/src/layouts/AdminLayout.tsx` (language switch handler — no change expected; LocaleGate re-renders via useTranslation)
- Create: `apps/admin-ui/src/utils/locale.ts` (pure lang resolver, testable under existing node-env vitest)
- Test: `apps/admin-ui/src/utils/locale.test.ts`

**Interfaces:**
- Consumes: i18n `language` (i18next). antd locale packs are re-exported through LocaleGate.
- Produces: `resolveLang(language: string | undefined): 'zh' | 'en'` pure helper; `<LocaleGate>` shell replacing `<AntdApp>` mount.
- Dependency note (review M3): `dayjs` is NOT a direct dependency of apps/admin-ui (pnpm strict node_modules — verified absent). This task does NOT import dayjs; zh display locale for date components comes bundled with antd's zh_CN pack. If dayjs-level formatting is later needed, add `dayjs` to admin-ui deps in a separate commit.

- [ ] **Step 1: Pure resolver + test first (review M4 — no tsx/jsdom needed)**

`apps/admin-ui/src/utils/locale.ts`:

```typescript
export function resolveLang(language: string | undefined): 'zh' | 'en' {
  return language?.startsWith('zh') ? 'zh' : 'en';
}
```

`apps/admin-ui/src/utils/locale.test.ts` (plain .ts, collected by existing vitest include):

```typescript
import { describe, expect, it } from 'vitest';
import { resolveLang } from './locale';

describe('resolveLang', () => {
  it('maps zh variants to zh', () => {
    expect(resolveLang('zh')).toBe('zh');
    expect(resolveLang('zh-CN')).toBe('zh');
  });
  it('defaults undefined and non-zh to en', () => {
    expect(resolveLang(undefined)).toBe('en');
    expect(resolveLang('en')).toBe('en');
    expect(resolveLang('fr')).toBe('en');
  });
});
```

Run RED (module absent) → create → GREEN: `pixi run npx vitest run apps/admin-ui/src/utils/locale.test.ts`

- [ ] **Step 2: LocaleGate component (no dayjs import)**

New file `apps/admin-ui/src/components/LocaleGate.tsx`:

```tsx
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { resolveLang } from '../utils/locale';

const ANT_LOCALES = { en: undefined, zh: zhCN } as const;

export function LocaleGate({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const lang = resolveLang(i18n.language);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  return (
    <ConfigProvider locale={ANT_LOCALES[lang]}>
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}
```

Mount in `main.tsx:15` replacing the current `<AntdApp>` wrapper (single source).

- [ ] **Step 3: Verify no double ConfigProvider**

`grep -rn "ConfigProvider" apps/admin-ui/src | grep -v LocaleGate` — consolidate any other mount into LocaleGate.

- [ ] **Step 4: e2e smoke (html-lang + antd builtin texts verified in browser)**

Run: `export no_proxy=... && pixi run npx playwright test e2e/profile.spec.ts e2e/settings.spec.ts --project=chromium`
Expected: PASS. (html lang and antd zh texts get browser-level coverage here since the unit layer is node-env; per review M4 the tsx-testing-library route would require new devDeps + vitest include changes — rejected.)

- [ ] **Step 5: Commit**

```bash
git add apps/admin-ui/src/components/LocaleGate.tsx apps/admin-ui/src/utils/locale.ts apps/admin-ui/src/utils/locale.test.ts apps/admin-ui/src/main.tsx
git commit -m "feat(admin-ui): wire antd locale + html lang to i18n language"
```

### Task 9: Detail-page error states — EmptyState error variant ×3

**Files:**
- Modify: `apps/admin-ui/src/pages/users/UserDetail.tsx:55-57`, `apps/admin-ui/src/pages/users/UserEdit.tsx:37`, `apps/admin-ui/src/pages/Profile.tsx:44`
- Reuse: `apps/admin-ui/src/components/EmptyState.tsx` — real props confirmed by review M5: `variant?: 'no-data'|'no-result'|'error'`, `action?: ReactNode`

**Interfaces:**
- Consumes: `EmptyState` REAL props (EmptyState.tsx:5-12, review M5): `variant?: 'no-data' | 'no-result' | 'error'`, `action?: ReactNode` (retry button injected via `action`, NOT an onRetry prop); description text is fixed internally via `t('empty.error')` — no `message` prop. `apiErrorMessage` from `src/api/errors.ts` if a server-specific line is needed (render it above EmptyState, not inside).

- [ ] **Step 1: UserDetail — error empty-state with retry via action slot**

Extract the fetch into a re-entrant `refetch` (lift out of the one-shot useEffect; same endpoint). Replace `if (!user) return null` with:

```tsx
if (loadError) {
  return (
    <Card data-testid="detail-error">
      <EmptyState
        variant="error"
        action={
          <Button type="primary" onClick={refetch}>{t('common.retry')}</Button>
        }
      />
    </Card>
  );
}
if (!user) return <Card><Spin /></Card>;
```

(Verify `common.retry` exists in both locales; if absent add it en/zh symmetric.)

- [ ] **Step 3: UserEdit + Profile**

Same shape: failure → EmptyState error + retry via `action` slot; UserEdit gets a real loading gate (review m4: today it has none — form renders only after fetch settles, fields disabled until loaded); Profile keeps its existing spinners.

- [ ] **Step 4: Add RED→GREEN e2e lock for UserDetail 404**

In `e2e/users-crud.spec.ts`, add: mock user fetch 404 → goto `/users/00000000-0000-0000-0000-000000000099` → expect error empty-state testid visible (add `data-testid="detail-error"` to the EmptyState wrapper in this page if needed for a stable selector).

- [ ] **Step 5: Typecheck + lint + e2e subset**

Run: `pixi run npx tsc --noEmit -p apps/admin-ui/tsconfig.json && export no_proxy=... && pixi run npx playwright test e2e/users-crud.spec.ts e2e/profile.spec.ts --project=chromium`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-ui/src/pages/users/UserDetail.tsx apps/admin-ui/src/pages/users/UserEdit.tsx apps/admin-ui/src/pages/Profile.tsx e2e/users-crud.spec.ts
git commit -m "fix(admin-ui): unified error empty-states with retry on detail pages"
```

### Task 10: a11y batch — aria-label ×4 + autoComplete ×6

**Files:**
- Modify: `apps/admin-ui/src/pages/Profile.tsx:148-149,189,196,208` (+ MFA inputs), `apps/admin-ui/src/pages/Dashboard.tsx:102`, `apps/admin-ui/src/pages/Audit.tsx:121`, `apps/admin-ui/src/pages/Login.tsx:~215` (password input)
- Modify: `apps/admin-ui/src/i18n/locales/{en,zh}.json` (4 new keys, strict symmetry)

**Interfaces:**
- Consumes: existing i18n infra. Produces 4 new keys: `common.confirmEdit`, `common.cancelEdit`, `dashboard.refresh`, `audit.resetFilters` (names indicative — verify no collisions via `grep -rn "confirmEdit\|cancelEdit\|'dashboard.refresh'\|audit.resetFilters" apps/admin-ui/src/i18n/`).

- [ ] **Step 1: i18n keys**

en.json: `"confirmEdit": "Confirm edit"`, `"cancelEdit": "Cancel edit"`, `"refresh": "Refresh"`, `"resetFilters": "Reset filters"` placed under existing namespaces matching usage sites (common/dashboard/audit). zh.json mirrors.

- [ ] **Step 2: aria-labels**

```tsx
<Tooltip title={t('dashboard.refresh')}>
  <Button icon={<ReloadOutlined />} aria-label={t('dashboard.refresh')} onClick={load} />
</Tooltip>
```

Apply same shape at Dashboard.tsx:102, Audit.tsx:121, Profile.tsx:148-149 (name-edit confirm/cancel; these two currently have no Tooltip — add aria-label only).

- [ ] **Step 3: autoComplete attributes**

- Login password: `autoComplete="current-password"`; (email input: `autoComplete="username"` — same a11y family, add it)
- Profile: current `current-password`, new + confirm `new-password` ×2
- Profile password inputs: `autoComplete` current-password / new-password / new-password (real lines 188/198/214, review m1). MFA code input is NOT in Profile.tsx (review m5) — locate via `grep -rn 'mfa\|otp' apps/admin-ui/src/pages` before adding `autoComplete="one-time-code"`.

- [ ] **Step 4: Typecheck + eslint + i18n parity check**

Run: `pixi run npx tsc --noEmit -p apps/admin-ui/tsconfig.json && pixi run npx eslint apps/admin-ui/src/pages/ && node -e "const en=require('./apps/admin-ui/src/i18n/locales/en.json'),zh=require('./apps/admin-ui/src/i18n/locales/zh.json');const k=(o,p='')=>Object.entries(o).flatMap(([x,v])=>typeof v==='object'?k(v,p+x+'.'):[p+x]);const a=k(en),b=k(zh);console.log('en-zh:',a.filter(x=>!b.includes(x)),'zh-en:',b.filter(x=>!a.includes(x)))"`
Expected: 0 errors, both diff arrays empty. (Review m9: do NOT rely on a jsx-a11y eslint rule as the gate — not confirmed enabled in flat config; the grep in Step 4b is the real gate.)

- [ ] **Step 4b: aria-label coverage grep (the real gate)**

Run: `grep -c "aria-label" apps/admin-ui/src/pages/Profile.tsx apps/admin-ui/src/pages/Dashboard.tsx apps/admin-ui/src/pages/Audit.tsx` → expect ≥2/≥1/≥1.

- [ ] **Step 5: e2e subset + commit**

Run: `export no_proxy=... && pixi run npx playwright test e2e/auth-session.spec.ts e2e/mfa-panel.spec.ts e2e/dashboard*.spec.ts --project=chromium` → PASS.

```bash
git add -A apps/admin-ui/src
git commit -m "fix(admin-ui): a11y pass — aria-labels on icon buttons, password autocomplete semantics"
```

### Task 11: Roles permission Transfer full-pagination fetch

**Files:**
- Modify: `apps/admin-ui/src/pages/Roles.tsx:33-35`
- Create: `apps/admin-ui/src/utils/fetchAll.ts` + `apps/admin-ui/src/utils/fetchAll.test.ts`

**Interfaces:**
- Consumes: `listPermissions({ page, pageSize })` from **`api/roles.ts:76`** (NOT api/permissions — review M6), returning `Promise<{ data: Permission[]; total: number }>` (field is `data`, not `items`; element type is `Permission`).

- [ ] **Step 1: Extract fetchAllPermissions helper with cap**

New file `apps/admin-ui/src/utils/fetchAll.ts`:

```typescript
import { listPermissions } from '../api/roles';
import type { Permission } from '../api/roles'; // roles.ts:19 exports the interface — same module as listPermissions

const HARD_CAP = 1000;
const PAGE = 100;

export async function fetchAllPermissions(): Promise<Permission[]> {
  const out: Permission[] = [];
  let page = 1;
  for (;;) {
    const res = await listPermissions({ page, pageSize: PAGE });
    out.push(...res.data);
    if (out.length >= res.total) break;
    if (out.length >= HARD_CAP) break; // ponytail: hard cap; raise when permission counts approach 1000
    page += 1;
  }
  return out;
}
```

- [ ] **Step 2: Unit test the loop (concrete, fixes placeholder flagged in review m8)**

`apps/admin-ui/src/utils/fetchAll.test.ts` (node env):

```typescript
import { describe, expect, it, vi } from 'vitest';
import { listPermissions } from '../api/roles';
import { fetchAllPermissions } from './fetchAll';

vi.mock('../api/roles', () => ({ listPermissions: vi.fn() }));

const row = (i: number) => ({ id: `p${i}`, name: `res:${i}` });

describe('fetchAllPermissions', () => {
  it('pages until total reached', async () => {
    vi.mocked(listPermissions)
      .mockResolvedValueOnce({ data: Array.from({ length: 100 }, (_, i) => row(i + 1)), total: 150 })
      .mockResolvedValueOnce({ data: Array.from({ length: 50 }, (_, i) => row(i + 101)), total: 150 });
    const all = await fetchAllPermissions();
    expect(all).toHaveLength(150);
    expect(listPermissions).toHaveBeenCalledTimes(2);
  });

  it('stops at hard cap', async () => {
    vi.mocked(listPermissions).mockResolvedValue({
      data: Array.from({ length: 100 }, (_, i) => row(i + 1)),
      total: 5000,
    });
    const all = await fetchAllPermissions();
    expect(all.length).toBeLessThanOrEqual(1000);
  });
});
```

- [ ] **Step 3: Replace the pageSize:100 call in Roles.tsx + error state**

Use `fetchAllPermissions()` in the roles modal open path; on failure show inline Alert + retry above the Transfer (same pattern as list loadError, Roles.tsx:149-160).

- [ ] **Step 4: Typecheck + vitest + e2e roles**

Run: `pixi run npx tsc --noEmit -p apps/admin-ui/tsconfig.json && pixi run npx vitest run apps/admin-ui && export no_proxy=... && pixi run npx playwright test e2e/roles-crud.spec.ts --project=chromium`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-ui/src/utils/fetchAll.ts apps/admin-ui/src/utils/fetchAll.test.ts apps/admin-ui/src/pages/Roles.tsx
git commit -m "fix(admin-ui): fetch all permissions with paged loop and hard cap for roles transfer"
```

---

## Batch 3 — Docs (ui.md implementation notes)

### Task 12: ui.md implementation-note backfill (4+1 items, English)

**Files:**
- Modify: `docs/modules/ui.md` (§14.11.1, §14.12.2, §14.8, settings-width section, §14.11.2 width values)

**Interfaces:**
- Consumes: ratified decisions from this session (antd rules over zod+RHF; apiErrorMessage over error-code map; scroll.x over table-to-card; fluid full-width + 400 form column).

- [ ] **Step 1: Add English implementation notes at the five sites**

Format at each site:

```markdown
> **Implementation note (2026-09-11):** <what shipped instead and why> (ref: conventions.md <section>)
```

1. §14.11.1: form validation ships as antd Form rules; zod+react-hook-form not adopted (ref: UserCreate.tsx as reference implementation).
2. §14.12.2: error-message mapping replaced by `apiErrorMessage` server-envelope passthrough with local fallback (supersedes ERR_001-013 static map; simpler and envelope-consistent).
3. §14.8: mobile uses `scroll={{ x: 'max-content' }}` horizontal scroll instead of table-to-card transformation (measured zero h-scroll 375-1920 on 2026-09-10).
4. Settings/Profile width: fluid full-width cards with in-card form column capped at 400px (user-ratified 2026-09-10; supersedes the 720px centered column in this doc).
5. §14.11.2 StandardForm width: document the in-use caps (Settings/Profile 400, UserCreate/Edit 560, UserDetail 640) as the measured convention instead of a single 800 value.

- [ ] **Step 2: Language-constraint check**

Run: `grep -nP '^\s*>\s*\*\*Implementation note.*[\x{4e00}-\x{9fa5}]' docs/modules/ui.md` → empty (notes are English).

- [ ] **Step 3: Commit**

```bash
git add docs/modules/ui.md
git commit -m "docs(ui): implementation notes for form validation, error mapping, responsive, width strategy"
```

---

## Final Verification Gate (after all tasks)

- [ ] `pixi run npx vitest run` → all green (baseline 364 + new)
- [ ] `export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1 && pixi run npx playwright test --project=chromium` → all green (baseline 84 + new)
- [ ] `pixi run npx tsc --noEmit` root + admin-ui → 0 errors
- [ ] `pixi run npx eslint apps/admin-ui/src packages` → 0 errors
- [ ] Conventions check commands pass: seed count = 11; routePermissions-vs-seed diff empty; `grep -rn "00000000-0000-0000-0000-000000000001" apps/server/src --include="*.ts" | grep -v constants.ts` zero hits
- [ ] Status/memory update: `.agents/memorys/status.md` append a dated line summarizing batch 1-3 (Chinese, per memory-file convention)

## Out of Scope (deferred with trigger conditions)

- Batch 4 (options store) and Batch 5 (OIDC provider via oidc-provider) — separate plans at kickoff
- `audit:export` second code — when server-side export endpoint is proposed
- Audit field-level redaction for non-admin auditors — when an auditor role is requested
- HMAC removal (RS256-only) — separate architecture decision
