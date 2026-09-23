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

---

# Review Appendix rev.2 (dual-Momus 2026-09-23 — convergent: same BLOCKER caught independently)

- **R1 [BLOCKER, both] W2-3 bricks the exact boot path W2-2 fixes**: Dockerfile:108 COPYs ONLY migrate.sh (:107 comment: "scripts/ is otherwise absent"); a sourced pg-url.sh would be missing at container boot; compose.prod:10 always sets DATABASE_URL → the source branch fires → set -e kills entrypoint → compose.prod crash REPLACED by migrate.sh crash. ops-migrate trio runs from the repo (sibling exists) = classic seam mask. Absorbed: W2-3 also adds `COPY --chmod=644 --chown=accessbase:accessbase scripts/pg-url.sh /app/scripts/pg-url.sh` next to :108, migrate.sh resolves via `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`, and ops-migrate.test gains a static assertion that the Dockerfile COPYs BOTH files.
- **R2 [HIGH, both] W2-4 scram mechanism pinned (the spec's "password already ENV'd" rationale was the wrong model — client env password ≠ server-side stored password; and appending a 0.0.0.0/0 line behind initdb's generated 127.0.0.1/32 trust line = silent no-op via first-match)**. Absorbed exact recipe for the W2-2 runtime init block: `initdb -D "$PGDATA" --username="$PGUSER" --auth-local=trust --auth-host=scram-sha-256 --pwfile=<(printf '%s\n' "$PGPASSWORD")` (initdb generates exactly local trust + host 127.0.0.1/32 + ::1/128 scram — first-match-safe), plus `echo "listen_addresses='localhost'" >> postgresql.conf`; the old appended `listen '*"` + `host 0.0.0.0/0 trust` lines are DELETED from the prod path entirely (no determinism gamble on pg_hba ordering). Entrypoint's own createdb/migrate-adjacent psql stays on the trust local socket; app + migrate.sh connect TCP-loopback with PGPASSWORD (both defaults carry accessbase). Dockerfile.dev and deploy-mode initdb (start.sh:58) keep trust — dev-surface bounded, deploy trust noted as remaining backlog.
- **R3 [HIGH, flows] upgrade-wipe honesty**: old-image data lived in the container layer; new image (bake removed) + no volume = silent fresh init on `docker run` upgrade. Absorbed: the init branch must echo loudly ("initializing EMPTY database — mount $PGDATA volume to persist") and the report/status carry the upgrade note; behavior accepted (compose.prod named volume is the documented prod shape).
- **R4 [MINOR] stream-of-consciousness fragment removed from W2-3** ("refuses non-localhost...").
- **R5 [MINOR] W2-3 phrasing**: source the (pure) lib unconditionally; call `ab_pgurl_export "$DATABASE_URL"` only when set.
- **R6 [MINOR] W2-1 test shape**: inject with EXPLICIT `remoteAddress: '12.34.56.78'` (default is fixed 127.0.0.1 — otherwise the counter assertion is accidental); cap lives in config.ts (`oidcIpRatePerMin`, env OIDC_IP_RATE_PER_MIN, default 120) per repo config pattern, not raw process.env in the hook. NAT/RP-shared-egress MED accepted as documented tradeoff (env-tunable; /.well-known exempt; interaction space already limited globally).
- **Citation corrections absorbed**: hijack hook app.ts:226 (hijack :231; interaction routes register :324 — :229 is the bypass check); backup.sh parser is :36-57 (not 19-30); "entrypoint-dev = compose-dev path" was WRONG (it is Dockerfile.dev's all-in-one entrypoint dialing baked localhost PG; compose.dev.yml's server overrides command and never runs it — conclusion 'unaffected' survives, reason corrected); B1 addContentTypeParser rule lives in AGENTS.md Phase 9 notes (verified 0 hits); prod publish cites :490/:497; migrate.sh sentinel probe :54 (not :54-55).

## Execution record (2026-09-23, controller-direct, W2-1..4 sequential)

- W2-1 (95d00c4 + d14cf71): rate-guard.ts + config.oidcIpRatePerMin + hook wiring; 3-test lock GREEN. Mid-flight catch: first cut treated the discovery EXEMPTION as a hijack bypass → 404'd /.well-known (the provider self-serves it) — the pre-existing oidc-provider-mount.test caught it same-run; corrected to handoff-uncounted (convention note: guard exemptions skip counting, never routing).
- W2-2 (99f665b): bake removed, runtime PG_VERSION-guarded init + loud empty-init echo; static locks + bash -n. Docker live boot NOT VERIFIED (no daemon here).
- W2-3 (a06ce1b): scripts/pg-url.sh shared lib; migrate/backup/restore deduped onto it; Dockerfile ships both files (R1 lock); 4-test RED→GREEN incl. real-PG trio still green through the env-translation switch.
- W2-4 (5a40fc9): loopback binds (accessbase.sh + both composes), EXPOSE 5101 only, entrypoint scram recipe verbatim from R2 (--auth-local=trust --auth-host=scram --pwfile, listen localhost), redis --bind 127.0.0.1. Docker live boot NOT VERIFIED — first item of the docker-capable integration day.
- Gates: vitest 958/958 (+13 wave-2), triple tsc 0, eslint 0-new vs baseline (10 vs 11 on touched clusters), e2e 138+3. Report Wave-status updated; verdict still BLOCK pending Wave 3 (F12-F15).
