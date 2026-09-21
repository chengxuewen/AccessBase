# Batch M — Ops Remainder (Design) — rev.2

**Date**: 2026-09-20 | **Status**: ABSORBED dual-Momus (FLOWS APPROVE-WITH-FIXES + BLOCKERS APPROVE-WITH-FIXES, see REVIEW-ADDENDUM) — dispatch-clear
**Depends on**: Batch L (migrate.sh/process defenses), Batch G (redis fail-open), H′ (PG-down signal-zero gate)

## Problem

1. **/health/ready leaks a pg.Pool per probe** — `createDb()` builds a fresh Pool per
   call (identity db/index.ts:16-29); handler awaits it and never ends. 10-30s probes
   = 120-360 orphaned pools/hour.
2. **No /metrics** — monitoring.md §13 designed it; app.ts:278 pre-exists audit exclusion; route absent.
3. **No backup/restore tooling** — zero pg_dump scripts across modes.
4. **compose dev schema bootstrap swallows failure** — the dev image's ENTRYPOINT runs
   entrypoint-dev.sh which DOES `pnpm db:push` (line 50) but pipes failures into
   `|| echo skipped` — on a fresh volume with a broken push the server boots against
   an empty DB and the wizard dies with no loud signal. (rev.1's premise "no push in
   dev path" was WRONG — flows R3.)

## Goals

- G1: /health/ready probes with ONE reused pool per process (memoized, close-resets);
  response shape unchanged; PG-down test signal stays zero.
- G2: GET /metrics — prom-client defaults (`accessbase_` prefix) + HTTP duration
  histogram (method × **request**.routeOptions.url pattern, 404 → 'unmatched') +
  in-flight gauge; optional METRICS_TOKEN Bearer gate (403 `METRICS_AUTH`,
  sha256-then-timingSafeEqual); route-level `cors:false`; setup-guard exemption;
  rate-limit skip (new — none exists); prod-without-token WARN (not fail-fast, K-T4).
- G3: `accessbase.sh backup` / `restore <file>` — custom-format dumps with
  **umask 077 / chmod 600** (dumps contain PLAINTEXT sessions.token + oauth tokens +
  passwordHash — crown jewels), retention keep-N via whitelist find, restore with
  **target-identity echo + typed-db-name confirmation** (B1 blocker class).
- G4: compose dev fresh volume reaches wizard-ready with a LOUD push failure
  (entrypoint-dev.sh fix; live-fire arbitrates final mechanism).
- G5: live-fire: metrics 200/403-on-token, backup→drop→restore round-trip, compose
  down -v → up → /setup/status 200.

## Non-goals

OTel tracing; push-gateway/dashboards; CI e2e (blocked by Gitee F3 open item);
PITR/WAL archiving; fail-fast for METRICS_TOKEN (K-T4 brick lesson — WARN only).

## Design

### D1: health pool singleton (test-hazard aware)

`routes/health.ts`: module-scope `let readyDbP: Promise<DrizzleDB> | undefined` —
memoized on first probe (kills the async-import double-create race); handler awaits it
inside the existing try (creation/connection failure ⇒ 'down' as today). `onClose` hook:
`if (readyDb) await closeDb(readyDb)` then **`readyDbP = undefined; readyDb = undefined`**
so a later buildApp() (vitest same-file re-build) recreates cleanly instead of touching
an ended pool. closeDb lives on the '@accessbase/identity/db' SUBPATH (not package root).
Tests: sequential probes → createDb spy once; concurrent Promise.all probes → once;
close→rebuild→probe → 200 again (mocked).

### D2: /metrics — every surface named in the same task

- Dep `prom-client` (apps/server; lockfile same commit — constraints rule).
- `collectDefaultMetrics({ prefix: 'accessbase_' })`; histogram
  `accessbase_http_request_duration_seconds` {method, route} with
  **`request.routeOptions.url ?? 'unmatched'`** (fastify 4.29: reply has NO
  routeOptions — verified; 404s bucket to 'unmatched' — cardinality ceiling).
- Hooks registered AFTER the OIDC hijack hook (hijacked /oidc replies skip onResponse;
  registering after = oidc traffic unmeasured — documented blind spot, zero gauge leak;
  registering before = in-flight leaks upward forever. Choose blind spot.)
- Gate: `config.metricsToken` set ⇒ require `Authorization: Bearer <token>`;
  compare = sha256 both sides then `timingSafeEqual` (length-leak neutralized);
  failure ⇒ **403 {code:'METRICS_AUTH'}** (unified across all docs). Unset ⇒ open +
  **`warnDegradedChecks` new line when NODE_ENV=production && !metricsToken**
  (env-only pure function, L-T4 discipline; NOT fail-fast — K-T4 R3 brick rule).
- Route options: `cors: false` (@fastify/cors per-route opt-out — server-to-server
  scrape needs no CORS; kills drive-by reflected-origin reads in dev).
- Rate-limit: app.ts registration (96-104) gains
  `skip: (req) => req.url.startsWith('/health') || req.url === '/metrics'`
  (no pre-existing skip list — rev.1 claim corrected).
- setup-guard ALLOWED_PATHS += '/metrics' (else 403 SETUP_REQUIRED pre-init, DB
  roundtrip per scrape post-init, PG-down vitest 503 → H′-T1 gate violation).
- Audit: already excluded (app.ts:278) ✓. .env.example += METRICS_TOKEN.

### D3: backup/restore (data-at-rest hardened)

`scripts/backup.sh` + `scripts/restore.sh` ↔ `accessbase.sh backup [--dir D] [--keep N]`
/ `accessbase.sh restore FILE [--force]`:
- Target resolution reuses **`configure_native_urls`** (_common.sh:51) for native,
  deploy-mode .env sourcing pattern (start.sh), `DATABASE_URL` override wins. URL →
  host/port/user/db split + **percent-decode** password into `PGPASSWORD` env;
  pg_dump invoked with `-h -p -U -d` flags (conninfo URI never on argv — ps-safe);
  nothing echoes the URL/password.
- **`umask 077` first line**; resulting .dump + .sha256 chmod 600; header comment +
  report state: dumps contain plaintext session/oauth tokens — secrets handling.
- Name `accessbase-<UTC-timestamp>.dump` + sidecar sha256; retention
  `find "$OUT" -maxdepth 1 -type f -name 'accessbase-*.dump'` sorted, delete oldest
  beyond --keep (default 7); validate OUT is a real dir (mkdir -p), never follow user
  globs.
- restore: BEFORE any prompt — echo `target: <user>@<host>:<port>/<db>`; refuse unless
  server for that mode is down (deploy: `data/.pids`/PIDFILE probe; native: port probe
  5101) OR `--force`; tty confirm requires **typing the database name** when
  host≠localhost or DATABASE_URL was externally set; `ACCESSBASE_RESTORE_CONFIRM=yes`
  = non-interactive bypass (SEPARATE variable from RESET — rev.1 body fixed).
  `pg_restore -c --clean --if-exists --no-owner`; nonzero + loud half-restored warning.
- Default OUT `data/backups/` — .gitignore ALREADY covers data/ (rev.1's "add entry"
  was a no-op, dropped).
- compose/container modes: documented `docker exec` one-liners in the script header
  (not automated).

### D4: compose dev — loud schema bootstrap in the REAL boot path (flows R3)

The compose dev server runs entrypoint-dev.sh (image ENTRYPOINT; compose `command:`
is swallowed as $@). Fix **`docker/entrypoint-dev.sh:50`**: replace
`pnpm db:push 2>/dev/null || echo skipped` with push + retry(3) + **fatal exit on
failure with the real error echoed** (dev containers SHOULD fail loudly; fresh-volume
push has no interactive-prompt surface, and `sh -c` compose rewrite is dead — the
earlier failure-hang risk evaporates). Live-fire G5-4 arbitrates; if the mechanism
turns out different, fix per evidence and note it in the execution log.

## Success criteria

1. /health/ready: sequential + concurrent probes → createDb spy ==1; close→rebuild
   probe green; body shape identical.
2. GET /metrics → 200 Prometheus text (`accessbase_process_cpu_seconds_total`,
   `accessbase_http_request_duration_seconds_count`); token set: missing/wrong →
   403 METRICS_AUTH, right → 200; no ACAO header on /metrics; pre-setup → 200/403
   (guard-exempt); **PG-down vitest green** (no DB touch on /metrics path);
   prod&no-token → warnDegradedChecks line (unit).
3. backup: .dump+.sha256 mode 600, password never in ps/argv/stdout; retention keeps
   N newest own-prefix files only. restore: echo identity; wrong typed name aborts
   zero-writes; happy path drop→restore→data back; --force + CONFIRM bypass works.
4. entrypoint-dev.sh: push failure ⇒ container exits nonzero with visible error;
   fresh volume ⇒ /setup/status 200 (live-fire or NOT VERIFIED note if docker absent).
5. Gates: vitest root (T1 ~3 + T2 ~5 new) · double tsc · eslint changed 0 err ·
   e2e 137+3 no-regression · coverage PASS · .env.example line.
6. Memory: status M row · conventions Phase M (metrics-surface checklist, dump-secrets
   rule, restore identity-echo contract, health singleton pattern) · D119 · PITs as
   discovered (PG-URL percent-decode trap, entrypoint-swallow-failure class).

## Risk ledger closure

route-pattern label = request.routeOptions.url ✓ · prom-client ESM/tsc fine ·
pg_dump = pixi native postgresql 16 client (same package as server tools) ·
restore env = ACCESSBASE_RESTORE_CONFIRM ✓ · CORS per-route off ✓ · live-server dump
= snapshot-consistent (document best practice).
