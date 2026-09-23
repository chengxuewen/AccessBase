# Batch O: drizzle-kit ≥0.22 Upgrade — Retire the Hand-Written-Migration Workaround (Design Spec)

**Date**: 2026-09-23
**Status**: rev.1 (pending dual-Momus)
**Driver**: backlog首位 from batch N close-out (PIT-072 mid-term plan: "upgrade drizzle-kit then rebaseline snapshots")

## 1. Problem

- Current stack: drizzle-kit **0.20.18** + drizzle-orm **0.29.5** (pnpm-lock.yaml, resolved). Declared: `"drizzle-kit": "^0.20.0"` at packages/migration/package.json:43 (the ONLY drizzle-kit devDep in the repo — corrects the PIT-072 "root package.json:230" claim, which points at `@iflow-mcp/defrex-drizzle-mcp`, package.json:36) and `"drizzle-orm": "^0.29.0"` at identity/package.json:34, migration/package.json:35, server/package.json:43.
- drizzle-kit 0.20's snapshot format (v5) cannot represent partial-index `WHERE` (PIT-072): our hand-written v5 snapshots DO carry `"where"` fields (0005_snapshot.json verified by batch N explore), but 0.20 `generate` mis-parses them → `0004 data is malformed` crash, poisoning every subsequent generate (PIT-072 symptom, live-fire 2026-09-21).
- Consequence: every migration touching partial indexes (0004 phone, 0005 oidc state) is hand-written trio SQL+journal+snapshot, a discipline cost that phases I/N each paid (PIT-072, Phase N conventions last bullet: "recheck this form when upgrading drizzle-kit").

## 2. External Facts (verified via librarian, sources cited)

| # | Fact | Evidence |
|---|------|----------|
| F1 | Partial-index generate support lands in **drizzle-kit 0.22.0** ("Full support for indexes in PostgreSQL"; new index API incl. `.where(sql``)`) | drizzle-kit-mirror release v0.22.0; issue drizzle-team/drizzle-orm#1519 closed comment: "After versions drizzle-kit@0.22.0 and drizzle-orm@0.31.0 all fields are supported" |
| F2 | `eq()` helper in index WHERE emits `$1` parameters — **never fixed in 0.x** (#3349 @0.22.7, #2506, #4790 @2025-07). Our schema already uses `sql` template literals (schema.ts:375-376 `sql`${t.uid} IS NOT NULL``) → unaffected | issues as cited |
| F3 | Latest stable pair: **drizzle-kit 0.31.11 + drizzle-orm 0.45.3** (npm latest, 2026-09). 1.0.0-rc.4 exists but is a full kit rewrite (v3 folder structure, DDL snapshots) — OUT of scope for this batch | npm registry; drizzle-orm releases |
| F4 | Snapshot format jumps v5→v6 (kit 0.21.0) then v6→v7 (kit ~0.22.x), all handled by **`drizzle-kit up`**; stays v7 through the rest of 0.x incl. 0.31.11 | 0.21.0 release notes ("snapshots upgraded to version 6"); #2506/#2614 threads |
| F5 | Breaking config/CLI surface since 0.20: `:pg` command suffixes removed (0.21.0) — `generate:pg`→`generate` etc.; `dialect` mandatory in config; `dbCredentials.connectionString`→`url`; `driver` key removed (0.21.0 release notes) | as cited |
| F6 | Post-up regression watch: #6020 — `up` + `generate` can emit phantom no-op migrations due to WHERE text-normalization drift (`"table"."col"` vs `"col"`), reported across 0.31.10→rc line | issue #6020 |
| F7 | kit enforces a `drizzle-orm/version` compatibility check at startup — kit 0.31.x requires a recent orm, so orm must move together with kit (#2614 thread; F3 pairing) | issue #2614 |

## 3. Target Decision

**drizzle-kit 0.31.11 + drizzle-orm 0.45.3** (latest stable 0.x). Rejected: staying on 0.22.x (2 years of fixes skipped, and F7 version gate fights us anyway); 1.0.0-rc (rewrite, unstable, would break migrate.sh chain layout expectations — the chain dir is OUR runtime contract, scripts/migrate.sh walks `drizzle/*.sql` + journal tags).

Rationale: smallest distance to the end-state the repo wants (generate is authoritative, no hand-written trios); latest stable maximizes F6 exposure but our acceptance test below targets exactly that.

## 4. Scope

### 4.1 In scope
1. **Version bumps (4 files)**: packages/migration/package.json devDep kit ^0.20.0→^0.31.11; orm ^0.29.0→^0.45.3 in identity:34 / migration:35 / server:43. `pnpm install` → lockfile commit (constraints.md lockfile rule).
2. **Script/config rewrite (3 files)**:
   - packages/migration/package.json scripts:29-31 `push:pg`→`push`, `generate:pg`→`generate`, `up:pg`→`up`.
   - packages/migration/drizzle.config.ts: drop `driver:'pg'`, add `dialect:'postgresql'`, `connectionString`→`url` (keep DATABASE_URL fallback literal).
   - root drizzle.config.ts (MCP placeholder): already uses `url:` — only needs to survive the new defineConfig typecheck (it imports drizzle-kit root hoisted from migration's devDep? verify import resolution post-install; if root lacks access, leave as-is — MCP reads it with its own tooling; acceptance = `pnpm db:generate` runs from migration pkg).
3. **Snapshot upgrade ritual (the core step)**: run `drizzle-kit up` in packages/migration → all 6 snapshots + journal v5→v7 in place. Verify converted 0005 snapshot preserves all 4 partial-index `where` entries (2 uid/user_code on oidc_adapter_state + 2 phone indexes on users — 0004 carries `idx_users_phone` and `idx_users_phone_unique`, snapshot entries verified pre/post by grep).
4. **Schema drift reconciliation**: users.phone partial indexes (0004) are NOT declared in schema.ts (grep `.where(` hits only schema.ts:375-376) → after upgrade, ADD the missing `index()/uniqueIndex()` with `.where(sql...)` declarations to the users table so schema == snapshot (drizzle-kit's index API per F1; naming must match exactly: `idx_users_phone`, `idx_users_phone_unique`, columns `phone`). Also audit the 21 `index(` usages vs chain for any other silent drift — generate-dry-run below is the net.
5. **Generate-idempotency acceptance (the #6020 gate)**: after 3+4, `drizzle-kit generate` on UNCHANGED schema must produce ZERO migration files (or the documented "no changes" exit). Any phantom output = text-normalization drift → fix by aligning snapshot `where` strings to the generator's own format (or regenerating the head snapshot from introspection), NOT by shipping a no-op 0006 (chain frozen: applied DBs track journal tags; adding noise files worsens migrate.sh sentinel surface).
6. **ORM 0.29→0.45 compile fallout**: fix every `tsc --noEmit` break across identity/server (builder API per F1 is source-compatible for our usage shapes — grep census: 18 pgTable / 21 index / 39 varchar / 32 timestamp / 10 jsonb / 5 .references, schema.ts; no `.asc()/.using()/.with()` index modifiers in use, no old `indexColumn` API). Query-side fallout unknown until compiled — budget: any API removed between 0.30-0.45 gets its call-site adapted minimally (bugfix-minimum rule; no opportunistic refactor).
7. **Full regression**: double tsc + root tsc, `pixi run npx vitest run` (baseline 931/0 incl. real-PG suites — the oidc-persistence integration exercises the chain end-to-end), eslint 0 new errors, e2e 137+3 (workers=1, low-load window).
8. **migrate.sh three-state live-fire on scratch DBs** (unchanged chain files ⇒ this proves the upgrade never touched applied SQL): fresh→18 tables/7 tracked; idempotent re-run 0 applied; sentinel probes pass (Phase N discipline).
9. **Memory close-out (English, D121)**: PIT-072 status line → RESOLVED + the root-package.json:36 false-fact correction appended; Phase N conventions partial-index bullet rewritten (workaround retired; hand-written-trio rule downgraded to "legacy 0004/0005 files only — new chain files may be generate-produced"); conventions CI/migrate bullets checked for kit-command mentions needing reword (db:migrate inert-command note still true, command now `up` not `up:pg` — reword); status.md batch line.

### 4.2 Out of scope
- drizzle-kit 1.x / v3 folder structure adoption (rc-line, F3).
- Switching runtime migration to `drizzle-kit migrate` (migrate.sh is the audited sole runtime writer, Phase L convention — untouched).
- Rewriting applied chain SQL files 0000-0005 (frozen, applied to live DBs; generate is only ever run to diff FROM them).
- drizzle MCP server (`@iflow-mcp/defrex-drizzle-mcp`) config beyond what the new kit breaks.
- Any schema change beyond the 0004 index declarations in 4.1(4).

## 5. Constraints & Contracts (carry-forward, non-negotiable)

- **Chain is the runtime contract**: scripts/migrate.sh walks `packages/migration/drizzle/*.sql` by journal order (out/ zero-dep rule, explicit chain dir at call sites) — SQL files and journal tags 0000-0005 must remain byte-identical through the ritual (diff gate: `git diff` shows snapshot/journal meta changes only, never chain SQL).
- SENTINELS array unaffected (no new chain file expected; if generate unexpectedly emits one, STOP and reassess — do not auto-adopt).
- Test-mock honesty: identity route tests mock managers, not SQL — vitest green ≠ chain green; hence live-fire 4.1(8) is mandatory, not optional.
- `pnpm --filter @accessbase/identity build` before server typecheck (dist-sync rule, Phase C conventions).
- no_proxy prefix; workers=1 e2e; branch master re-check after every commit (detached-HEAD discipline, batch F lesson).

## 6. Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| #6020 phantom no-op migration (WHERE normalization drift v5→v7 conversion) | MED (issue spans 0.31.x) | acceptance 4.1(5); fix = align snapshot text to generator format, never ship no-op SQL |
| ORM 0.29→0.45 hidden query breakage at runtime (types pass, behavior differs) | LOW-MED | 931-test suite incl. real-PG oidc/L-chain + e2e + migrate.sh live-fire; diff release notes 0.30/0.31/0.32 during fallout fix |
| `drizzle-kit up` mutates journal in a way migrate.sh misreads (new fields) | LOW | migrate.sh parses `tag` + file order only (read its jq-less grep loop during acceptance); journal diff review in 4.1(8) |
| root drizzle.config.ts breaks (MCP placeholder imports defineConfig from hoisted kit) | LOW | pnpm strict layout means root has NO drizzle-kit at all today (declared nowhere in root package.json) — it already resolves via MCP tooling or fails silently; verify `pnpm --filter @accessbase/migration exec drizzle-kit up` path works and leave root config untouched unless typecheck complains |
| kit startup version-gate (F7) rejects installed orm | LOW | bump both in the same install (target pair from F3) |

## 7. Execution Shape (task decomposition for SDD)

- **T1 (foundation)**: version bumps + script/config rewrite + `pnpm install` + lockfile + `drizzle-kit up` + snapshot where-preservation verification (grep 4 indexes) + generate-dry-run idempotency attempt #1 + schema 0004 index declarations (4.1 items 1-5). Single branch, commits per concern.
- **T2 (fallout)**: ORM compile/behavior fixes across identity/server until double-tsc + vitest 931/0. (depends on T1)
- **T3 (live-fire + close)**: migrate.sh three-state on scratch DB + eslint + e2e + memory close-out per 4.1(9). (depends on T2)
- Parallelizable: none — strictly sequential chain (upgrade → fallout → verification). Dual-Momus on THIS spec before T1.

## 8. Success Criteria (definition of done)

1. lock: drizzle-kit 0.31.11, drizzle-orm 0.45.3; 4 package.json files updated; config/scripts in 0.21+ shape.
2. 6 snapshots + journal at version "7", all 4 partial-index `where` entries present (grep gate).
3. `drizzle-kit generate` on unchanged schema: no new file, no phantom.
4. chain SQL 0000-0005 byte-identical (`git diff --stat` shows zero .sql changes).
5. double tsc 0 errors; vitest 931/0 (or documented rebaseline if counts legitimately changed); eslint 0 new; e2e 137+3 0 fail.
6. migrate.sh fresh/idempotent/sentinel three states green on scratch DB.
7. Memory: PIT-072 RESOLVED addendum, Phase N conventions bullet retired-to-legacy, status batch line, D-entry if strategy decisions materially change post-review.
