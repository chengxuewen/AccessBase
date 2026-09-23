# P-fix Wave 2: Platform & Ops Remediation (Design Spec)

**Date**: 2026-09-23
**Status**: rev.1 (pending dual-Momus)
**Driver**: Batch P report Wave-2 queue (F6, F9, F10, F11). Every claim re-verified against HEAD `c0b40b2` before scheduling (PIT-076 addendum discipline).

## 1. Verified facts & one errata

| # | Claim | Verification |
|---|-------|--------------|
| F6 | /oidc/* escapes rate limiting | **CONFIRMED with precise mechanism**: minimal repro (bare Fastify + @fastify/rate-limit max=3): matched routes → 3×200→3×429; unmatched (404-space) → 6×404 zero 429. Every /oidc/* request is route-less from Fastify's view (provider hijacked at app.ts:227 onRequest) → the global limiter never engages. Interaction endpoints (`/oidc/interaction/*`, app.ts:229) ARE real routes → already limited. |
| F9 | compose.prod first boot crash-loops; DB baked into image | **CONFIRMED (2/3)**: Dockerfile:87-89 build-time `initdb` bakes $PGDATA; docker/entrypoint.sh:6 only `pg_ctl start` (no runtime init) → named volume (docker-compose.prod.yml:31-32) shadows the baked dir empty → start fails under set -e. **"keys baked" is FALSE** — no key generation anywhere in the Dockerfile (grep `generate-keys|openssl|JWT_` = 0 hits); keys are runtime env/HMAC-fallback. Report carries errata. |
| F10 | migrate.sh leaks credentials via argv | **CONFIRMED**: scripts/migrate.sh:20 `PSQL=(psql "$DATABASE_URL")` → every invocation (:24,:36-37,:39,:54-55,:64-65,:69 + per-file apply :65) exposes the conninfo (password included) in the process table; runs at every container boot (docker/entrypoint.sh:32) and deploy boot (scripts/deploy/start.sh:129). backup.sh:9-10 documents the exact anti-pattern and uses PG* env — migrate.sh contradicts it. |
| F11 | Passwordless PG published on the network (dev) + prod image hosts 0.0.0.0/0 trust | **CONFIRMED**: Dockerfile.dev:37-39 trust + `listen_addresses='*'` + host-line trust; accessbase.sh:441-442 publishes `-p 5432:5432 -p 6379:6379` (all interfaces) → LAN routable, no password (redis too: protected-mode defeated by… redis-server default here binds 127.0.0.1 only inside container; exposure via -p 6379 → whatever binds). Prod Dockerfile:87-89 same trust+'*' inside image — prod `docker run` publishes only 5101 (accessbase.sh:489-499, compose.prod maps 5101) so LAN exposure is NOT current-state, but any added `-p`/`--network host` = instant superuser (report wording correct). Base docker-compose.yml:6-14 (shared dev infra: postgres official image, scram, cred accessbase_dev) publishes 5432 all-interfaces with guessable default. |

## 2. Scope — four fixes

### W2-1 (F6): coarse per-IP guard for the /oidc hijack space — NO architecture change
B1 mount (onRequest hijack, zero content-type parsers — conventions Phase 9) stays; do NOT convert the provider to catch-all routes (would re-introduce body-parsing conflicts and fight the Phase 9 rule). Instead: new `apps/server/src/oidc/rate-guard.ts` (~45 lines): fixed-window per-IP counter on the same redis singleton (INCR + EXPIRE 60, key `rl:oidc:<ip>:<minute>`), in-memory Map fallback, **fail-open** on redis errors (skipOnError parity), cap `OIDC_IP_RATE_PER_MIN` env default **120**, exemption for `/.well-known/*` (discovery + jwks — RPs poll these unauthenticated); invoked from the existing hijack hook (app.ts:227) BEFORE `reply.hijack()` for non-interaction /oidc/* paths; 429 replies with provider-shaped JSON (`{"error":"invalid_request","error_description":"rate limited"}`) + Retry-After.
RED test (new `apps/server/src/__tests__/oidc-rate-guard.test.ts`, PIT-078 harness shape — stubEnv cap=5, dynamic import): 8× POST /oidc/token → assert some 429; discovery stays 200; /oidc/interaction/* unaffected. (onRequest logic — inject exercises it honestly; no stream-lifecycle dependency, cf PIT-077.)

### W2-2 (F9): runtime init, idempotent — remove build-time bake
- Dockerfile: delete the `USER accessbase / RUN initdb…` bake (:86-89); keep mkdir/chown of the empty $PGDATA; data dir starts EMPTY.
- docker/entrypoint.sh: prepend idempotent init — `if [ ! -f "$PGDATA/PG_VERSION" ]; then initdb -D $PGDATA --auth=trust --username=$PGUSER && <same listen/pg_hba lines as today>; fi` before `pg_ctl start -w`. CREATE-DATABASE probe (:9-10) already idempotent; migrate (:32) unchanged.
- Behavior matrix: plain `docker run` (no volume) = same first-boot effect as today's build-baked data; compose.prod named volume = first boot inits INTO the volume (crash-loop gone); restart = PG_VERSION guard skips init (data persists). Batch-L T6 live-fired `docker run` semantics preserved.
- No docker daemon here: **docker behavior NOT VERIFIED** (static locks + reasoning; live compose.prod down→up deferred to the integration-day battery).
- RED locks (extend ops static test or process-defenses): Dockerfile has no `RUN initdb`; entrypoint contains the PG_VERSION guard before pg_ctl; bash -n parse check of entrypoint (runnable here via `bash -n`).

### W2-3 (F10): migrate.sh over PG* env, shared parser
- New `scripts/pg-url.sh`: `ab_pgurl_export <url>` parses postgresql://[user][:pass@]host[:port][/db] with %XX decoding (semantics lifted from backup.sh:19-30 region), exports PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE; refuses non-localhost hosts WITHOUT password? — no, keep pure: export what's given.
- migrate.sh: `if [ -n "${DATABASE_URL:-}" ]; then source lib; fi` + `PSQL=(psql)` (no URL argument ever); backup.sh: replace its inline parser with the shared lib (dedupe, same behavior); restore.sh: switch its URL→PG* derivation to the lib too.
- RED: unit for the parser (test file under apps/server? scripts/ has no test home — ops-migrate.test.ts already shells into scripts/: add a `pg-url` describe running `bash -c 'source scripts/pg-url.sh; ab_pgurl_export "postgresql://u:p%40ss@h:6/db"; env | grep PG'` and asserting decoded values). Static lock: `grep -c 'psql "$DATABASE_URL"' scripts/migrate.sh` = 0 (extend ops-migrate.test). Existing fresh/legacy/idempotent trio must stay green (they run migrate.sh against live native PG with real DATABASE_URLs — the parser exercises for real).

### W2-4 (F11): bind exposure to loopback; prod image off 0.0.0.0/0-trust
- accessbase.sh dev:container run flags: `-p 127.0.0.1:5432:5432`, `-p 127.0.0.1:6379:6379` (host tooling keeps working; LAN dies). 5101/5173 stay open-published (they're the published dev app surface by design).
- docker-compose.yml (base infra): `"127.0.0.1:5432:5432"` (and redis 6379 if present).
- Prod Dockerfile bake replacement (per W2-2 the pg_hba lines move to entrypoint): init line changes to `--auth=scram-sha-256` for host connections while local/socket stays trust: runtime init writes `host all all 0.0.0.0/0 scram-sha-256` + `listen_addresses='localhost'`. App in-container connects over localhost TCP with PG* env (password already ENV'd :77 + compose default URL carries accessbase:accessbase). entrypoint-DEV (compose-dev path, app connects cross-container to the separate postgres service) is unaffected — its pg lives in the stock image, not this Dockerfile; Dockerfile.dev KEEPS trust (dev all-in-one convenience) — exposure now loopback-bound.
- RISK (explicit): scram misconfig could brick the prod single-container boot that L-T6 live-fired. Not docker-verifiable here → the wave lands with a NOT-VERIFIED marker and the boot becomes the first item of the docker-capable integration day; compose.prod + docker run both must pass fresh-boot then.
- RED: static locks on the three publish lines + entrypoint init auth string + listen localhost.

## 3. Constraints (carry-forward)
- Phase 9 B1 rule intact: `grep -c "addContentTypeParser" apps/server/src/app.ts` stays 0 (W2-1 deliberately does not mount provider routes).
- Phase L migrate.sh remains the SOLE runtime writer; sentinel trio unchanged; ops-migrate.test live-fire trio must stay green after W2-3 (it exercises the new parser for real).
- PIT-077 lesson: any new lifecycle hook logic gets a real-socket test (W2-1 runs at onRequest — inject is honest there; state so in the test comment).
- PIT-078 harness: one buildApp per file, stubEnv + dynamic import.
- Docker-dependent behaviors (W2-2/W2-4 boot) ship with explicit NOT VERIFIED; no security-verified claim until the docker battery runs.
- Gates: triple tsc, full vitest (945 baseline + new), eslint touched files 0-new, e2e unchanged count (server-only wave), accessbase.sh bash -n, live native-PG trio.

## 4. Execution shape
Strictly sequential (migrate.sh/entrypoint touched by two fixes): W2-1 → W2-2 → W2-3 → W2-4, one commit each, controller-direct (precedent Wave 1). Report errata (F9 keys clause) appended at close-out.
