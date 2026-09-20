# Task 3 (L-T3+L-T4) Report — Process defenses + deploy restart loop + boot degrade warnings

**Status**: COMPLETE
**BASE**: 57f876a → **Commits**: 47bfaaf (TS) + bb9f729 (shell), both on `master` (verified via `git branch --show-current` after each)

## What shipped

| File | Change |
| --- | --- |
| `apps/server/src/index.ts` | `uncaughtException` + `unhandledRejection` → `app.log.fatal({ err }, ...)` + `process.exit(1)`, registered before `listen()` alongside SIGTERM/SIGINT. Zero new imports (logger comes via `app.log`; only `warnDegradedChecks` added to the existing `./config.js` import). D5 sweep: `for (const line of warnDegradedChecks(process.env, config.nodeEnv === 'production')) app.log.warn(line)` — single prod-flag source is `config.nodeEnv` (no second truth invented). |
| `apps/server/src/config.ts` | `export function warnDegradedChecks(env: NodeJS.ProcessEnv, isProd: boolean): string[]` — pure, no logger import, no side effects, reads only the passed env. Checklist per D5 revised wording: (1) `MFA_ENCRYPTION_KEY` unset → "MFA enrollment unavailable unless options-configured"; (2) `SMTP_HOST` unset → "outbound email disabled unless options-configured"; (3) no `OAUTH_PROVIDERS`/`GITHUB_CLIENT_ID`/`GOOGLE_CLIENT_ID` and `SAML_ENABLED !== 'true'` → combined R6 line "No env-level OAuth/SAML provider config (options-table config not visible at boot)"; (4) prod-only: `WEBAUTHN_ORIGIN` unset/localhost; (5) prod-only: `SITE_URL` unset → magic-link falls back to request host. JWT/CORS prod fail-fast untouched (K-T4 intact). |
| `scripts/deploy/start.sh` | Restart loop replacing bare `wait $SERVER_PID` + NODE_ENV relocation + wrapper pid plumbing (details + skeleton below). Migrate gate line 125 preserved byte-identical (Task-1), loop is after it. `trap cleanup EXIT INT TERM` unchanged (human Ctrl-C path identical). |
| `scripts/deploy/stop.sh` | `STARTPID="${DATA_DIR}/.startpid"`; TERMs wrapper FIRST (`kill -15 "$WRAPPER_PID"` + bounded 10s liveness poll), `rm -f "$STARTPID"`, then falls through to the existing PIDFILE/PG/Redis sequence as backstop (all `2>/dev/null || true` idempotent against already-dead PIDs). |
| `apps/server/src/__tests__/config.test.ts` | +6 warnDegradedChecks cases: prod-empty = exactly 5 lines with both qualifier regexes; prod fully-configured = []; dev = 3 lines (prod-only pair suppressed); `SAML_ENABLED=true` suppresses provider line; `OAUTH_PROVIDERS` suppresses provider line; purity case proves ambient `process.env` is not consulted. |
| `apps/server/src/__tests__/process-defenses.test.ts` | NEW, 13 static-source locks (route-guard.test precedent): both handler registrations + pre-listen ordering + no `@accessbase/logging` import + sweep call shape; start.sh facts ①`^set -eo pipefail$` + `code=0; wait "$SERVER_PID" || code=$?` ②`.startpid` write early + `cleanup(){ DEPLOY_STOPPING=1` + rm + trap-line-unchanged ③ loop-region regex `while ... node ... & ... echo "$SERVER_PID" > "$PIDFILE" ... done` ④ `RESET_TIMES=()`/`+=("$SECONDS")`/`-ge 15`/`${#RESET_TIMES[@]}" -ge 3`/`crash loop — aborting`/`sleep 3`; LOW-1 NODE_ENV-before-pre-flight index ordering; migrate literal + sequence-before-loop; stop.sh wrapper-kill index < PIDFILE-block index. |

## Four pinned shell facts — how each is honored

1. **B1**: loop body first line is literally `code=0; wait "$SERVER_PID" || code=$?`; all later branching reads `$code` only (log_warn). No bare `wait` survives in the file.
2. **B2**: `echo $$ > "${DATA_DIR}/.startpid"` written at :103 (right after trap registration, before PG start → covers init/migrate-phase stop too). `cleanup()` first statement sets `DEPLOY_STOPPING=1`; loop checks `[ "$DEPLOY_STOPPING" = "1" ]` AFTER wait and breaks; while-condition re-checks the flag (`while [ "$DEPLOY_STOPPING" != "1" ]`) so a signal during the startup phase also falls out. stop.sh TERMs the wrapper first, then its own (now-idempotent) server/PG/Redis sequence. EXIT trap reaps on every break path.
3. **PIDFILE freshness**: the restart branch does `node ... &; SERVER_PID=$!; echo "$SERVER_PID" > "$PIDFILE"` every iteration — cleanup can never chase a stale generation.
4. **Crash cap**: `RESET_TIMES=()` bash array of `$SECONDS` timestamps, pruned with a head-sliding while loop (`-ge 15` window), `>= 3` → `log_error "crash loop — aborting"` + `break` → EXIT trap tears the stack. No systemd, no new deps.

**NODE_ENV relocation route taken: Route A (full relocation).** `_common.sh` read in full — zero `NODE_ENV` references (only colors/log helpers/ensure_*/configure_native_urls/docker helpers); nothing between old (:109) and new (:29) sites reads NODE_ENV either (only the pre-flight block at :37 consumes it, which is the point). So the export moved above the pre-flight and the old :109 line was deleted — not the local-var fallback. Bad env now exits 1 cleanly at pre-flight (JWT/ADMIN) or is reaped by the crash cap (e.g. CORS_ORIGINS, which stays config.ts-only fail-fast — shell pre-check not extended, YAGNI + brief silent on it).

## Loop skeleton (as committed)

```bash
# === Server restart loop (D4 / B1 B2 L-1) ===
RESET_TIMES=()
while [ "$DEPLOY_STOPPING" != "1" ]; do
  code=0; wait "$SERVER_PID" || code=$?
  if [ "$DEPLOY_STOPPING" = "1" ]; then
    break
  fi
  RESET_TIMES+=("$SECONDS")
  while [ "${#RESET_TIMES[@]}" -gt 0 ] && [ $(( SECONDS - ${RESET_TIMES[0]} )) -ge 15 ]; do
    RESET_TIMES=(${RESET_TIMES[@]:1})
  done
  if [ "${#RESET_TIMES[@]}" -ge 3 ]; then
    log_error "crash loop — aborting"
    break
  fi
  log_warn "Server exited (code $code) — restarting in 3s..."
  sleep 3
  node "${OUT_DIR}/server/index.js" &
  SERVER_PID=$!
  echo "$SERVER_PID" > "$PIDFILE"
done
```

First-generation launch + 30s health wait + admin bootstrap stay before the loop (bootstrap is first-boot-only, idempotent-by-check; restarts skip it deliberately). `sleep 3` is plain (trap fires post-sleep, next check breaks — ≤3s stop latency accepted per brief).

## TDD evidence

- **RED**: 18 failed / 6 passed — config cases failed with `(0 , warnDegradedChecks) is not a function` (missing export, right reason); process-defenses cases failed with "expected <source> to match /pattern/" (facts absent pre-implementation, right reason); 6 passes = 5 pre-existing config cases + 1 guard-style negative assert (no-logging-import, true by construction pre-change and post).
- **GREEN**: targeted run 24/24 passed.

## Gates (all run with no_proxy set; native infra left STOPPED — none needed, PG suites self-skip)

| Gate | Result |
| --- | --- |
| `pixi run npx vitest run apps/server` | **474 passed \| 11 skipped \| 0 failed** (baseline 466 + 6 config + 13 static = 485 ✓ exact arithmetic) |
| `pixi run npx tsc --noEmit` (root) | clean (also passed as pre-commit hook on both commits) |
| `bash -n scripts/deploy/start.sh` / `stop.sh` | both OK |
| `npx eslint` on 4 changed TS files | 0 errors / 0 warnings |
| `git branch --show-current` after each commit | `master` ×2 |

## Concerns / notes for review & T6

- **Empty-array `set -u` slice**: `RESET_TIMES=(${RESET_TIMES[@]:1})` relies on bash ≥4.4 empty-expansion semantics (unquoted deliberately). Host bash is 5.x; container bash 5.x. Not a ceiling worth a guard.
- **Restart during a signal-in-sleep race**: if TERM lands while sleeping, cleanup already ran (flag set) but the restart branch still launches node before the top-of-loop condition fails; the EXIT trap then kills it via the freshly-rewritten PIDFILE — no persistent orphan, one wasted process. Accepted (bounded, self-reaping).
- **First-generation health-wait no longer re-runs on restart** — intentional; T6 live-fire asserts crash-restart liveness, not re-bootstrap.
- **Success criteria #7/#8 (kill -9 revive; stop-after-restart zero)** are T6's live-fire proofs; static locks here only pin the mechanism.
- Em-dashes in `log_error "crash loop — aborting"` / migrate literal are pinned by the static test — if a future reword lands, the lock fails loudly (by design).

## Fix wave (final review)

Five findings (F1/F2/F4/F5/minor) fixed, one pass, commit `646f561` on `master`.

### F1 [Important] — scripts/deploy/start.sh pre-flight missing CORS_ORIGINS

Added a `CORS_ORIGINS` check mirroring the JWT_SECRET block (same `log_error` + `exit 1` style, inside the `NODE_ENV=production` guard), so the default deploy fails cleanly at pre-flight instead of crash-looping when `config.ts requireCorsOrigins` throws under production.

```bash
$ env -u CORS_ORIGINS JWT_SECRET=x ADMIN_PASSWORD='Aa1!b' NODE_ENV=production bash scripts/deploy/start.sh; echo "exit code: $?"
[0;31m[ERROR][0m CORS_ORIGINS must be set in production (config.ts requires it; comma-separated allowlist)
exit code: 1
$ ss -tln | grep -E ':5432\s'
# (no output — PG never started; clean pre-flight exit)
```

### F2 [Important] — runSelfHealOnce leaked pg pool per attempt

Root cause: `runSelfHealOnce` created a fresh `pg.Pool` per attempt (6 retries = 6 leaked pools), and a leaked pool's idle-client `error` event can later hit the process uncaught. drizzle-orm 0.29.5 does **not** expose `$client` at runtime (verified: `'$client' in db === false`), so went the finding's alternative path: added a typed `closeDb(db)` helper to `packages/identity/src/db/index.ts` backed by an internal `WeakMap<DrizzleDB, Pool>` populated in `createDb` (no `as any`; type-safe). `runSelfHealOnce` now wraps its body in `try/finally` that calls `closeDb(db)` (close errors logged, original rejection preserved so the retry loop still observes failure).

Verification: extended a real-probe `runSelfHealOnce` failure and added a focused mock test asserting `closeDb` runs on a failed probe:

```bash
$ pixi run npx vitest run apps/server/src/__tests__/permissions-seed.test.ts
✓ apps/server/src/__tests__/permissions-seed.test.ts (10 tests) 20ms   # +1 F2 test
# new test: 'ends the dial pool when the probe fails — no leaked pools per retry'
```

### F4 [Important] — CI migrate job

Added a top-level `migrate` job (no `needs`; placed after `e2e`, before `build`) in `.github/workflows/ci.yml`: ubuntu-latest; postgres:16 service container with POSTGRES_USER/PASSWORD/DB=accessbase, port 5432, `pg_isready -U accessbase` healthcheck; env `DATABASE_URL=postgresql://accessbase:accessbase@localhost:5432/postgres` + `no_proxy`/`NO_PROXY`; steps checkout → pnpm-setup → setup-node 22 (pnpm cache) → `pnpm install --frozen-lockfile` → `npx vitest run apps/server/src/__tests__/ops-migrate.test.ts`. Verified the test's hardcoded `MAINT_URL` (`accessbase:accessbase@localhost:5432/postgres`) matches the service credentials and connects to the default `postgres` maintenance DB — no test edit needed.

```bash
$ python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/ci.yml')); print(list(d['jobs'].keys()))"
['lint', 'typecheck', 'test', 'e2e', 'migrate', 'build', 'docker']
```

### F5 [Minor] — config.ts MFA_ENCRYPTION_KEY wording

`warnDegradedChecks` claimed "unless options-configured" for MFA, but `MfaManager` reads env only. Verified SMTP genuinely IS options-configurable (`auth.ts: options.get('smtp_host', ...)` — qualifier kept); OAuth/SAML also keep theirs. Reworded the MFA line to env-only truth and synced the assertion:

```bash
$ grep -n "MFA_ENCRYPTION_KEY" apps/server/src/config.ts apps/server/src/__tests__/config.test.ts
config.ts:110:   lines.push('MFA_ENCRYPTION_KEY not set — MFA enrollment unavailable (env-only; no options-table fallback)');
config.test.ts:59: expect(lines.some((l) => /MFA_ENCRYPTION_KEY/.test(l) && /env-only/.test(l))).toBe(true);
$ pixi run npx vitest run apps/server/src/__tests__/config.test.ts   # 11 passed
```

### minor(d) — permissions-seed.test.ts unused static imports

Line 3's static `import { selfHealSeed, runSelfHealOnce, ensureSeedForAdmin }` was unused (all three only used via dynamic import). Removed the line; eslint dropped 10 → 8 warnings (the finding's stated baseline):

```bash
$ pixi run npx eslint apps/server/src/__tests__/permissions-seed.test.ts 2>&1 | tail -1
✖ 8 problems (0 errors, 8 warnings)
# before: 10 problems (3 unused-static + 7 pre-existing); after removing line 3: 8 (0 errors)
```

### Gates (all green)

| Gate | Result |
| --- | --- |
| `bash -n scripts/deploy/start.sh` | OK |
| `pixi run npx tsc --noEmit` (root) | clean |
| `pixi run npx vitest run apps/server` | **475 passed \| 11 skipped \| 0 failed** (474 baseline + 1 new F2 test; config 11 still passing) |
| `pnpm --filter @accessbase/identity build` | OK (identity touched — rebuilt before server tsc/tests) |
| eslint on touched files | 0 errors; permissions-seed.test.ts 8 warnings (baseline restored) |
| python3 yaml.parse(ci.yml) | OK — jobs: lint, typecheck, test, e2e, migrate, build, docker |
| F1 live sanity | exit 1 with CORS message, PG never started (5432 still down) |
| `git branch --show-current` post-commit | `master` |

### Concerns

- The finding's "8 warnings" baseline for permissions-seed.test.ts matched the post-fix count exactly (10 before − 3 unused = 7 pre-existing + my new F2 test's `import()` type-annotation warning = 8).

<!-- Commit: 646f561 fix(ops,server): final-review wave — CORS pre-flight, self-heal pool leak, migrate CI job, MFA warning -->
