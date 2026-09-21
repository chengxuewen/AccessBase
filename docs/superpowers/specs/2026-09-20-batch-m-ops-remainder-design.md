# Batch M — Ops Remainder (Design)

**Date**: 2026-09-20 | **Status**: DRAFT for dual-Momus
**Depends on**: Batch L (migrate.sh/selfHeal/process defenses), Batch G (redis fail-open)

## Problem

1. **/health/ready leaks a pg.Pool per probe** — `createDb()` (identity db/index.ts:16-29)
   builds a FRESH `new Pool` on every call; the ready handler awaits it per request and
   never ends it. Kubernetes/docker healthchecks at 10-30s intervals = 120-360 orphaned
   pools/hour. (L-batch F2 fixed the self-heal dial; health never got the same discipline.)
2. **No /metrics** — monitoring.md §13 designed Prometheus exposure; app.ts already
   excludes `/metrics` from audit (line 278) but the route does not exist.
3. **No backup/restore tooling** — zero pg_dump scripts; a real deployment today has no
   first-party way to snapshot or move data (deploy/container/native modes).
4. **compose dev has no schema bootstrap** — `docker-compose.dev.yml` server command is
   bare `pnpm --filter @accessbase/server dev`; after `down -v` the DB is empty and the
   setup wizard fails (the class entrypoint-dev.sh:50 already handles for container mode).

## Goals

- G1: /health/ready probes with ONE reused pool for process lifetime; behavior unchanged
  (200 ok / 503 degraded shape).
- G2: GET /metrics — Prometheus text format: process+event-loop defaults + HTTP request
  duration histogram + in-flight gauge. Optional `METRICS_TOKEN` gate.
- G3: `accessbase.sh backup` / `accessbase.sh restore <file>` covering native & deploy
  modes (custom-format pg_dump, retention, restore confirmation guard); container/compose
  modes documented one-liners (docker exec path).
- G4: compose dev boots to wizard-ready on a fresh volume (db:push precedes server).
- G5: live-fire each: metrics curl + token 401, backup→drop→restore round-trip on a
  throwaway DB, compose down -v → up → /setup/status 200.

## Non-goals

- OTel tracing (no consumer yet; metrics first rung). Node-sdk install deferred.
- Push-gateway/federation, alert rules, dashboards (out of repo scope).
- Real-backend e2e into CI (blocked by the F3 Gitee decision — untouched).
- Point-in-time recovery (WAL archiving): custom-format dumps + cron is the contract.

## Design

### D1: health pool singleton

`routes/health.ts`: module-scope `let readyDb` (lazy `createDb(config.databaseUrl)`),
registered for teardown via `app.addHook('onClose')` → `closeDb(readyDb)` (identity
exports closeDb since L/F2). Redis check already getRedis() singleton-cached ✓.
Test: two sequential /health/ready calls → createDb spy called ONCE; onClose ends pool
(mock spy).

### D2: /metrics via prom-client

- New dep `prom-client` (apps/server). Single `register` default registry.
- `collectDefaultMetrics({ prefix: 'accessbase_' })` (process/event-loop/memory) +
  onRequest/onResponse hooks: histogram `accessbase_http_request_duration_seconds`
  (labels: method, route — the FASTIFY route pattern, NOT raw url: cardinality),
  in-flight gauge via onRequest pre-send.
- Route `GET /metrics`: if `config.metricsToken` set → require
  `Authorization: Bearer <token>` (timing-safe compare), 403 `METRICS_AUTH` else;
  **unset = open** (intranet scrape default; dev/compose/deploy unchanged). Rationale:
  mirrors JWT-secret philosophy; documented in .env.example.
- Audit already excludes /metrics (app.ts:278 pre-existed) ✓; rate-limit exempt
  (add to the limiter's existing skip list for /health — verify where).
- Config: `metricsToken: process.env['METRICS_TOKEN'] || ''` (config.ts + .env.example
  + compose prod env passthrough optional + warnDegradedChecks UNTOUCHED — open
  metrics is not a degradation).

### D3: backup/restore scripts

`scripts/backup.sh` (+ `scripts/restore.sh`), wired to `accessbase.sh backup [--dir]` /
`accessbase.sh restore <file> [--force]`:
- Resolve target DB from the SAME discovery the start scripts use (native:
  .pixi/data pg port/env; deploy: data/ dir env; DATABASE_URL override wins).
- `pg_dump -Fc -f "$OUT/accessbase-$(date -u +%Y%m%dT%H%M%SZ).dump"` via pixi-native
  psql toolchain; print FILE + sha256 + size; retention `--keep N` default 7 (delete
  oldest own-prefix files only).
- restore: refuses unless (a) server stopped for the mode in question OR
  `--force`, and echoes confirmation prompt on tty (ACCESSBASE_RESET_CONFIRM=yes
  bypass mirroring reset's guard); `pg_restore -c --clean --if-exists --no-owner`.
  NO destructive action before the guard.
- Output dir default `data/backups/` (native) / `$PROJECT_ROOT/data/backups` — add
  .gitignore entry; scripts are the sole writers.
- Failure semantics: set -euo pipefail; nonzero on any pg_dump/restore failure; never
  echo passwords (connection via PGPASSWORD env or .pgpass-less URL parsing — parse
  DATABASE_URL into pg_dump flags, keep the URL out of logs).

### D4: compose dev schema bootstrap

`docker-compose.dev.yml` server command becomes
`sh -c "pnpm db:push && pnpm --filter @accessbase/server dev"` (cwd /app has root
package + mounted volumes; idempotent push on existing schema). depends_on healthy
postgres already guarantees reachability. Container all-in-one untouched (entrypoint
already pushes); deploy/compose-prod untouched (migrate.sh owns those since L).

## Success criteria

1. /health/ready twice → createDb called once; body unchanged shape; graceful close ends pool.
2. GET /metrics → 200 Prometheus text (`accessbase_process_cpu_seconds_total`,
   `accessbase_http_request_duration_seconds_count` present); with METRICS_TOKEN set,
   no/ wrong token → 403 {code:METRICS_AUTH}, right token → 200.
3. backup on throwaway DB → .dump + sha256; drop table → restore → data back; retention
   keeps N newest; tty confirmation refusal aborts restore with zero writes.
4. compose dev: `down -v && up` → /setup/status 200 within boot (wizard reachable).
5. Gates: vitest root (1 new health + ~4 metrics route tests) · double tsc · eslint
   changed 0 err · e2e 137+3 no-regression (metrics/health not UI-surfaced) · live-fire
   per G5 on throwaway DB · .env.example + docker notes.
6. Memory: status M row, conventions Phase M (pool-singleton discipline, metrics token
   semantics, backup guard contract), pitfalls as discovered, D119 (metrics exposure
   philosophy + backup sole-writer).

## Risk ledger (reviewers)

- route-label cardinality: `reply.routeOptions.url` usage — verify fastify version API.
- prom-client + our pino ESM interplay; tsx dev vs compiled dist (PIT-061 lesson:
  live-fire the COMBINED build path at least once — T5 does deploy build + curl).
- pg_dump version vs PG16 (pixi native postgres tooling version alignment).
- restore guard bypass env var name collision with reset (ACCESSBASE_RESET_CONFIRM —
  reuse or separate ACCESSBASE_RESTORE_CONFIRM — reviewer call; spec lean: separate).
- compose dev `sh -c` string: pnpm workspace cwd correctness inside image.
- backup of a LIVE db (server up): -Fc handles consistent snapshot per-connection;
  document best-practice (stop or replica).
- metrics route must not leak through CORS wildcard (app CORS allows only site origins — verify).
