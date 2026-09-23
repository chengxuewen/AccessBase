# Q2 Production Foundations — Design Spec

**Date**: 2026-09-23 · **Driver**: docs/superpowers/reports/2026-09-23-gap-audit.md §D (service-gap 31 findings) · **Baseline**: `7129404`
**Control finding (escalated beyond the audit)**: manager constructors `new Pool()` per instance (`UserManager.ts:24-25`, `RoleManager.ts:40`, `SessionManager.ts:37`, `TenantManager.ts:53` — no max), and routes instantiate them **inside handlers** via `new (await import('@accessbase/identity')).UserManager()` (28 sites). Every such request permanently leaks one pg Pool + its sockets (leaked pools are never GC'd; sockets stay open) → PG `max_connections=100` exhaustion within ~100 mutations. The audit's D2 ("per-manager pools at boot") under-described it; this is a per-request leak bomb.

## Scope split

- **Q2a (this spec, implement now)**: A manager-singletons + pool max, B close-shutdown wiring, C migrate advisory lock, D session-cache EX, E audit-retention + sessions sweeper, F drain + degraded-mode metrics + pool gauges.
- **Q2b (follow-on spec after Momus round 1 lands Q2a)**: transactions on multi-write funnels (`transactDb` + optional tx param on 6 funnel methods), cross-node cache invalidation (Redis pub/sub for permission-cache/options), shared pagination helper, openapi.json build artifact, CHANGELOG, backup scheduler sample. Explicitly NOT Q2: kid rotation / SLO / policy engine (Q3), webhooks/FGA/groups (Q4), OTel tracing (deferred — heavy deps, log-field requestId/traceId contract documented instead).

## Items (Q2a)

### A. Route-level manager singletons + PG_POOL_MAX

- New `apps/server/src/utils/managers.ts`: lazy module singletons `userManager() roleManager() tenantManagerRef() sessionManager()` (the latter two may already exist as `getTenantManager`/`getOptionsManager` — REUSE those, only add what's missing: check each). Each constructs `new X()` once per process — same singleton pattern as `getTenantManager()` (auth.ts /me already uses it) and `getOptionsManager()`.
- Replace all 28 in-handler `new (await import('@accessbase/identity')).XManager()` with the getter calls. Plugin-scope `new X()` at route-file top (auth.ts:68 roleManager, scim.ts:112, saml.ts:36) are ALREADY once-per-app-registration — leave them (they're bounded by app instance count; index.ts builds one app).
- Test-seam audit (MANDATORY before landing, this is the PIT-B-jsonb class risk): every server test that mocks `@accessbase/identity` classes via `vi.mock` factory (constructor mock) still intercepts `new` inside utils/managers.ts ✓; but tests asserting "N-th request creates a fresh manager" or poking `UserManager.mock.results[last]` see ONE instance forever — grep roster: `grep -ln "mock.results" apps/server/src/__tests__/*.ts` and adapt per-file (sessions tests use `mockClear` on methods, not ctor — verify).
- `createDb`: `new Pool({ connectionString: url, max: Number(process.env['PG_POOL_MAX'] ?? 10) })` + `.env.example` key + warnDegradedChecks untouched. Integration tests pass explicit databaseUrl — unaffected (max still applies).

### B. Shutdown wiring

- app.ts onClose: alongside `stopSweeper()`, call `shutdownManagers()` from utils/managers.ts → `close()` on each singleton that owns a pool (UserManager: no close today — add `close()` calling `closeDb(this.db)`, same shape as TenantManager.ts:236-237 precedent). Guarded idempotent; singleton refs reset to undefined so a second buildApp in one process re-creates (vitest isolation convention per health-pool.test lesson: memoized-promise + double-reset).
- index.ts shutdown: app.close() already runs onClose ✓; verify pool sockets actually end (live battery: boot server, 5 requests, stop, assert pg_stat_activity for app user → 0 after close).

### C. migrate.sh advisory lock (single psql session)

- Apply-loop restructure: instead of per-file `psql -1 -f`, build one psql session script: `SELECT pg_advisory_lock(<const 72724>);` then per pending file `BEGIN; \ir <file>; INSERT INTO schema_migrations...; COMMIT;` with `\set ON_ERROR_STOP on`, applied via ONE `psql -f <generated.sql>` invocation (session-scoped lock spans the run; `-1` per-file semantics preserved by explicit BEGIN/COMMIT; `\ir` resolves relative to the generated file's dir → generate it INTO the chain dir or use absolute `\ir` paths (psql `\ir` is relative to the script file — write temp script next to chain or emit absolute paths; absolute is simpler and safe since the script is mktemp'd with restrictive umask).
- Loser-replica behavior: `pg_advisory_lock` BLOCKS until the winner releases, then re-scans the ledger (already-applied → 0 files → clean exit 0). `pg_try_advisory_lock` + fail is WRONG for boot ordering (loser must wait, not crash-loop). Bounded wait via `lock_timeout` env (e.g. 120s) → clear error, exit 1.
- Static locks: ops-migrate.test.ts — script contains advisory_lock + single-session structure probe (no per-file psql loop left); legacy-stamp path untouched (stamp needs no lock? it writes the ledger → MUST be inside the same lock — fold stamp into the same session script).

### D. Session-cache TTL (last W3 residue)

- SessionManager.ts:57 `redis.set(key, JSON)` → `redis.set(key, JSON, 'EX', 3600)` (refresh-token lifetime order; read-path already falls back to DB on miss; invalidation stays the correctness mechanism). RED: session manager unit test asserts EX arg present via redis stub call shape.

### E. Audit retention + sessions sweeper (D4/D18)

- New `apps/server/src/utils/sweeper.ts`: `startRetentionSweeper(getDb)` — 24h interval (unref'd, oidc-sweeper precedent provider.ts:142-151): `DELETE FROM audit_logs WHERE created_at < now() - make_interval(days => retentionDays)` (read from config/env AUDIT_RETENTION_DAYS default 365; 0 = disabled) + `DELETE FROM sessions WHERE expires_at < now() - interval '30 days'` (revoked/expired rows are dead weight). Errors logged never thrown. stopSweeper wired into app.ts onClose (extend existing hook).
- Wire `AuditStorage`'s declared-but-dead `retentionDays` config into the same read (types.ts:97 finally gets a consumer, or the field is deleted — prefer consumer).
- RED: unit with fake db capturing SQL text (retention days interpolation guard — env is numeric-validated, never string-spliced).

### F. Drain + degraded-mode observability (D3b/D15-lite/D4-3)

- Readiness drain: index.ts shutdown sets a module-level `draining=true` BEFORE app.close(); /health/ready returns 503 while draining (existing ready handler gains one check). LBs stop sending traffic during the close window. (preStop sleep = k8s-only, documented in ops notes, not code.)
- Metrics additions in routes/metrics.ts: `accessbase_pg_pool_total/idle/waiting` gauges (collect from shared pool events or on-scrape `pool.totalCount` — pg Pool exposes counters synchronously: gauge callback reads the live pool; needs pool ref access via identity/db export `getLivePoolStats()`), `accessbase_auth_failures_total{reason=lockout|bad_credentials|rate_limited}` counter bumped at login guard 403/429 arms (bump via exported counter fn, NOT middleware parsing), `accessbase_degraded_mode{dep=redis}` gauge set when LockoutService/FlowTokenService/rate-limit fallback engages (their in-memory-fallback branches already log.warn — add a shared `markDegraded(dep, bool)` module in identity re-exported, metrics reads it).
- Alert rules artifact: `docker/prometheus/rules.yml` (auth failures spike, ready=0 for 2m, degraded_mode>0, pool waiting>5) + compose note — SHIPPED but NOT WIRED (no prometheus service in prod compose; documented sample). Static lock: file parses as YAML + rule names present.

## Gates

vitest full (987+N), 4× tsc, eslint touched 0-error, e2e 145+3, **live battery**: boot dev server → 10 authenticated request cycles → `SELECT count(*) FROM pg_stat_activity WHERE usename='accessbase'` stays ≤ single-digit constant (pre-fix: grows +1/request — capture both sides if a second worktree is cheap; else document the math from code) → SIGTERM → connections → 0 (drain + close proof). migrate.sh: live-fire fresh + idempotent + concurrent-double-run (two `migrate.sh` simultaneously against a scratch DB → one waits, one applies, ledger has each file exactly once).

## Fact appendix (verified 2026-09-23)

- Per-request sites: 28 grep matches (`new (await import('@accessbase/identity')).XManager()` + inline `new UserManager()`); constructor pools: UserManager.ts:24, RoleManager.ts:40, SessionManager.ts:37, TenantManager.ts:53; MfaManager/OptionsManager accept `string | DrizzleDB` (already injectable).
- Existing singleton precedents: getOptionsManager (routes/options.ts), getTenantManager (auth.ts /me use), permission-manager pool singleton (终审 fix), health readyDbP memoized-promise + onClose double-reset (M batch).
- closeDb/WeakMap: db/index.ts:42-56; manager close(): SessionManager.ts:269, TenantManager.ts:236; UserManager/RoleManager have NO close() (add).
- migrate.sh: loop `psql -1 -f` per file at :66-69, sql() helper :28, SENTINELS :55; no lock keyword present.
- SessionManager redis set without EX: :57; delete-on-revoke path :66.
- oidc sweeper precedent: stopSweeper + interval + unref + swallow (provider.ts, wired app.ts:227).
- metrics.ts: collectDefaultMetrics + histogram + in-flight (M batch contract; fastify-plugin root scope).
- pg Pool stats: `pool.totalCount/idleCount/waitingCount` sync properties — export `getLivePoolStats()` from identity/db (keep Pool internal; return nulls-safe).
- AuditStorage retentionDays: packages/audit/src/types.ts:97,137 zero consumers (audit A2 gap-audit).
