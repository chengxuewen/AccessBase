# Batch L (Ops P0) — Production Brick-Bug Fixes + CI Enforcement + Process Defenses

**Date**: 2026-09-20
**Status**: Draft for dual-Momus review
**Driver**: Ops-readiness audit (three-lens scan, batch-K close-out). User decision: ops P0 before the multi-tenant control plane.

## Problem Statement

The container and deploy run modes — the two shipped production paths — **silently apply zero migrations**. Both entrypoints invoke `packages/migration/dist/cli.js up`, but that CLI loads TypeScript modules from a `./migrations` directory that does not exist; `loadMigrations()` swallows the error and returns `[]`, and the callers append `|| true` / `2>/dev/null || log_warn` on top. A fresh container or deploy database therefore starts with **zero tables**, and the server fails at runtime with cryptic column-not-found errors long after the "migration" step logged success.

Supporting gaps found by the same scan:

| # | Gap | Evidence |
|---|-----|----------|
| G1 | Entrypoint migration no-op (container) | `docker/entrypoint.sh:32` — `node packages/migration/dist/cli.js up \|\| true` |
| G2 | Entrypoint migration no-op (deploy) | `scripts/deploy/start.sh:113` — same CLI, `2>/dev/null`, "Migration skipped" |
| G3 | No baseline stamp for existing push-managed DBs — running the chain against them re-applies 0000 and explodes | no tracking table written by `db:push` |
| G4 | CI runs zero of the 26 e2e specs | `.github/workflows/ci.yml` has no Playwright job |
| G5 | 80% coverage thresholds configured but never enforced (CI omits `--coverage`) | `vitest.config.ts:7-16`, `ci.yml:59` |
| G6 | `selfHealSeed` is fire-and-forget, single attempt — DB down at boot leaves admin permanently 403 until process restart | `index.ts:40`, `permissions-seed.ts:145-153` |
| G7 | No `uncaughtException` / `unhandledRejection` handlers | `apps/server/src/index.ts` |
| G8 | Deploy mode: server crash → `wait` returns → EXIT trap kills PG + Redis too (whole stack dies with one request-path bug) | `start.sh:78-90,147` |
| G9 | Optional-but-degraded features produce no boot-time signal (MFA key / SMTP / OAuth / SAML / SMS silently off) | `config.ts` defaults |

## Goals

- **G-A**: A fresh container-mode and deploy-mode database ends up with the full drizzle chain (16 tables) applied, tracked, and idempotent across restarts.
- **G-B**: An existing database that was created via `db:push` (schema already present, no tracking table) is **baseline-stamped** instead of re-applied — the chain never explodes on legacy DBs.
- **G-C**: Migration failure becomes loud: non-zero exit, visible error, services stopped from starting on a broken schema.
- **G-D**: CI runs the Playwright chromium suite and enforces the coverage gate that already exists in config (or re-baselines it to measured truth — see Decision D3).
- **G-E**: A transient DB outage at boot no longer permanently wedges admin permissions (bounded retry).
- **G-F**: Process-level crash visibility (unhandled rejections/exceptions logged + deterministic exit) and deploy-mode crash containment (server restarts; stack does not cascade-die).
- **G-G**: Boot log names every silently-disabled optional feature (warn once, no fail-fast — K-T4 R3 lesson).

## Non-Goals (explicitly deferred)

- `/metrics` + Prometheus/OTel (monitoring.md §13 implementation) — its own batch.
- Backup/restore tooling (pg_dump, RPO story) — next ops batch.
- `/health/ready` per-request pool reuse; startup-gate on seed completion — backlog.
- Compose-dev-mode schema-init cleanup (entrypoint-dev already pushes; leave working alone).
- Any tenant control-plane / RBAC config-surface work (separate L′/M batches).
- Retiring `packages/migration` custom CLI. It keeps serving its SDD 3-phase contract for `.ts`-style migrations; only the **runtime entrypoints** stop calling it (Decision D1).

## Design

### D1 — Migration runner: shared bash + psql script over the committed drizzle SQL chain

The runtime images already ship `packages/migration/drizzle/*.sql` (container: `COPY /app/packages/`; deploy: `build.sh` copies the package dir) and both environments have `psql`. No new dependency, no drizzle-kit at runtime (it is a devDep; its `up:pg` would also need TS config compilation inside the container — rejected).

New file **`scripts/migrate.sh`** (sourced logic, also directly executable), taking `DATABASE_URL` (or psql env) + chain dir:

1. Ensure tracking table: `CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`.
2. **Baseline stamp (G-B)**: if `schema_migrations` is empty AND table `users` exists → insert every chain filename as applied with a sentinel note; log `baseline stamped`. This is the push-managed/legacy-DB reconciliation the audit found missing.
3. Apply each not-yet-applied `NNNN_*.sql` in lexicographic order via `psql -v ON_ERROR_STOP=1 -1 -f` inside a transaction, inserting its id into `schema_migrations` immediately after success (per-file transaction: chain files are single-purpose DDL; a mid-chain failure leaves prior files applied and the next startup retries the failing file).
4. Any application failure → print the failing file + psql stderr, `exit 1`. Callers must NOT swallow.

Callers:
- `docker/entrypoint.sh`: replace line 32 with `bash /app/scripts/migrate.sh || { echo "MIGRATION FAILED"; exit 1; }`. Entrypoint `set -e` already guards; removing `|| true` is the point.
- `scripts/deploy/start.sh`: replace line 113 with `bash "${PROJECT_ROOT}/scripts/migrate.sh" || { log_error "Migrations failed — aborting"; exit 1; }` (before server start, after PG up — same position).
- Chain dir resolves relative to the script (`SCRIPT_DIR/../packages/migration/drizzle`) with an override arg so both /app (container) and out/ (deploy symlink) layouts work — implementation detail for the plan to pin via both paths.

**Verified invariant**: chain (0000-0004) is currently in sync with `packages/identity/src/db/schema.ts` (no drift); future batches keep the discipline via existing generate step. No auto-drift-check in this batch (backlog with /metrics).

### D2 — `selfHealSeed` bounded retry (G6)

Refactor `permissions-seed.ts`: extract `runSelfHealOnce(dbUrl)` (current body) + export `selfHealSeed(dbUrl, { attempts = 6, delayMs = 5000 })` looping with fixed delay (no exponential — a DB outage past 30s is an ops event, not a thundering-herd scenario: one server, one table). Between attempts log at `warn`, final failure at `error` with a "seed missing — guarded routes 403" hint. `index.ts` call site unchanged (`void selfHealSeed(...)`) — still no startup side effects in `buildApp()` (Phase 8a constraint preserved). Test seam: inject `runOnce` to assert retry counts without a real DB.

### D3 — CI: e2e job + coverage enforcement (G4, G5)

- New `e2e` job in `ci.yml`: services `postgres:16` + `valkey/redis:8` (healthcheck-gated), `pnpm install --frozen-lockfile`, `pnpm build` (needed — server dev script + identity dist resolution), then `npx playwright test --project=chromium` with `--workers=1`? CI config already sets `retries: 2, workers: 1` via `playwright.config.ts` CI branch — reuse it, no flag. Upload `playwright-report` + trace on failure (artifact). env: `DATABASE_URL`/`REDIS_URL` pointing at service containers, `JWT_SECRET`, `MFA_ENCRYPTION_KEY` (32-byte hex test value), `no_proxy` set.
  - Reality gate (plan task 0): run the suite locally against a real fresh-PG backend to enumerate which specs need the backend vs mock; CI must start server via playwright `webServer` (already configured) — if any suite today hard-requires the wizard-state of `reset:native`, pin a clean DB so `setup/status` returns needsSetup=true deterministically. If the full suite cannot be made green in CI in this batch, ship the job running a **pinned subset** (explicit `--grep` or testDir list) with the rest registered as backlog — loud partial beats silent zero.
- Coverage: change test job step to `pnpm test:coverage`. Decision rule: if measured coverage ≥ configured thresholds today → done; if not → lower thresholds to floor(measured) − 0 rounded down to nearest 5, add `ponytail:` comment ratchet note, and open backlog item. Report measured numbers either way (no fake gate).

### D4 — Process defenses (G7, G8)

- `apps/server/src/index.ts`: `process.on('uncaughtException', err => { logger.fatal({ err }, 'uncaught exception'); process.exit(1); })` and `unhandledRejection` → same shape. Deterministic-exit (container `restart: unless-stopped` / L-(D4b) deploy loop then recovers). Placed before `listen()`.
- `scripts/deploy/start.sh`: wrap server launch in a restart loop — `DEPLOY_STOPPING=0` flag set by `cleanup()`; loop: start server, `wait`, if flag set exit, else `log_warn "server exited (code $?) — restarting in 3s"` and relaunch. Human-interruptible as before (trap unchanged). No systemd (out of scope for a bash deploy path; K R3 lesson: don't invent supervisors the platform doesn't have).

### D5 — Boot degrade-warning sweep (G9)

In `config.ts` after parse: `export function warnDegraded(config, isProd)` — a fixed checklist `[ {when, msg} ]` evaluated once: `MFA_ENCRYPTION_KEY` empty → "MFA enrollment/setup unavailable"; SMTP unset → "password-reset/magic-link email disabled"; no OAuth provider env/options → "OAuth login off"; SAML unset → …; `WEBAUTHN_ORIGIN` still localhost default while `NODE_ENV=production` → suspicious; `SITE_URL` empty in prod → "magic-link origin falls back to request host". `logger.warn` one line each. **No behavior change** (fail-fast rejected for optional features — K-T4 R3 precedent: prod fail-fast bricks shipped paths; these are genuinely optional).

## Testing Plan (TDD where testable in vitest)

| Task | Test | Layer |
|------|------|-------|
| L-T1 | vitest spawning `scripts/migrate.sh` against real PG (skipIf PG probe per H′ convention): fresh → 16 tables + 5 tracked rows; pre-push DB (create `users` ad hoc, no tracking) → stamped not applied (subsequent `SELECT` on chain's CREATE TABLE must NOT fire); re-run → zero-op; corrupt SQL (temp file) → exit 1 loud | integration, `skipIf` |
| L-T1 | static assertion: neither entrypoint contains the old `cli.js up` invocation or `|| true` on migrate | unit (grep-in-test) |
| L-T2 | CI YAML is not unit-tested; proven by push (report to user). Local proxy: `pnpm test:coverage` runs green with thresholds (or re-baselined per D3) | command gate |
| L-T3 | `selfHealSeed` retry: injected failing-then-succeeding `runOnce` → attempts 2, warn logged; always-failing → attempts N, error logged; success-first → attempts 1 | unit |
| L-T4 | handler registration present (index.ts import side-effect test is fragile — static-source assertion test, precedent: route-guard.test static asserts) | unit |
| L-T5 | `warnDegraded` pure-function cases (empty key → warn line; set → silent) | unit |
| All | root tsc + admin tsc + eslint (new files clean), full vitest, full e2e chromium (local, mock-API), container smoke: `docker build` + fresh-volume run → `psql \dt` shows 16 tables + `/health/ready` db:true | gate |

## Risks / Rollback

- **R-1**: deploy `out/` layout may not include `drizzle/*.sql` → migrate.sh must fail loudly with "chain dir missing" (never stamp-empty). build.sh copy loop verification is plan task 1 step 0.
- **R-2**: baseline-stamp heuristic could stamp a genuinely-partial DB (e.g. push done against older schema). Accepted: same failure mode exists today via `db:push` (push reconciles schema directly; the chain only matters for image-pinned deployments). Documented in conventions.
- **R-3**: per-file `-1` transaction fails on SQL that cannot run in a transaction; drizzle-kit generated DDL is transaction-safe. If a future file breaks it, drop `-1` for that file only (noted in script comment).
- **R-4**: CI e2e flakiness on shared runners (4-min local suite). Mitigations already in place: workers=1, retries=2, health.spec self-skips. Subset-pin escape hatch per D3.

## Success Criteria

1. Fresh `start:container` and `start:deploy` on empty volumes → server reachable, `/health/ready` db:true, `\dt` = 16 tables, tracking table has 5 rows.
2. Same container restarted → no re-apply, exit 0.
3. Legacy push-managed DB in deploy → stamp path, no CREATE TABLE errors, server healthy.
4. Injected bad SQL file → loud exit 1, services not started.
5. CI green with an e2e job that visibly runs ≥ the pinned subset, and a coverage number printed + gated.
6. `selfHealSeed` survives DB-down-at-boot within 30s window (retry log lines present).
7. Kill -9 the deploy server process → stack survives, server auto-restarts.
