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

The container runtime image ships the chain (`COPY /app/packages/` whole-dir, Dockerfile:93). **Deploy's `out/` does NOT** — build.sh copies only `dist` + `package.json` per package. Resolved without touching build.sh: the chain dir is migrate.sh's **required first positional arg** — container passes `/app/packages/migration/drizzle`, deploy passes repo-root `${PROJECT_ROOT}/packages/migration/drizzle` (start.sh always runs from the repo checkout). Both environments have `psql`; no drizzle-kit at runtime (devDep; its `up:pg` needs TS-config compilation in-container and writes an unrelated `__drizzle_migrations` table — rejected). The Dockerfile runtime stage must add `COPY --chmod=755 scripts/migrate.sh /app/scripts/migrate.sh` — `scripts/` is otherwise absent from the image (entrypoint.sh itself lands at `/entrypoint.sh`).

New file **`scripts/migrate.sh`** (bash + psql, executable), signature: `migrate.sh <chain-dir>` (required; missing dir or zero `NNNN_*.sql` files → exit 1 loud, never stamp-empty). Connection: `psql "$DATABASE_URL"` when set, else bare `psql` relying on PG\* socket env (container has trust socket; deploy exports DATABASE_URL at start.sh:106 with TCP trust):

1. Ensure tracking table: `CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), note text)`.
2. **Baseline stamp (G-B)**: if `schema_migrations` is empty AND table `users` exists → insert every chain filename with `note='stamped'`; log `baseline stamped`. Then probe the **chain-head sentinel** (`SELECT phone FROM users LIMIT 1`): on error (legacy DB behind head — `/health/ready`'s SELECT 1 will never surface it, seed/admin error logs are swallowed and scattered) print a loud `legacy DB behind chain head (0004) — run db:push to reconcile` at error level and **continue, exit 0** — warn-not-fail per K-T4 R3. The reverse mis-stamp is recoverable by construction: the chain contains zero DROP/TRUNCATE (verified), so an unstamped run dies on the first CREATE with no data loss.
3. Apply each not-yet-applied `NNNN_*.sql` in lexicographic order via `psql -v ON_ERROR_STOP=1 -1 -f` inside a transaction, inserting its id into `schema_migrations` immediately after success (per-file transaction: chain files are single-purpose DDL; a mid-chain failure leaves prior files applied and the next startup retries the failing file).
4. Any application failure → print the failing file + psql stderr, `exit 1`. Callers must NOT swallow.

Callers:
- `docker/entrypoint.sh`: replace line 32 with `bash /app/scripts/migrate.sh /app/packages/migration/drizzle`. Entrypoint `set -e` aborts the container on failure (docker restart backoff recovers or surfaces); removing `|| true` is the point.
- `scripts/deploy/start.sh`: replace line 113 with `bash "${PROJECT_ROOT}/scripts/migrate.sh" "${PROJECT_ROOT}/packages/migration/drizzle" || { log_error "Migrations failed — aborting"; exit 1; }` (same position: after PG up, before server; EXIT trap reaps the started PG/Redis).
- No SCRIPT_DIR guessing: the caller owns the chain path (see above) — both invocations are pinned literals.

**Verified invariant**: chain (0000-0004) is currently in sync with `packages/identity/src/db/schema.ts` (no drift); future batches keep the discipline via existing generate step. No auto-drift-check in this batch (backlog with /metrics).

### D2 — `selfHealSeed` bounded retry (G6)

Refactor `permissions-seed.ts`: `runSelfHealOnce(dbUrl)` = **dial + probe `SELECT 1 FROM permissions` (throws on connection failure or missing core schema — the current body swallows everything at three layers, so a retry loop wrapping it verbatim is dead code: flows R1)** + then the existing swallowing body (`ensureSeedForAdmin` keeps its never-throws contract — init/setup share it). Probe-passes-but-zero-rows is legitimate pre-wizard (permissions table exists, empty): attempt-1 exits normally, no disturbance. Export `selfHealSeed(dbUrl, { attempts = 6, delayMs = 5000 })`, fixed delay (a DB outage past 30s is an ops event, not a thundering-herd scenario: one server, one table). Between attempts log at `warn`, final failure at `error` with a "seed missing — guarded routes 403" hint. `index.ts` call site unchanged (`void selfHealSeed(...)`) — `buildApp()` stays side-effect-free (route-guard.test static lock untouched). Test seam: inject `runOnce` for retry counts; the probe's throw path asserted against a bad connection string separately.

### D3 — CI: e2e job + coverage enforcement (G4, G5)

- **webServer prerequisite (flows R2)**: `playwright.config.ts:29` `command: 'pnpm run dev'` = root `pnpm -r run dev` — recursive watch tasks (`tsc --watch` ×8 + `tsx watch`) never exit and starve vite under CI's `reuseExistingServer: false` (locally masked by devs pre-starting the stack). Config fix: `command: process.env['CI'] ? 'pnpm --filter @accessbase/admin-ui dev' : 'pnpm run dev'` — vite only.
- New `e2e` job in `ci.yml`, **service-free**: `pnpm install --frozen-lockfile` → `npx playwright install --with-deps chromium` → `npx playwright test --project=chromium`. No PG/Redis services, no `pnpm build`, no DB env: admin-ui has zero runtime `@accessbase/*` imports (verified — sole hit is a comment), the chromium project carries `testIgnore: /setup-real/` (never runs DB-destroying specs), 25 of 26 specs are page.route mocks whose failure shape is identical with 5101 down (local == CI), and the only real-backend spec (health) self-probes and skips — CI must keep 5101 down (mock-run discipline). Upload `playwright-report` on failure (artifact).
  - Honest-delivery note: this job does NOT claim real-backend e2e coverage (health skips, setup-real excluded). P0-migration runtime verification happens in L-T6 container/deploy live-fire, not in CI. Escape hatch kept: if a spec misbehaves on ubuntu-latest only, pin-subset + loud backlog beats a red-dead job.
- Coverage (test job): **preserve junit passthrough** — `pnpm test:coverage -- --reporter=junit --outputFile=test-results.xml` (dorny/test-reporter consumes the file). Before gating, fix the long-broken measurement: `coverage.exclude` uses prefix strings (`'node_modules/'`, `'dist/'`) that miss the .pnpm layout (root cause of the bogus 55.46% denominator) → `['**/node_modules/**','**/dist/**','**/*.test.ts','**/*.spec.ts']` + `coverage.include: ['packages/*/src/**/*.ts','apps/*/src/**/*.{ts,tsx}']`, keep `all: true` (untouched src at 0% is the honest floor; the T0 health-0% attribution was wrong — its tests import src relatively). Re-measure once: thresholds = floor(measured) − 5 per dimension with a `ponytail:` ratchet comment; if numbers still wobble → **remove thresholds, keep the report (INFO-only)** + backlog item. One-task timebox; the e2e job ships regardless (decoupled).

### D4 — Process defenses (G7, G8)

- `apps/server/src/index.ts`: `process.on('uncaughtException', err => { app.log.fatal({ err }, 'uncaught exception'); process.exit(1); })` and `unhandledRejection` → same shape (index.ts logs via app.log today — no new logger import). Deterministic exit; container recovers via docker restart backoff, deploy via the loop below. Placed before `listen()`.
- `scripts/deploy/start.sh` restart loop — shell-interaction facts locked (blockers B1/B2/L-1):
  1. Global `set -eo pipefail` + bare `wait $SERVER_PID` kills the script at non-zero **before any restart branch** — loop body MUST be `code=0; wait "$SERVER_PID" || code=$?`, later logic reads `$code` only.
  2. `stop.sh` TERMs only the server PID (today's stop works precisely because that ends the `wait` → script exit → trap). With a loop that becomes stop→revive→(stop.sh closes PG/Redis)→zombie server owns 5101 with no PIDFILE. Fix: write wrapper `$$` to `data/.startpid`; `stop.sh` TERMs the wrapper **first** (its trap sets `DEPLOY_STOPPING=1` → loop breaks → EXIT cleanup reaps children), then existing sequence unchanged.
  3. Rewrite the current server PID into `$PIDFILE` **every iteration** (cleanup must never chase a stale generation).
  4. Crash cap: 3 exits within 15s (timestamp array) → `log_error "crash loop — aborting"` + break to cleanup (bad-env infinite 3s log spam guard). No systemd (K R3: don't invent supervisors the platform lacks).
- `Dockerfile` HEALTHCHECK: add `--start-period=60s` (first boot includes initdb + full chain apply).

### D5 — Boot degrade-warning sweep (G9)

`config.ts` gains a **pure** `warnDegradedChecks(env, isProd): string[]` (no logger import — config.ts stays side-effect-free; `index.ts` prints each line via `app.log.warn` after `buildApp`). **Env-only checklist** (options-table config is warmed after listen — invisible at boot, wording must carry the qualifier): `MFA_ENCRYPTION_KEY` empty → "MFA enrollment unavailable unless options-configured"; SMTP env unset → same qualifier; no env-level OAuth/SAML → "(options-table config not visible at boot)"; `WEBAUTHN_ORIGIN` localhost default while prod → suspicious; `SITE_URL` empty in prod → "magic-link origin falls back to request host". One warn line each. **No behavior change** (fail-fast rejected for optional features — K-T4 R3 precedent: prod fail-fast bricks shipped paths; these are genuinely optional).

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

- **R-1** (resolved by design): deploy never depends on `out/` for the chain — callers pass explicit dirs (D1). migrate.sh still exits 1 loud on missing dir / zero files.
- **R-2**: baseline-stamp could stamp a genuinely-partial (behind-head) DB. Mitigated: post-stamp chain-head sentinel emits a loud non-fatal error line (D1 step 2); push-managed DBs remain db:push-reconciled per conventions. Convention line added: runtime migration sole writer = `scripts/migrate.sh`; do not mix `db:migrate` (inert `up:pg`/`__drizzle_migrations`) against the same database.
- **R-3**: per-file `-1` transaction fails on SQL that cannot run in a transaction; drizzle-kit generated DDL is transaction-safe. If a future file breaks it, drop `-1` for that file only (noted in script comment).
- **R-4**: CI e2e flakiness on shared runners (4-min local suite). Mitigations already in place: workers=1, retries=2, health.spec self-skips. Subset-pin escape hatch per D3.

## Success Criteria

1. Fresh `start:container` and `start:deploy` on empty volumes → server reachable, `/health/ready` db:true, `\dt` = 16 tables, tracking table has 5 rows.
2. Same container restarted → no re-apply, exit 0.
3. Legacy push-managed DB in deploy → stamp path, no CREATE TABLE errors; behind-head volume (no `users.phone`) → loud chain-head error line, exit still 0.
4. Injected bad SQL file → loud exit 1, services not started.
5. CI green with the service-free e2e job running the chromium project (vite-only webServer, 5101 down), junit intact, and a coverage number printed + gated — or INFO-only per the M3 timebox fallback.
6. `selfHealSeed` survives DB-down-at-boot within 30s window (probe-failure retry lines; `SELECT 1 FROM permissions`).
7. Kill -9 the deploy server process → stack survives, server auto-restarts (fails without the B1 fix — the live-fire test is the proof).
8. After a crash-restart, `stop:deploy` brings the full stack to zero — no listener on 5101, PG and Redis down (B2 scenario).
