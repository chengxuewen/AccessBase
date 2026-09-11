# Options Runtime Config Center Implementation Plan (Batch 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a key-value options store that makes runtime configuration admin-manageable without restarts — the foundation for every future settings UI (OIDC client registry, SMTP, password policy, branding).

**Architecture:** `options` table (key TEXT PK, value JSONB, updated_at) in the identity schema; `OptionsManager` (packages/identity) with startup full-load + in-memory cache and write-through invalidation; `GET/PUT /api/v1/options` behind a new `options:read`/`options:write` permission pair using the exact Batch-1 dual-registration pattern (seed + routePermissions + PrivateRoute); admin-ui Settings gains a third "Options" tab reading/writing through a new api module. Priority rule enforced in code: env-explicit > options-row > default, with per-source startup logging.

**Tech Stack:** TypeScript strict, Fastify + Drizzle (PostgreSQL 16), React 19 + AntD5, vitest + Playwright, pnpm monorepo.

**Spec:** User-ratified decision card (Item 10, option A) in session transcript 2026-09-11: options table + cache + admin API; env > options > default priority with source logging; sensitive values masked; M effort. Conventions: Phase 8a dual-registration + count expectations (now 11 → 13 after this batch).

## Global Constraints

- Dual registration: a permission code in seed WITHOUT a routePermissions consumer, or a mapping WITHOUT a seed entry, is permanent 403/dead code. After this batch: `grep -c "resource: '" apps/server/src/routes/permissions-seed.ts` = **13**; `diff <(grep -oE "'[a-z]+:(read|write|delete)'" packages/identity/src/hooks/authorize.ts | sort -u | tr -d "'") <(grep -oE "name: '[a-z]+:(read|write|delete)'" apps/server/src/routes/permissions-seed.ts | grep -oE "[a-z]+:(read|write|delete)" | sort -u)` must be empty
- DEFAULT_TENANT from `apps/server/src/utils/constants.ts` only
- English commit messages; English code comments; plans/AI conversation Chinese
- No `as any`/`@ts-ignore`/`@ts-expect-error`/`eslint-disable`/console.log
- New i18n keys strict en/zh symmetry
- Toasts only via `src/api/feedback` bridge
- Verification preamble: `export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1` (PIT-031)
- All API responses use the `{ success, data }` envelope (Phase 7 convention)
- Drizzle migrations: 3-phase pattern (preload/postsync/postload) per project convention
- Baseline: vitest 376, e2e 74 passed + 13 pre-existing failures (auth×5/dashboard×5/health×3 — A/B-proven at base; NOT this batch's problem)

---

### Task 1: options table in identity schema

**Files:**
- Modify: `packages/identity/src/db/schema.ts` (append after `webauthnCredentials`)

**Interfaces:**
- Produces: `export const options = pgTable('options', { key: text('key').primaryKey(), value: jsonb('value').notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow() })` — consumed by Task 2 (manager) and Task 3 (routes).

- [ ] **Step 1: Append the table definition**

Follow the file's existing pgTable style (jsonb is ALREADY imported at schema.ts:14 — review m13; add the row-type export per file convention):

```typescript
export const options = pgTable('options', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OptionsRow = typeof options.$inferSelect;
```

- [ ] **Step 2: Push the schema to the dev database (review M4 — otherwise the table exists only in TS and the vertical slice is dead)**

Run: `export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1 && pixi run npx drizzle-kit push` (dev DB). If native infra is down, note it in the report and run `pixi run npx drizzle-kit generate` instead so the deploy-mode migration artifact exists. Confirm the table: `psql` or the next Task-4 route test against a live db is the smoke check.

- [ ] **Step 3: Typecheck the package**

Run: `pixi run npx tsc --noEmit -p packages/identity/tsconfig.json` → 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/identity/src/db/schema.ts
git commit -m "feat(identity): add options key-value table to schema"
```

### Task 2: OptionsManager with cache + priority resolution

**Files:**
- Create: `packages/identity/src/managers/OptionsManager.ts`
- Create: `packages/identity/src/__tests__/OptionsManager.test.ts`

**Interfaces:**
- Consumes: `options` table (Task 1).
- Produces (consumed by Task 4 and future batches):
  - `class OptionsManager { constructor(databaseUrl?: string | DrizzleDB) }` — MFA-Manager-style overload, matching all six existing managers (review M3: NOT bare `DrizzleDB`; internally `databaseUrl is string ? createDb(url) : url ?? createDefaultDb()` — follow MfaManager's exact pattern)
  - `async listAll(): Promise<Array<{ key: string; value: unknown; updatedAt: Date }>>` — cached row objects (review M2: Task 4's GET needs updatedAt, plain `Record<string, unknown>` cannot supply it)
  - `async get<T>(key: string, envValue: T | undefined, defaultValue: T): Promise<T>` — resolves env > option > default with per-call source logging at debug level
  - `async set(key: string, value: unknown): Promise<void>` — upsert + cache invalidation for that key
  - `async delete(key: string): Promise<void>`
  - `invalidate(): void` — full cache reset
  - Cache ceiling comment REQUIRED in source (plan R2): `// ponytail: per-process cache; multi-instance deployments need Redis pub/sub invalidation`

- [ ] **Step 1: Write failing tests (RED)**

Fixture pattern: `vi.mock('../db/index.js')` + chainable mock db, exactly as `packages/identity/src/__tests__/PermissionManager.test.ts` does (review C). Test cases (AAA):

```typescript
// 1. env wins over option row
// 2. option row wins over default when env undefined
// 3. default used when both absent
// 4. set() upserts and next get() reflects the new value (cache invalidation)
// 5. delete() removes and get() falls back
// 6. listAll() returns rows WITH updatedAt (review M2 interface)
// 7. constructor accepts both string url and DrizzleDB instance (overload branches)
```

- [ ] **Step 2: Run to verify RED**

Run: `pixi run npx vitest run packages/identity/src/__tests__/OptionsManager.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement OptionsManager**

Cache holds row objects (`private cache: Array<{key,value,updatedAt}> | null`), lazy-loaded on first access; `get()` implements the priority chain and logs the winning source at debug level: `logger.debug({ key, source: 'env' | 'option' | 'default' }, 'option resolved')`. Upsert via `.onConflictDoUpdate({ target: options.key, set: { value, updatedAt: new Date() } })`.

- [ ] **Step 4: GREEN + package suite**

Run: `pixi run npx vitest run packages/identity`
Expected: package fully green (review m12: full-repo count 376 is asserted once, in Task 7).

- [ ] **Step 5: Commit**

```bash
git add packages/identity/src/managers/OptionsManager.ts packages/identity/src/__tests__/OptionsManager.test.ts
git commit -m "feat(identity): OptionsManager with cache and env>option>default resolution"
```

### Task 3: Seed options:read/options:write + route mappings

**Files:**
- Modify: `apps/server/src/routes/permissions-seed.ts` (BUILTIN_PERMISSIONS + RESOURCES + the THREE count comments: now 13)
- Modify: `apps/server/src/__tests__/permissions-seed.test.ts` (EXPECTED_PERMISSION_COUNT 11→13)
- Modify: `packages/identity/src/hooks/authorize.ts` (routePermissions +2)

**Interfaces:**
- Produces: `options:read` / `options:write` codes wired for Task 4's route guards.

- [ ] **Step 1: Seed entries + RESOURCES**

```typescript
  { name: 'options:read', resource: 'options', action: 'read', description: 'View runtime options' },
  { name: 'options:write', resource: 'options', action: 'write', description: 'Modify runtime options' },
```

`RESOURCES` gains `'options'`. Update all THREE count comments to 13 (:3/:12/:33) and the test's `EXPECTED_PERMISSION_COUNT` to 13. ⚠️ Review M1: the test ALSO hardcodes the literal `11` at :52 (test title), :53 (`Array.from({ length: 11 }, ...)`), :54 (comment) — all THREE literals must become 13 (or better: reference the `EXPECTED_PERMISSION_COUNT` constant), otherwise seed 13 rows vs fakeIds 11 rows → test red.

- [ ] **Step 2: routePermissions**

```typescript
  'GET:/api/v1/options': 'options:read',
  'PUT:/api/v1/options': 'options:write',
  'DELETE:/api/v1/options': 'options:write',
```

- [ ] **Step 3: Dual-registration verification + tests**

Run the two convention check commands from Global Constraints (count = 13, diff empty).
Run: `pixi run npx vitest run apps/server/src/__tests__/permissions-seed.test.ts packages/identity/src/__tests__/authorize.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes/permissions-seed.ts apps/server/src/__tests__/permissions-seed.test.ts packages/identity/src/hooks/authorize.ts packages/identity/src/__tests__/authorize.test.ts
git commit -m "feat(server): seed options permission codes and map option routes"
```

### Task 4: /v1/options routes with masking + audit redaction

**Files:**
- Create: `apps/server/src/routes/options.ts`
- Modify: `apps/server/src/app.ts` (register route module with prefix `/api/v1`)
- Test: `apps/server/src/__tests__/options-routes.test.ts` (create — follow existing route test patterns)

**Interfaces:**
- Consumes: OptionsManager (Task 2, `listAll`/`set`/`delete`), permission codes (Task 3), `config`.
- Produces:
  - `GET /api/v1/options` → `{ success, data: Array<{ key, value, updatedAt }> }` — sensitive keys masked as `'******'` (mask rule: key matches `SENSITIVE_KEY_PATTERN = /secret|password|token|key/i`)
  - `PUT /api/v1/options` body `{ key, value }` → key format validated server-side (`/^[a-z][a-zA-Z0-9_.]{1,63}$/`, same regex the UI Form mirrors — single source documented in code comment), value must be JSON-serializable; PUT with masked placeholder value `'******'` on a sensitive key is REJECTED 400 (review M5: prevents writing the mask back into storage)
  - `DELETE /api/v1/options/:key` → 204

**DI wiring (review M9):** follow the stats.ts precedent — module-scope lazy singleton + testable seam (`setOptionsManager()` test hook), NOT app.decorate (app.ts decorates nothing) and NOT index.ts construction. Copy the stats.ts pattern (`grep -n "setStatsDb\|let statsDb" apps/server/src/routes/stats.ts`).

- [ ] **Step 1: Write failing route tests**

Follow the existing route-test pattern in `apps/server/src/__tests__/` (build app via the shared test helper — check `grep -rln "buildApp\|inject(" apps/server/src/__tests__ | head -3`). Cases: (1) read masked vs unmasked; (2) PUT validates key format (400 bad key); (3) PUT roundtrip then GET reflects value; (4) PUT with value `'******'` on sensitive key → 400 (M5); (5) DELETE → 204; (6) 403 for user without options:read / options:write (mock auth user without codes); (7) key matching each sensitive-pattern word is masked in GET. NOTE (review m10): do NOT assert audit-middleware coverage in vitest — the audit hook does not register under nodeEnv==='test'; audit coverage is an inspection item confirmed by review C (app.ts:180-187 covers non-GET /api/v1/*).

- [ ] **Step 2: RED → implement → GREEN**

Implementation notes:
- OptionsManager via the stats.ts lazy-singleton + seam pattern (above).
- `SENSITIVE_KEY_PATTERN` named constant with comment: single source of truth for both server masking and PUT rejection; the UI mirrors it for display only.
- **Audit redaction (review M6):** the global audit onResponse hook records non-GET bodies — `PUT /api/v1/options` with a secret would leak plaintext into `audit_logs.requestBody`. Add `/api/v1/options` to the audit hook's exclusion list (same mechanism as the existing `/api/v1/setup` exclusion) — simpler than sanitization; note this decision in the options.ts header comment.
- All handlers wrapped in the standard error envelope pattern.

Run: `pixi run npx vitest run apps/server` → package fully green (review m12).

- [ ] **Step 3: Register in app.ts**

Register with prefix `/api/v1` alongside other route modules (same `register(x, { prefix: '/api/v1' })` shape).

- [ ] **Step 4: Full server suite + typecheck**

Run: `pixi run npx tsc --noEmit && pixi run npx vitest run apps/server packages/identity`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/options.ts apps/server/src/app.ts apps/server/src/__tests__/options-routes.test.ts
git commit -m "feat(server): options CRUD routes with masking and audit redaction"
```

### Task 5: siteName — wizard becomes the first options WRITER (final-review fix: the 'setup stored value' layer does not exist)

**Files:**
- Modify: `apps/server/src/routes/setup.ts` — TWO changes: (1) the config step (:362-384, currently a log-and-return STUB that only logger.info's siteName and returns {saved:true} without persisting anything) additionally calls `optionsManager.set('site.name', siteName)` — the wizard becomes the first writer; (2) the status endpoint additionally returns `siteName` resolved via `optionsManager.get('site.name', undefined, 'AccessBase')` — chain is simply option > default (no middle layer).
- Modify: `apps/server/src/index.ts` (startup log after OptionsManager cache warm): `[options] site.name resolved from <option|default>`
- Test: extend the existing setup route test

**Interfaces:**
- Consumes: OptionsManager.set/get.
- Produces: wizard config step persists siteName into options; `/api/v1/setup/status` returns resolved `siteName`.

- [ ] **Step 1: Wizard config step writes the option**

In the config handler (:362-384), after the existing schema validation: `await optionsManager.set('site.name', parsed.siteName)`. This fixes the pre-existing stub (it never stored anything) as a side effect — ratified approach (a).

- [ ] **Step 2: status returns the resolved value**

`siteName: await optionsManager.get('site.name', undefined, 'AccessBase')` in the status response. Resolution chain: option row (set by wizard or admin UI) > 'AccessBase'.

- [ ] **Step 3: Test**

Extend the setup route test: (1) config step with siteName 'Custom' then status → returns 'Custom'; (2) status without any option row → returns 'AccessBase'.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src
git commit -m "feat(server): setup wizard persists site name into options; status resolves through options"
```

### Task 6: Admin UI — Options tab in Settings

**Files:**
- Create: `apps/admin-ui/src/api/options.ts` (list/set/delete via ApiEnvelope generics — Phase 7 convention)
- Modify: `apps/admin-ui/src/pages/Settings.tsx` (third tab "Options")
- Modify: `apps/admin-ui/src/i18n/locales/{en,zh}.json` (new keys, symmetric)

**Interfaces:**
- Consumes: `/v1/options` endpoints (Task 4), feedback bridge for toasts, `AppBridge` modal instance.
- Produces: Options tab with a table of key/value/updatedAt + "Add option" modal form (key input + JSON value textarea with parse-error inline validation) + edit + delete (Popconfirm, danger okButton) + masked display for sensitive keys.

- [ ] **Step 1: api module**

```typescript
import client from './client';
import type { ApiEnvelope } from './types';

export interface OptionRow { key: string; value: unknown; updatedAt: string; }
export const listOptions = () => client.get<ApiEnvelope<OptionRow[]>>('/v1/options');
export const setOption = (key: string, value: unknown) => client.put<ApiEnvelope<OptionRow>>('/v1/options', { key, value });
export const deleteOption = (key: string) => client.delete<ApiEnvelope<void>>(`/v1/options/${encodeURIComponent(key)}`);
```

(client.ts has ONLY a default export — review m8; ApiEnvelope lives in api/types.ts:6.)

- [ ] **Step 2: Settings Options tab**

Table columns: key / value (masked `******` display when key matches the client-side mirror of SENSITIVE_KEY_PATTERN) / updatedAt (dayjs relative) / actions (edit, delete-Popconfirm with danger okButton). Add-option Modal with Form: key (pattern rule mirroring server `/^[a-z][a-zA-Z0-9_.]{1,63}$/`), value (TextArea, JSON.parse validation with inline error). Toasts via feedback bridge.

**Permission gate + mask write-back guard (reviews m11 + M5):** the Options TAB must check `useAuthStore((s) => s.hasPermission)` with `'options:read'` and hide for users without it (Settings.tsx currently has NO hasPermission usage — this is the first; the store defines it at stores/auth.ts:150). For EDIT of a sensitive row: the Modal must NOT prefill the masked `'******'` into the value field — show an empty field with placeholder "enter new value (leave blank to keep current)" and only PUT when non-blank. e2e adds the case: edit sensitive option with blank value → no masked placeholder persisted (M5).

- [ ] **Step 3: i18n keys**

At minimum: `settings.options`, `settings.options.add`, `settings.options.keyPlaceholder`, `settings.options.valuePlaceholder`, `settings.options.invalidJson`, `settings.options.invalidKey`, `settings.options.deleteConfirm`, `settings.options.saveSuccess` — en/zh symmetric (parity check command from batch 1-3 Task 10).

- [ ] **Step 4: e2e lock**

New file `e2e/options.spec.ts` following route-guard-403.spec.ts patterns: mock GET/PUT/DELETE `/api/v1/options` + auth/me with full permissions → navigate Settings → Options tab visible → add option flow → masked display check → delete flow. PLUS a no-permission case: me-mock without options:read → tab hidden.

- [ ] **Step 5: Typecheck + lint + parity + e2e**

Run: `pixi run npx tsc --noEmit -p apps/admin-ui/tsconfig.json && pixi run npx eslint apps/admin-ui/src && export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1 && pixi run npx playwright test e2e/options.spec.ts e2e/settings.spec.ts --project=chromium`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-ui/src e2e/options.spec.ts
git commit -m "feat(admin-ui): options management tab in settings"
```

### Task 7: Final verification + memory

**Files:**
- Modify: `.agents/memorys/status.md`, `.agents/memorys/conventions.md` (count expectations 11→13)

- [ ] **Step 1: Full gates**

Run: `pixi run npx tsc --noEmit && pixi run npx tsc --noEmit -p apps/admin-ui/tsconfig.json && pixi run npx vitest run && export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1 && pixi run npx playwright test --project=chromium`
Expected: vitest all green; e2e = 74+N passed with ONLY the 13 known pre-existing failures (any NEW failure = investigate before proceeding).

- [ ] **Step 2: Update memory files**

conventions.md: two check commands' expected counts 11→13. status.md: dated Chinese line for batch 4 (English not required — memory files stay Chinese per convention).

- [ ] **Step 3: Commit**

```bash
git add .agents/memorys/
git commit -m "docs(memory): record options config center completion"
```

---

## Out of Scope (deferred)

- Options value encryption at rest (current masking is display-level; encryption lands with the first real secret consumer — OIDC client secrets, Batch 5)
- Options audit trail beyond the global audit middleware (per-key history if ever needed)
- Bulk import/export of options

## Risks

- **R1:** JSONB value typing leaks `unknown` into UI — mitigated by UI-side JSON.parse validation and server-side serializability check
- **R2:** Cache staleness across multiple server instances (single-instance assumption) — noted ceiling: cache invalidation is per-process; multi-instance deployments need Redis pub/sub invalidation (ponytail: document ceiling in OptionsManager comment, upgrade when horizontal scaling lands)
