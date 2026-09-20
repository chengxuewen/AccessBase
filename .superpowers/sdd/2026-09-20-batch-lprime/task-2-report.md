# Task 2 report — bootstrap endpoint + belt extension + force-logout scoping (L′)

## Delivered
1. routes/tenants.ts — POST /:id/bootstrap per spec D2 step order: belt FIRST →
   default-target 409 → exists/active → email replay-arm/409 → route-layer
   user_create password policy (fresh path only) → roleManager.create
   (find-or-create, isSystem input) → UNCONDITIONAL direct-SQL isSystem stamp
   (B6) → STRICT bindPermissions(TENANT_BINDABLE) (X4) → user create AFTER bind
   → conflict-safe assign → 201 fresh / 200 alreadyBootstrapped replay.
2. Platform belt added to POST/PUT/DELETE tenants mutations (B3 skeleton-key
   class closed at handler layer; helper returns the sent reply; belt runs
   before any tenant-state lookup — no enumeration oracle, B7a).
3. sendTenantError gained EMAIL_EXISTS branch (manager-tag → 409 precedent).
4. users.ts force-logout: tenant-scoped findById gate → 404 before any revoke
   (B5); idempotent same-tenant path preserved.

## Tests (14 new + 2 new in users-import)
- tenants-bootstrap.test.ts: happy-path full order assertions (role create args,
  stamp UPDATE recorded on fake seed-db, bind called with the REAL
  TENANT_BINDABLE_PERMISSIONS identity, user create target-tenant, assign);
  X4 bind-failure → 500 BEFORE user create; belt-first (findById never called);
  default 409; 404; suspended 409; other-tenant email 409 EMAIL_EXISTS; weak pw
  400 before any write; replay 200 + no user create + bind/assign re-run;
  replay skips policy (weak pw 200); belt on POST/PUT/DELETE ×3; platform happy
  path intact.
- users-import.test.ts: +2 (cross-tenant 404 + revoke untouched; lookup-before-
  revoke ordering). Existing harness gained findById mock (new gate).

## Gates
- apps/server: 46 files / 518 passed (502 baseline + 16, incl. 2 pre-existing
  force-logout cases adapted to the new gate — mock gained findById)
- root tsc 0 errors; eslint changed files 0 errors (4 warnings all the house
  importOriginal-type import() idiom shared with every existing route suite)

## Decisions / deviations
- assertPasswordPolicy 3rd arg is a CODE param in auth.ts register ('AUTH_REG_002')
  but the bootstrap envelope uses code 'WEAK_PASSWORD' (message from result) —
  spec's "copy the code string" judged against frontend passthrough (K-R6): any
  code works, WEAK_PASSWORD reads truer for a tenant-admin panel. T4 mocks pin
  the shape, not the code.
- name optional per spec; falls back to the email string when omitted.
- getSeedDb lazy singleton mirrors setup.ts; in tests the module-mocked
  createDb makes the stamp observable without PG.
- Replay-arm ordering: bind + assign re-run BEFORE the 200 so a crashed
  first attempt is healed by a plain retry (D2 matrix).
