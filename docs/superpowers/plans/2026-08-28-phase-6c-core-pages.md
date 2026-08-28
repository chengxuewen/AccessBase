# Phase 6c — Core Pages: Roles CRUD / Users Refactor / Audit Viewer / Profile / Quick Wins / Layout Enhancement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement. Each task follows TDD: write failing test -> verify fail -> implement -> verify pass -> commit.
> **Upstream dependency:** Phase 6a wires roles routes to RoleManager + audit middleware; Phase 6b adds change-password + SessionManager. This plan defines minimal GET /permissions backend (TDD in Task 1) and assumes 6a/6b endpoints exist by execution time. If not, backend stubs ship alongside frontend.
> **No @testing-library/react in devDeps** — all component-level tests are Playwright mock-API E2E specs.
> **6a/6b plan files do not exist yet** — endpoint shapes defined from roles.ts/users.ts/app.ts as-is.

**Goal:** Ship 7 frontend pages (Roles, Users detail, Audit, Profile, 403/404, layout enhancement) + 1 shared component (EmptyState) + GlobalErrorBoundary, each backed by automated E2E with mock APIs. No manual browser verification.

**Architecture:** Pages in `apps/admin-ui/src/pages/`, API clients in `apps/admin-ui/src/api/`. Routes centralized in `App.tsx`. i18n in `en.json`/`zh.json` updated per task. Backend additions: GET /permissions, GET /audit-logs, POST /auth/sessions/revoke-others — all TDD via vitest `fastify.inject` following `apps/server/src/__tests__/routes.test.ts`.

---

## Global Constraints

- API paths use `/v1/` prefix — client.baseURL='/api', so requests are `/v1/roles` not `/roles`
- No `as any` / `@ts-ignore` / `@ts-expect-error`
- Zustand persist only business data (token, refreshToken, user, isAuthenticated) — never UI state
- E2E: unique data via `Date.now()`, mock API by default via `page.route`
- Console error filter: findDOMNode / chrome-extension / moz-extension / ResizeObserver are NOT app errors
- Modal buttons: `'Confirm'` / `'确认'` or `.ant-modal .ant-btn-primary`
- Each task ends with: `tsc --noEmit` root + admin-ui -> E2E run -> 0 errors
- `vitest run`: `pixi run npx vitest run <file>`
- `playwright test`: `pixi run npx playwright test --project=chromium e2e/<file>.spec.ts`
- Test app build pattern: `vi.mock('@fastify/cors')` -> `buildApp()` -> `app.inject()`
- E2E test files live at repo root `e2e/`, NOT `apps/admin-ui/e2e/`
- Test layer: Playwright mock-API E2E (no @testing-library/react in devDeps)

---

## Task 1 — Roles CRUD Page + Permissions API

**Files:**
| Action | Path |
|--------|------|
| Create | `apps/admin-ui/src/api/roles.ts` |
| Create | `apps/admin-ui/src/pages/Roles.tsx` |
| Modify | `apps/admin-ui/src/App.tsx` (add /roles route) |
| Modify | `apps/admin-ui/src/i18n/locales/en.json` (add roles.* keys) |
| Modify | `apps/admin-ui/src/i18n/locales/zh.json` (add roles.* keys) |
| Create | `e2e/roles-crud.spec.ts` |
| Create | `apps/server/src/routes/permissions.ts` (minimal GET endpoint) |
| Modify | `apps/server/src/app.ts` (register permissions route) |
| Create | `apps/server/src/__tests__/permissions.test.ts` (backend TDD) |

**Consumes backend endpoints:**
| Method | Path | Query/Body | Response |
|--------|------|------------|----------|
| GET | `/api/v1/roles` | `?page=&pageSize=&search=` | `{ success, data: Role[], total }` |
| GET | `/api/v1/roles/:id` | — | `{ success, data: Role }` |
| POST | `/api/v1/roles` | `{ name, description?, parentId?, permissionIds? }` | `{ success, data: Role }` |
| PUT | `/api/v1/roles/:id` | `{ name?, description?, permissionIds? }` | `{ success, data: Role }` |
| DELETE | `/api/v1/roles/:id` | — | `{ success: true }` |
| GET | `/api/v1/permissions` | `?page=&pageSize=` | `{ success, data: Permission[], total }` |

**Role response shape:**
```ts
interface Role {
  id: string; name: string; description?: string; parentId?: string;
  permissionIds?: string[]; createdAt: string; updatedAt: string;
}
interface Permission {
  id: string; resource: string; action: string; description?: string;
}
```

### Backend TDD (Task 1a — permissions endpoint)

- [ ] Write failing test: `apps/server/src/__tests__/permissions.test.ts`
  - Pattern: `vi.mock('@fastify/cors')` -> `buildApp()` -> `app.inject({ method: 'GET', url: '/api/v1/permissions' })`
  - Test 1: unauthenticated GET returns 401
  - Test 2: authenticated returns `{ success: true, data: [], total: 0 }`
  - Run: `pixi run npx vitest run apps/server/src/__tests__/permissions.test.ts` — FAIL
- [ ] Implement: `apps/server/src/routes/permissions.ts`
  - GET `/`: PermissionManager.findAll({ page, pageSize }) -> `{ success, data, total }`
  - Auth hook: `app.addHook('preHandler', (app as any).authenticate)`
  - Register in `app.ts`: `await app.register(permissionRoutes, { prefix: '/api/v1/permissions' })`
  - Run tests — PASS
  - Commit: `feat(server): add GET /api/v1/permissions endpoint`

### Frontend E2E (Task 1b — Roles page)

- [ ] Write `e2e/roles-crud.spec.ts` with page.route mocks:
  - beforeEach: mock login -> navigate `/roles` -> wait for table
  - Mock fixtures: MOCK_ROLES (2 items), MOCK_PERMISSIONS (2 items)
  - Tests: list rows (count=2), create (modal -> fill -> submit -> row appears), edit (prefilled modal -> save), delete (popconfirm -> row removed), Transfer visible in modal
  - Run: FAIL (no /roles route)

- [ ] Create `apps/admin-ui/src/api/roles.ts`:
  - Exports: `Role`, `Permission` interfaces
  - Functions: `listRoles`, `getRole`, `createRole`, `updateRole`, `deleteRole`, `listPermissions`
  - Pattern: `client.get('/v1/roles', { params })` returning `data.data`

- [ ] Create `apps/admin-ui/src/pages/Roles.tsx`:
  - ProTable columns: name, description, permissions count, createdAt, actions (edit/delete)
  - Create button -> Modal with Form + Transfer for permissions
  - Edit: Modal with prefilled data + Transfer with pre-selected keys
  - Delete: Popconfirm
  - Pattern: matches Users.tsx (useRef<ActionType>, Form.useForm, state for modal)

- [ ] Modify `apps/admin-ui/src/App.tsx`: add `<Route path="roles" element={<Roles />} />`

- [ ] Add i18n keys to `en.json` + `zh.json`:
  - `roles.title`, `roles.name`, `roles.description`, `roles.parentRole`, `roles.permissions`, `roles.permissionCount`, `roles.noPermissions`, `roles.createdAt`, `roles.actions`, `roles.create`, `roles.createTitle`, `roles.editTitle`, `roles.deleteConfirm`, `roles.nameRequired`, `roles.createSuccess`, `roles.createError`, `roles.updateSuccess`, `roles.updateError`, `roles.deleteSuccess`, `roles.deleteError`, `roles.transferAvailable`, `roles.transferSelected`

- [ ] Run E2E — PASS | tsc 0 errors | Commit: `feat(admin-ui): roles CRUD with permission transfer + E2E`

**Produces:** Route `/roles` consumed by Task 6 (sidebar), Task 7 (regression).

---

## Task 2 — Users Page Refactor (Dedicated Routes)

**Files:**
| Action | Path |
|--------|------|
| Modify | `apps/admin-ui/src/pages/Users.tsx` (list-only, remove modals) |
| Create | `apps/admin-ui/src/pages/users/UserCreate.tsx` |
| Create | `apps/admin-ui/src/pages/users/UserDetail.tsx` |
| Create | `apps/admin-ui/src/pages/users/UserEdit.tsx` |
| Modify | `apps/admin-ui/src/App.tsx` (nested /users routes) |
| Modify | `apps/admin-ui/src/api/users.ts` (no changes needed, functions exist) |
| Modify | `apps/admin-ui/src/i18n/locales/en.json` (add users.detail.* keys) |
| Modify | `apps/admin-ui/src/i18n/locales/zh.json` (add users.detail.* keys) |
| Rewrite | `e2e/users-crud.spec.ts` (update navigation paths) |

**Consumes backend endpoints (all existing):**
| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/v1/users` | `?page=&pageSize=&search=` | `{ success, data: User[], total }` |
| GET | `/api/v1/users/:id` | — | `{ success, data: User }` |
| POST | `/api/v1/users` | `{ email, name, password }` | `{ success, data: User }` |
| PUT | `/api/v1/users/:id` | `{ name?, avatarUrl? }` | `{ success, data: User }` |
| PATCH | `/api/v1/users/:id/status` | `{ status: 'active'|'suspended' }` | `{ success, data: User }` |
| DELETE | `/api/v1/users/:id` | — | `{ success: true }` |
| GET | `/api/v1/roles` | `?page=&pageSize=` | `{ success, data: Role[], total }` (Task 1 backend) |

**User shape (from existing api/users.ts):**
```ts
interface User {
  id: string; email: string; name: string; avatar?: string;
  isActive: boolean; tenantId: string; tokenVersion: number;
  createdAt: string; updatedAt: string;
}
```

### Steps

- [ ] Rewrite `e2e/users-crud.spec.ts` with new routes:
  - beforeEach: mock login -> `/users`
  - Mock users + roles APIs
  - Tests: list table, create (navigate /users/create -> fill -> submit), detail (/users/:id shows name/email/status toggle), edit (/users/:id/edit -> fill -> save), delete (detail -> confirm -> redirect), status toggle (PATCH)
  - FAIL (no nested routes)

- [ ] Modify `apps/admin-ui/src/pages/Users.tsx`:
  - Remove Modal components, keep only ProTable
  - Name column renders `<Link to={'/users/' + id}>{name}</Link>`
  - Create button -> `navigate('/users/create')`
  - Remove edit/delete actions (moved to detail page)

- [ ] Create `apps/admin-ui/src/pages/users/UserCreate.tsx`:
  - Card + Form (name, email, password) + optional roleIds Select
  - Submit -> `createUser()` -> `navigate('/users')`

- [ ] Create `apps/admin-ui/src/pages/users/UserDetail.tsx`:
  - useParams -> `getUser(id)` -> display name, email, status Switch, timestamps
  - Edit button -> navigate `/users/:id/edit`
  - Delete: Popconfirm -> `deleteUser(id)` -> navigate `/users`
  - Status Switch: `changeUserStatus(id, status)` with `PATCH /users/:id/status`

- [ ] Create `apps/admin-ui/src/pages/users/UserEdit.tsx`:
  - useParams -> fetch user + roles -> pre-fill form
  - Form: name, roleIds (Select multiple)
  - Submit -> `updateUser(id, values)` -> navigate `/users/:id`

- [ ] Modify `apps/admin-ui/src/App.tsx`:
  ```tsx
  <Route path="users" element={<Users />} />
  <Route path="users/create" element={<UserCreate />} />
  <Route path="users/:id" element={<UserDetail />} />
  <Route path="users/:id/edit" element={<UserEdit />} />
  ```

- [ ] Add i18n keys to `en.json` + `zh.json`:
  - `users.detail.title`, `users.detail.editUser`, `users.detail.statusLabel`, `users.detail.statusActive`, `users.detail.statusSuspended`, `users.detail.createdAt`, `users.detail.updatedAt`, `users.detail.deleteConfirm`, `users.detail.deleteSuccess`, `users.detail.deleteError`, `users.detail.statusToggleSuccess`, `users.detail.statusToggleError`, `users.detail.roles`, `users.detail.noRoles`, `users.createTitle`, `users.createSuccess`, `users.createError`, `users.updateSuccess`, `users.updateError`, `users.nameRequired`, `users.emailRequired`, `users.emailInvalid`, `users.passwordRequired`

- [ ] Run E2E — PASS | tsc 0 errors | Commit: `refactor(admin-ui): users with dedicated routes + detail/edit/create + E2E`

**Produces:** Routes `/users/create`, `/users/:id`, `/users/:id/edit` consumed by Task 6, Task 7.

---

## Task 3 — Audit Log Viewer

**Files:**
| Action | Path |
|--------|------|
| Create | `apps/admin-ui/src/api/audit.ts` |
| Create | `apps/admin-ui/src/pages/Audit.tsx` |
| Modify | `apps/admin-ui/src/App.tsx` (add /audit route) |
| Modify | `apps/admin-ui/src/i18n/locales/en.json` (add audit.* keys) |
| Modify | `apps/admin-ui/src/i18n/locales/zh.json` (add audit.* keys) |
| Create | `e2e/audit-viewer.spec.ts` |
| Create | `apps/server/src/routes/audit.ts` (GET endpoint) |
| Modify | `apps/server/src/app.ts` (register audit route) |
| Create | `apps/server/src/__tests__/audit-routes.test.ts` (backend TDD) |

**Consumes backend endpoints:**
| Method | Path | Query | Response |
|--------|------|-------|----------|
| GET | `/api/v1/audit-logs` | `?page=&pageSize=&action=&actor=&startDate=&endDate=` | `{ success, data: AuditLog[], total }` |

**AuditLog shape:**
```ts
interface AuditLog {
  id: string; action: string; actor: string; target?: string;
  details?: Record<string, unknown>; ipAddress?: string; createdAt: string;
}
```

### Backend TDD (Task 3a)

- [ ] Write failing test: `apps/server/src/__tests__/audit-routes.test.ts`
  - Tests: unauthenticated 401, authenticated returns empty stub, query params accepted
  - FAIL (no route)

- [ ] Implement: `apps/server/src/routes/audit.ts`
  - GET `/` with querystring schema: page, pageSize, action, actor, startDate, endDate
  - Stub: return empty array (real data wired in 6a)
  - Register: `await app.register(auditRoutes, { prefix: '/api/v1/audit-logs' })`
  - PASS | Commit: `feat(server): add GET /api/v1/audit-logs endpoint`

### Frontend E2E (Task 3b)

- [ ] Write `e2e/audit-viewer.spec.ts` with mock API:
  - Mock MOCK_LOGS (3 items with varied actions)
  - Tests: list 3 rows, filter by action (1 row), filter by actor, CSV export button visible
  - FAIL

- [ ] Create `apps/admin-ui/src/api/audit.ts`:
  - Export `AuditLog`, `ListAuditParams` interfaces, `listAuditLogs` function

- [ ] Create `apps/admin-ui/src/pages/Audit.tsx`:
  - ProTable columns: action, actor, target, ipAddress, createdAt
  - Search: action Select, actor Input, DatePicker.RangePicker
  - CSV export button: client-side from current page data (tooltip: "current page only")

- [ ] Modify `apps/admin-ui/src/App.tsx`: add `<Route path="audit" element={<Audit />} />`

- [ ] Add i18n keys to `en.json` + `zh.json`:
  - `audit.title`, `audit.action`, `audit.actor`, `audit.target`, `audit.ipAddress`, `audit.createdAt`, `audit.export`, `audit.exportTooltip`, `audit.filterAction`, `audit.filterActor`, `audit.filterDateRange`, `audit.startDate`, `audit.endDate`, `audit.noData`, `audit.search`

- [ ] Run E2E — PASS | tsc 0 errors | Commit: `feat(admin-ui): audit viewer with filters + CSV export + E2E`

**Produces:** Route `/audit` consumed by Task 6 (sidebar), Task 7 (regression).

---

## Task 4 — Profile Center

**Files:**
| Action | Path |
|--------|------|
| Create | `apps/admin-ui/src/api/auth.ts` |
| Create | `apps/admin-ui/src/pages/Profile.tsx` |
| Modify | `apps/admin-ui/src/App.tsx` (add /profile route) |
| Modify | `apps/admin-ui/src/i18n/locales/en.json` (add profile.* keys) |
| Modify | `apps/admin-ui/src/i18n/locales/zh.json` (add profile.* keys) |
| Create | `e2e/profile.spec.ts` |
| Modify | `apps/server/src/routes/auth.ts` (add POST /sessions/revoke-others) |
| Create | `apps/server/src/__tests__/auth-sessions.test.ts` (backend TDD) |

**Consumes backend endpoints:**
| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/v1/users/me` | — | `{ success, data: { id, email, name, isActive } }` (existing) |
| PUT | `/api/v1/users/:id` | `{ name? }` | `{ success, data: User }` (existing) |
| POST | `/api/v1/auth/change-password` | `{ currentPassword, newPassword }` | `{ success: true }` (from 6b) |
| POST | `/api/v1/auth/sessions/revoke-others` | — | `{ success: true }` (new in this task) |

**Decision:** Profile edit reuses `PUT /api/v1/users/:id` — no new endpoint needed.

### Backend TDD (Task 4a)

- [ ] Write failing test: `apps/server/src/__tests__/auth-sessions.test.ts`
  - Tests: unauthenticated 401, authenticated returns `{ success: true }`
  - FAIL

- [ ] Implement: add POST `/sessions/revoke-others` in `apps/server/src/routes/auth.ts`
  - Auth required. Stub: return `{ success: true }` (SessionManager from 6b handles real revocation)
  - PASS | Commit: `feat(server): add POST /api/v1/auth/sessions/revoke-others`

### Frontend E2E (Task 4b)

- [ ] Write `e2e/profile.spec.ts` with mock API:
  - Mock MOCK_ME, PUT /users/1, POST change-password, POST revoke-others
  - Tests: displays name/email, edit name saves, change password validates+submits, logout other devices button works
  - FAIL

- [ ] Create `apps/admin-ui/src/api/auth.ts`:
  - `changePassword(data)`, `revokeOtherSessions()`

- [ ] Create `apps/admin-ui/src/pages/Profile.tsx`:
  - Fetch user via `getCurrentUser()`, display Card with name/email/status
  - Edit name: inline edit using `updateUser(id, { name })`
  - Change password: Form (currentPassword, newPassword, confirmPassword) -> `changePassword()`
  - Logout other devices: Popconfirm button -> `revokeOtherSessions()`

- [ ] Modify `apps/admin-ui/src/App.tsx`: add `<Route path="profile" element={<Profile />} />`

- [ ] Add i18n keys to `en.json` + `zh.json`:
  - `profile.title`, `profile.personalInfo`, `profile.name`, `profile.email`, `profile.status`, `profile.editName`, `profile.saveName`, `profile.changePassword`, `profile.currentPassword`, `profile.newPassword`, `profile.confirmPassword`, `profile.currentPasswordRequired`, `profile.newPasswordRequired`, `profile.newPasswordMinLength`, `profile.confirmPasswordRequired`, `profile.confirmPasswordMismatch`, `profile.passwordChangeSuccess`, `profile.passwordChangeError`, `profile.nameUpdateSuccess`, `profile.nameUpdateError`, `profile.logoutOtherDevices`, `profile.logoutOtherDevicesConfirm`, `profile.logoutOtherDevicesSuccess`, `profile.logoutOtherDevicesError`

- [ ] Run E2E — PASS | tsc 0 errors | Commit: `feat(admin-ui): profile center with password change + session revoke + E2E`

**Produces:** Route `/profile` consumed by Task 6 (UserDropdown), Task 7 (regression).

---

## Task 5 — Quick Wins: Error Pages, ErrorBoundary, EmptyState, Breadcrumbs

**Files:**
| Action | Path |
|--------|------|
| Create | `apps/admin-ui/src/pages/errors/Forbidden.tsx` (403) |
| Create | `apps/admin-ui/src/pages/errors/NotFound.tsx` (404) |
| Create | `apps/admin-ui/src/components/GlobalErrorBoundary.tsx` |
| Create | `apps/admin-ui/src/components/EmptyState.tsx` |
| Create | `apps/admin-ui/src/components/Breadcrumbs.tsx` |
| Modify | `apps/admin-ui/src/App.tsx` (error routes + ErrorBoundary + catch-all 404) |
| Modify | `apps/admin-ui/src/layouts/AdminLayout.tsx` (add Breadcrumbs below content) |
| Modify | `apps/admin-ui/src/i18n/locales/en.json` (add errors.* + empty.* keys) |
| Modify | `apps/admin-ui/src/i18n/locales/zh.json` (add errors.* + empty.* keys) |
| Create | `e2e/error-pages.spec.ts` |

**No new backend endpoints.**

### Steps

- [ ] Write `e2e/error-pages.spec.ts`:
  - Tests: /403 renders AntD Result 403, /nonexistent renders 404, back buttons navigate to /dashboard
  - FAIL

- [ ] Create `apps/admin-ui/src/pages/errors/Forbidden.tsx`:
  - AntD `<Result status="403" title="403" subTitle="..." />` with Back button -> `navigate('/dashboard')`

- [ ] Create `apps/admin-ui/src/pages/errors/NotFound.tsx`:
  - AntD `<Result status="404" title="404" subTitle="..." />` with Back button -> `navigate('/dashboard')`

- [ ] Create `apps/admin-ui/src/components/GlobalErrorBoundary.tsx`:
  - Class component `extends React.Component<{children}, {hasError, error}>`
  - `componentDidCatch(error, info)` -> setState hasError
  - Render: AntD Result status="error" with error message + retry button -> `this.setState({ hasError: false })`

- [ ] Create `apps/admin-ui/src/components/EmptyState.tsx`:
  - Props: `type: 'no-data' | 'no-result' | 'first-use' | 'error'`, optional title, description, action
  - Wraps AntD `<Empty>` with description and optional Button
  - Per type defaults: no-data -> "No data", no-result -> "No results found", error -> "Load failed"

- [ ] Create `apps/admin-ui/src/components/Breadcrumbs.tsx`:
  - `useLocation()` -> split pathname -> map segments to breadcrumb items
  - Render AntD `<Breadcrumb>` with Links
  - Hardcoded map: { dashboard: 'Dashboard', users: 'Users', roles: 'Roles', audit: 'Audit', profile: 'Profile' }

- [ ] Modify `apps/admin-ui/src/App.tsx`:
  - Add `<Route path="403" element={<Forbidden />} />`
  - Add `<Route path="404" element={<NotFound />} />`
  - Replace catch-all `<Route path="*" element={<Navigate to="/" replace />} />` with `<Route path="*" element={<NotFound />} />`
  - Wrap admin layout children in `<GlobalErrorBoundary>`

- [ ] Modify `apps/admin-ui/src/layouts/AdminLayout.tsx`:
  - Add `<Breadcrumbs />` component between ProLayout header and Outlet

- [ ] Add i18n keys to `en.json` + `zh.json`:
  - `errors.forbidden.title`, `errors.forbidden.subTitle`, `errors.notFound.title`, `errors.notFound.subTitle`, `errors.backToDashboard`, `errors.retry`, `errors.unexpected.title`, `errors.unexpected.subTitle`
  - `empty.noData.title`, `empty.noData.description`, `empty.noResult.title`, `empty.noResult.description`, `empty.firstUse.title`, `empty.firstUse.description`, `empty.error.title`, `empty.error.description`

- [ ] Run E2E — PASS | tsc 0 errors | Commit: `feat(admin-ui): 403/404 pages + ErrorBoundary + EmptyState + Breadcrumbs + E2E`

---

## Task 6 — Layout Enhancement: Sidebar + UserDropdown + Page Header

**Files:**
| Action | Path |
|--------|------|
| Modify | `apps/admin-ui/src/layouts/AdminLayout.tsx` (menu items + UserDropdown + page header) |
| Modify | `apps/admin-ui/src/App.tsx` (add route meta for titles) |
| Modify | `apps/admin-ui/src/i18n/locales/en.json` (add menu.profile, menu.logout keys) |
| Modify | `apps/admin-ui/src/i18n/locales/zh.json` (same) |
| Create | `e2e/layout.spec.ts` (new E2E for sidebar nav) |

**No new backend endpoints.**

### Steps

- [ ] Write `e2e/layout.spec.ts`:
  - Tests: sidebar shows Dashboard/Users/Roles/Audit, click each navigates correctly, UserDropdown shows profile + logout, page header title updates per route
  - FAIL

- [ ] Modify `apps/admin-ui/src/layouts/AdminLayout.tsx`:
  - Update `menuRoutes.routes` array to include:
    ```ts
    { path: '/dashboard', name: 'menu.dashboard', icon: <DashboardOutlined /> },
    { path: '/users', name: 'menu.users', icon: <UserOutlined /> },
    { path: '/roles', name: 'menu.roles', icon: <SafetyOutlined /> },
    { path: '/audit', name: 'menu.audit', icon: <AuditOutlined /> },
    ```
  - Replace bare `LogoutOutlined` in `actionsRender` with `Dropdown`:
    ```tsx
    <Dropdown menu={{ items: [
      { key: 'profile', label: t('menu.profile'), icon: <UserOutlined />, onClick: () => navigate('/profile') },
      { type: 'divider' },
      { key: 'logout', label: t('menu.logout'), icon: <LogoutOutlined />, danger: true, onClick: handleLogout },
    ] }}>
      <span>{user?.name || 'Admin'}</span>
    </Dropdown>
    ```
  - Add page header title derived from current route

- [ ] Add i18n keys to `en.json` + `zh.json`:
  - `menu.profile` ("Profile" / "个人资料")
  - `menu.logout` ("Logout" / "退出登录")
  - `menu.audit` (already exists)

- [ ] Run E2E — PASS | tsc 0 errors | Commit: `feat(admin-ui): layout enhancement with sidebar + UserDropdown + page header + E2E`

---

## Task 7 — Closeout: 4-Step Gate + E2E Regression + Memory Update

**Files:**
| Action | Path |
|--------|------|
| Verify | All modified files (no new files) |
| Update | `.agents/memorys/status.md` |
| Update | `.agents/memorys/decisions.md` (if new decisions) |

**No new backend endpoints.**

### 4-Step Frontend Delivery Gate

- [ ] Step 1: `pixi run npx tsc --noEmit` — root tsconfig, 0 errors
- [ ] Step 2: `pixi run npx tsc --noEmit -p apps/admin-ui/tsconfig.json` — 0 errors
- [ ] Step 3: Start dev server `pnpm --filter @accessbase/admin-ui dev` -> `curl -sf http://localhost:5173` returns 200
- [ ] Step 4: `pixi run npx playwright test --project=chromium` — ALL spec files pass:
  - `e2e/setup.spec.ts` (existing, must not break)
  - `e2e/users-crud.spec.ts` (rewritten in Task 2)
  - `e2e/roles-crud.spec.ts` (new in Task 1)
  - `e2e/audit-viewer.spec.ts` (new in Task 3)
  - `e2e/profile.spec.ts` (new in Task 4)
  - `e2e/error-pages.spec.ts` (new in Task 5)
  - `e2e/layout.spec.ts` (new in Task 6)

### Full E2E Regression Checklist

- [ ] All 7 spec files pass with 0 failures
- [ ] Console 0 application errors (filtered per convention)
- [ ] New routes reachable: /roles, /audit, /profile, /403, /404
- [ ] User CRUD still works: /users, /users/create, /users/:id, /users/:id/edit
- [ ] Existing setup.spec.ts unbroken

### Backend Gate

- [ ] `pixi run npx vitest run apps/server/src/__tests__/` — all test files pass
  - `permissions.test.ts` (Task 1)
  - `audit-routes.test.ts` (Task 3)
  - `auth-sessions.test.ts` (Task 4)
  - `routes.test.ts` (existing, must not break)

### Memory Update

- [ ] Update `.agents/memorys/status.md`: mark Phase 6c complete, list new pages/routes/tests
- [ ] Update `.agents/memorys/decisions.md` if any new architectural decisions were made

---

## File Modification Summary

| File | Tasks |
|------|-------|
| `apps/admin-ui/src/App.tsx` | 1, 2, 3, 4, 5, 6 |
| `apps/admin-ui/src/i18n/locales/en.json` | 1, 2, 3, 4, 5, 6 |
| `apps/admin-ui/src/i18n/locales/zh.json` | 1, 2, 3, 4, 5, 6 |
| `apps/admin-ui/src/layouts/AdminLayout.tsx` | 5, 6 |
| `apps/admin-ui/src/pages/Users.tsx` | 2 (modify) |
| `apps/server/src/app.ts` | 1, 3 |
| `apps/server/src/routes/auth.ts` | 4 (add endpoint) |
| `.agents/memorys/status.md` | 7 |

## New Files Created (25)

| File | Task |
|------|------|
| `apps/admin-ui/src/api/roles.ts` | 1 |
| `apps/admin-ui/src/api/audit.ts` | 3 |
| `apps/admin-ui/src/api/auth.ts` | 4 |
| `apps/admin-ui/src/pages/Roles.tsx` | 1 |
| `apps/admin-ui/src/pages/Audit.tsx` | 3 |
| `apps/admin-ui/src/pages/Profile.tsx` | 4 |
| `apps/admin-ui/src/pages/users/UserCreate.tsx` | 2 |
| `apps/admin-ui/src/pages/users/UserDetail.tsx` | 2 |
| `apps/admin-ui/src/pages/users/UserEdit.tsx` | 2 |
| `apps/admin-ui/src/pages/errors/Forbidden.tsx` | 5 |
| `apps/admin-ui/src/pages/errors/NotFound.tsx` | 5 |
| `apps/admin-ui/src/components/GlobalErrorBoundary.tsx` | 5 |
| `apps/admin-ui/src/components/EmptyState.tsx` | 5 |
| `apps/admin-ui/src/components/Breadcrumbs.tsx` | 5 |
| `apps/server/src/routes/permissions.ts` | 1 |
| `apps/server/src/routes/audit.ts` | 3 |
| `apps/server/src/__tests__/permissions.test.ts` | 1 |
| `apps/server/src/__tests__/audit-routes.test.ts` | 3 |
| `apps/server/src/__tests__/auth-sessions.test.ts` | 4 |
| `e2e/roles-crud.spec.ts` | 1 |
| `e2e/audit-viewer.spec.ts` | 3 |
| `e2e/profile.spec.ts` | 4 |
| `e2e/error-pages.spec.ts` | 5 |
| `e2e/layout.spec.ts` | 6 |

## Files NOT Modified (explicit)

- `e2e/setup.spec.ts` — must not break
- `apps/admin-ui/src/pages/Login.tsx`
- `apps/admin-ui/src/pages/Dashboard.tsx`
- `apps/admin-ui/src/stores/auth.ts`
- `apps/admin-ui/src/api/client.ts`
- `.refinfo/` — read-only

## Test Count Summary

| Type | Count | Files |
|------|-------|-------|
| Backend (vitest) | 3 new files, ~8 tests | permissions.test.ts, audit-routes.test.ts, auth-sessions.test.ts |
| E2E (Playwright) | 5 new + 1 rewritten + 1 existing = 7 total, ~25 new test cases | roles-crud, users-crud, audit-viewer, profile, error-pages, layout, setup |

## Deviations

- **6a/6b plans don't exist yet:** Endpoint shapes defined from existing code (roles.ts schema, users.ts patterns). If 6a/6b implement differently, adjust at execution time.
- **PermissionManager fully stubbed:** Backend returns empty array. Frontend Transfer works against mock data in E2E.
- **Audit backend is stub:** Returns empty array. Real data depends on 6a audit middleware wiring.
- **change-password endpoint:** Assumed from 6b master plan. If not implemented, add stub in Task 4 alongside revoke-others.
- **CSV export client-side only:** Current page data, not full dataset. Documented via tooltip. Acceptable MVP.
