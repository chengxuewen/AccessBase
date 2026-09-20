# Task 3 report — /auth/me tenant exposure + top-bar Tag (L′)

## Delivered
- routes/auth.ts /me: +tenantId (user row), +tenantName, +tenantIsDefault via the EXISTING lazy getTenantManager() singleton (B7b — zero per-request pools; DEFAULT_TENANT equality computed server-side, zero frontend literals G-5). Lookup failure / absent row → { tenantName: undefined, tenantIsDefault: true } → Tag hidden (visual fail-closed; /me never 500s on the tenant row).
- stores/auth.ts User: three optional fields (absent = legacy payload → hidden).
- AdminLayout avatarProps.title: Tag (data-testid="tenant-tag") rendered ONLY when tenantIsDefault === false && tenantName — zero locale keys, zero UUID literals.
- auth-sessions.test.ts: tenantManagerMock in the identity mock (fail-closed default null) + 3 cases (non-default exposes name+false; default exposes true+'Default'; throwing lookup degrades to 200 fail-closed).
- e2e/auth-session.spec.ts: +2 cases — tenant admin sees the Tag with the name; default admin sees none (29 existing /me mocks verified additive-safe: zero strict-equality assertions on the payload).

## Gates (actuals)
- vitest apps/server auth-sessions: 16/16; admin-ui suite 21/21
- tsc root + admin-ui: 0 errors; eslint changed files: clean

## Notes
- tenantIsDefault derives from DEFAULT_TENANT (utils/constants) server-side — frontend never compares names/ids.
- e2e Tag cases not yet run (playwright serial window = controller T6).
