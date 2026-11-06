# AccessBase — Long-Term Plan & Phase Roadmap

> **As of:** 2026-11-05 · **Ratified by:** 10 one-at-a-time user rulings (R1–R10, §8 below)
> **Supersedes:** the v3.0 plan retained at the foot of this file (per R9, option ①: kept in
> place with a superseded header, not deleted). **Replaces:** nothing outside this file — phase
> batches continue to live in `docs/superpowers/plans/` (48 files, existing convention).

---

## 0. How to read this document — evidence classes

Every claim carries its evidence class. This convention exists because the audit that produced
this plan found **9 claims in the repo's own status documents that were contradicted by the
code** — the failure mode is not missing work, it is trusting a stale list.

| Tag | Meaning |
|---|---|
| `[measured]` | Verified on this machine during the 2026-11-04/05 audit; command stated or reproducible |
| `[doc-claim]` | Asserted by a repo document, **not independently re-checked** — do not schedule on it alone |
| `[unverified]` | Deliberately not tested; becomes a prerequisite measurement, never a premise |

Naming convention (added by review D3 to stop prefix collisions): this document's rows are
`T#` (truth), `E#` (engineering health), `V#` (verification debt), `S#` (phase), `R#` (ruling of
2026-11-05). Panel findings are always written with their report's date and dash form —
`C-1…C-4` / `E-1…E-6` / `D-1…D-6` / `X-1…X-3` — and never abbreviated to bare `E1` or `D1`.

Rule (binding): a `[doc-claim]` may not appear in a phase's scope until it is re-measured or
re-labelled. Re-judging a claim is recorded by date, not by silent edit.

Rule (binding, added by the 2026-11-05 self-review): a `[measured]` tag may not assert more than
the stated command actually covered, and any figure taken from a build artifact rather than a
fresh run must carry `asOf <artifact date>`. This rule exists because the first draft of this very
document broke it three times (the dead-package claim, the panel item count, the coverage rows).

**This document is inside the scope of the S1 lint, not above it.** The 2026-11-05 self-audit
counted 45 evidence tags here (30 `[measured]`, 7 `[doc-claim]`, 8 `[unverified]`), roughly 17
hand-written measurable figures, and 14 `[measured]` tags without a machine-parseable anchor —
and the counting script itself proved heuristic: at least 3 of those 14 are false positives
(the legend row, the rule text, a table header), because it matched prose mentioning a tag rather
than an assertion carrying one. Consequence, deliberate rather than an oversight: the anchors
added below are spot fixes on the rows most load-bearing for a deletion or a phase, and the
**complete** anchor/date reconciliation of this file is an S1 deliverable performed by the same
lint that judges the 44 module headers — not by another round of hand-written scripts, which is
the step that failed repeatedly during this audit (scan roots too wide; a directory-level `.d.ts`
heuristic; a path-splitting bug; an over-counting regex — each surfaced by a later check, not by
the author noticing).

**Run-time vs decision quantities (added by review round 2, ruling R2-X1=C).** Two kinds of number
appear here and they are not equally legitimate. A **decision quantity** is an input to a ruling
that does not move while the plan is being read — package line counts, the 2.51 % admin-ui
coverage figure, the number of alert definitions, the 44/38 header arithmetic. These may be written
as numbers but must carry `asOf` and the command that yields them. A **run-time quantity** changes
under the reader's own operations — unpushed commit counts, CI job counts, "how many times did this
document contradict itself". These must **not** be written as numbers: state the command or the
pointer instead (`git rev-list --count origin/master..HEAD`, "every job under `jobs:`"), because
the act of executing the plan invalidates the figure. The distinction is also why the S1 lint may
only warn: deciding which class a number belongs to is semantic, and this document has already
shown four different broken attempts at that kind of check.

Another self-violation, caught by machine rather than by reading: the §4 separator row declared
four columns against a three-column header. The 10 code spans that still contain raw pipes (the grep
pattern list in Tier 3) are inside ordinary paragraphs, not table cells, so they are left as-is —
flagging them was the checker over-reaching, not a defect. Lesson recorded for the S1 lint design:
cell/column consistency and in-cell pipes are machine-checkable; "is this code span inside a table"
is the qualifier that stops a format gate from crying wolf.

- **Evidence types, and what it takes to close something (R2-X3=B).** Review round 2 showed the
  failure was not *who* checked but *how many independent kinds* of evidence backed a claim: I filed
  a CRITICAL on a single evidence type (a command chain read through `accessbase.sh` →
  `package.json`), which a second type (reading the scripts themselves) then downgraded.
  Four types count:

  1. **artifact anchor** — a `file:line`, schema object, or generated inventory read directly;
  2. **reproducible command** — a count or grep anyone can re-run;
  3. **independent source** — a different document or generated file (not a second command over the
     same input; two same-origin commands are **one** type);
  4. **observed execution** — the thing actually run once.

  A row may be **closed or re-tiered only with ≥ 2 types**; staying `open` needs just 1 (the
  asymmetry is the point: closing is the dangerous act). Authorial assertion — "I read it and it is
  so" — is not a type. Where a claim has one type only, it stays labelled `[doc-claim]` even if the
  single type is strong.

- **Read the surrounding unit before judging a fragment (third instance of the same self-error).**
  Three L1 rows were withdrawn or reclassified not because the documents were wrong but because the
  evidence was taken out of context: a status header read up to its first clause (`audit-sdd.md`), a
  config field mistaken for a shipped feature (`database.md`), and a bare phrase mistaken for a
  different subsystem (`permission.ts:36`, whose "scope engine" sentence belongs to the API-key
  bypass comment, not to `data-scope`). Rule: any claim built on a **quoted fragment** must be
  re-checked against the enclosing block, paragraph or line-span before it enters a ledger — and the
  type count does not rise by taking two fragments of the same thing.

  **Boundary of the two-type rule (found the hard way).** When the assertion is *about a file's own
  content* — how many jobs `ci.yml` defines, what thresholds `vitest.config.ts` sets, whether a
  phrase appears in a header — that file is complete and sufficient evidence, and demanding a second
  type would only buy a second read of the same source. The two-type bar applies to **inferences
  across sources** ("this package is unused", "this feature is shipped", "this claim is stale"),
  which is where every one of my withdrawals actually came from. Label the self-evident kind as
  `artifact-self` so the distinction is visible rather than improvised.

- **Snapshot documents are exempt from the evidence rules but must point at the live source.**
  Reports under `docs/superpowers/reports/` and the retained v3.0 plan above are dated views: they
  are never rewritten to match later findings (that would destroy the record), and in exchange each
  one carries a pointer to the artifact that superseded a part of it — e.g. `gap-map-v2` §3, merged
  into L3b per R2-D2=C. Only live documents (this file, module status headers, `AGENTS.md`,
  `memorys/*`) are held to the tag and `asOf` rules above.

---

## 1. Overview

AccessBase is an enterprise IAM foundation (Fastify + Drizzle + PostgreSQL + Redis, React +
Ant Design admin UI). The shipped surface covers authentication (password/MFA/captcha/OAuth/
OIDC provider + generic RP/SAML SP/magic link/SMS OTP/LDAP/passkey), RBAC with tenant
partition and per-binding row scopes, users/groups/roles CRUD, audit with a tamper-evident
chain and sanctioned erasure, events outbox + webhook dispatcher, helpdesk self-service,
multi-tenant control plane, metrics and backup operations `[doc-claim, from AGENTS.md — not
re-run in this audit]`.

This plan exists because the backlog had **many coexisting carriers with no authority between
them** — measured on 2026-11-05: this file's v3.0 plan, `docs/superpowers/plans/`, `specs/`,
`reports/`, the root `AGENTS.md` status paragraph, gitignored `.omo/plans/`, and
**three separate adjudication sections inside the governance plan alone** (16 points, Batch 7's 11
points, an OpenCode set added by a concurrent session) plus two execution logs — and because the
oldest carrier still announced "waiting to start implementation" eleven weeks after Phase 9.

---

## 2. Backlog — four layers

### L1 · Truth layer — reconcile before anything is scheduled

Rows are dispositioned under §0's evidence rule: **a row may be called a contradiction only with
≥2 evidence types**. Two rows were withdrawn on 2026-11-05 for holding one type only — the single
`grep -m1` over a long single-line status header that carries its own later corrections. Row count
is deliberately not stated in prose (run-time quantity; §0).

| # | Claim in the documents | Reality | Where to fix |
|---|---|---|---|
| T1 | `integration.md`: "push side (webhooks/events) absent" | `[measured]` 2 types: command (pattern scan finds no self-correction in the file) + artifact anchor (`apps/server/src/utils/webhook-dispatcher.ts:111` `FOR UPDATE SKIP LOCKED`, 60 s lease, plus `webhook-metrics.ts`) | **DONE 2026-11-05** — header rewritten, prior verdict kept as provenance |
| T2 | ~~`audit-sdd.md` says the tamper chain is "STILL design-only/deferred"~~ **WITHDRAWN 2026-11-05 — false on re-reading** | The same header line continues **"SUPERSEDED by the R-audit batch (2026-09-28): the tamper-evident chain is now IMPLEMENTED end to end"** and names the chain file `0010_early_odin.sql`, the `row_hash`/`anchor_id`/`erased_at`/`erasure_id` columns, `audit_chain_anchors`/`audit_erasures`, the anchor worker and `GET /api/v1/audit-logs/verify`. The document was never wrong; my single-type `grep -m1` read was. **Kept in the table as the record of a withdrawn claim**, per "mark, do not delete" | none — nothing to fix; §0's two-type rule is the artifact |
| T3 | ~~`database.md`: "§22.4 retention/archival unimplemented"~~ **WITHDRAWN / narrowed 2026-11-05** | The header already splits the two: "the retention side **is** consumed since Q2a; archival still is not" — matching `utils/retention-sweeper.ts` reading `AUDIT_RETENTION_DAYS`. My inference that archival was shipped rested on seeing an `archiveAfterDays: 90` value, i.e. **a field existing is not a feature landed** (1 type, and the wrong kind) | none for retention; archival stays open in L3b until a reader is found (needs its own 2 types) |
| T4 | `compliance.md`: "data-export absent; user delete hard-cascades" | `[measured]` 2 types: command (endpoint scan) + artifact anchors — `/api/v1/audit-logs/export`, `/api/v1/users/export`, and sanctioned RTBF erasure wired into user deletion at `routes/users.ts:683-749` (`eraseAudit` + mandatory `legalBasis`, tenant-wide `all` data scope required, `ERASE_LOCK_BUSY` retry) | **header DONE 2026-11-05**; the portability scope question stays open in L3b/T4 |
| T5 | gap-map-v2 §3: password history/expiry "deferred P2" | `[measured]` 2 types: command (grep for `passwordExpiry\|maxPasswordAge\|passwordChangedAt` → 0) + artifact anchor (`packages/identity/src/db/schema.ts:246` `password_history` + index, `UserManager` insert/delete/keep). **Split verdict: history closed, expiry open** — one §3 row bundled the two | L3b rows; deferred ledger entry |
| T6 | ~~`permission.ts:36`: "Scope engine is a spec non-goal for now" contradicts the shipped data-scope engine~~ **WITHDRAWN 2026-11-05 (third self-error)** | Read with its enclosing block (lines 30-40) and the sentence belongs to the **API-key bypass** comment — "API keys bypass permission checks in v1 … would 403 every key request (deadlock). Scope engine is a spec non-goal for now" — i.e. key-scoped permission checking, **not** the `self/dept/all` row-scope engine in `utils/data-scope.ts`. The comment is accurate about what it describes; my inference was the error, made from a phrase taken out of context | none — nothing to fix. Ledger keeps the row as the record of a third same-family misread |
| T7 | `CHANGELOG.md` last entry 2026-10-12 | `[measured]` 2 types: file content (newest section dated 2026-10-12) + `git rev-list --count 028f6c8..HEAD` = 50 (recount before use — a moving target while batches land) | **DONE 2026-11-05** — six batch entries added covering those 50 commits (`03dfb3e`), grouped by wave rather than per commit |
| T8 | `.agents/memorys/status.md` recent-work stops 09-12; baselines quoted as vitest 491 / e2e 107 — **claim narrowed 2026-11-05, fourth T2-family misread**: 491/107 is a 09-12 historical record line (`status.md:120`); the live header reads 1250 / 173 (as of 09-28) and the recent-work tail reaches 10-12 | `[observed execution]` 2026-11-05 full runs: vitest **1588/1588 passed (143 files)** with 12 uncaught errors — PG 57P01 teardown cross-kills around `data-scope-integration` when other integration files' teardowns run in parallel — leaving the local exit non-zero; the CI Test job defines no `services:` block, so `describe.skipIf` skips every integration there and CI green is **green-by-skip** (the local run is the full-semantics baseline). e2e via the real entry, root `pnpm test:e2e`: **9 failed** — api-keys ×3 + clients ×5 mock table-row assertions, setup-real-flow ×1 environmental (no backend) — so AGENTS.md's "1556 / 184 all green" is stale on both counts and on "all green"; the open attribution is registered as E10 | **MEASURED 2026-11-05, status.md edit deferred** — the file is the concurrent session's active area (last written 09:28 today), so the corrected numbers live here, in E9/E10 and in the commit message; the measurement also closes governance P0-c. Wrapper defect found en route registered as E9. Local e2e recipe recorded in the commit message: dual-stack `vite --host ::` plus proxy env stripped (`localhost` resolves `::1`-first, the default vite binds IPv4-only, and the shell proxy hijacks even localhost probes) |
| T9 | `AGENTS.md` remaining ladder lists "re-encrypt tool" as outstanding | `[measured]` **2 types**: the CHANGELOG entry dated 2026-10-08 ("`scripts/re-encrypt.ts` closes the *_OLD key-rotation windows … R-B registered debt paid") + the file present on disk (`scripts/re-encrypt.ts`, dated 10-08) | **DONE 2026-11-05 (tenth cut, hot zone cooled)** — "re-encrypt tool" removed from the carryovers line; the OVERVIEW historical mention stays (it records what shipped, not what is owed); header Updated date bumped to 2026-11-05 |
| T10 | Batch 3 was marked `EXECUTED` while its "gates into checked-in CI" deliverable had not landed | `.github/workflows/ci.yml` now has `Governance Gates` (7f); the false EXECUTED is already AMENDED in the governance plan | closed, documented |
| T11 | `AGENTS.md` STRUCTURE still carries measurable counts (`:19` "13 project-specific skills", `:20` "14 language dirs") | `[measured]` **2 types**: file content + directory counts (skills dirs vs the digest's own row list; rule dirs with and without the excluded `zh/`) — so `:19` is wrong today, and ADJ-7h's purge reached the marker regions and hub digest but not these handwritten STRUCTURE lines | **DONE 2026-11-05 (tenth cut)** — both counts removed rather than recounted, per R2-D/R2-X1; disk truth at removal: **15** skill dirs vs the claimed 13 (the digest table itself omits code-review-and-quality and expert-panel-review), 14 rules dirs where "14 language dirs" counted common/web/zh ambiguously — the rot the removal prevents |
| T12 | `monitoring.md` §13.3 says "alerting … unimplemented" | 3 evidence types: deployment-chain grep (`prometheus` = 0 hits across all compose files, `Dockerfile`, both entrypoints, `.github/`); file read (7 complete rules with `severity`/`for`/annotations, incl. `up{job="accessbase"}` and an audit-anchor staleness alert); cross-source (every metric referenced exists in `metrics.ts`, `webhook-metrics.ts`, `audit-metrics.ts`). Verdict: "unimplemented" is **substantially correct** (nothing is wired) → precision-of-wording, not a contradiction | `monitoring.md` §13.3 wording + the `rules.yml` header, inside S1 — 11-05 P3-A stands on 3 types |
| T13 | `doc-audit`'s own audit scope list | `[measured]` 2 types: command (existence probe over all 16 listed paths → **12 missing**: `docs/phase-planning.md`, `docs/plans/`, `competitive-landscape.md`, `plugin-architecture-analysis.md`, `api-specification.md`, `database-schema.md`, `test-seed-strategy.md`, `redis-mock-guide.md`, `e2e-test-flows.md`, `api-conventions.md`, `dev-workflow.md`, `frontend-spec.md`, `.opencode/oh-my-openagent.jsonc`) + artifact (the skill asserts "11 TDD docs", glob returns **0**, and its gap dimension says "packages/ 目录未创建、无 CI/CD 配置" against a repo with 8 packages and 8 CI jobs) | **DONE 2026-11-05 (tenth cut, hot zone cooled)** — scope table rebuilt on the real doc surface (13 referenced paths re-measured MISSING same day); the fabricated "unimplemented features" list replaced by pointers to the authoritative ledgers (implementation-plan L2/L3b) plus an asOf snapshot; "11 SDD / 11 TDD docs" → measured **8 / 0**; plugin-era remnants (`@audebase/`, shared-types, manifest-engine, D1.x/D6.x numbering, the NocoBase example) replaced with the live surface; the `team_create`/`oracle` sample kept as a reference form with a host-capability note. Until this cut, any `/doc-audit` run reported fabricated gaps |
| T14 | `core-packages.md`: "6 of 8 packages wired into apps; i18n and migration runtime unused" | `[measured]` 2 types: source-import scan over `apps/*/src` (**identity 128, logging 34, audit 8, types 1; admin/health/migration/i18n all 0**) + the dependency declarations read from `apps/server/package.json` (health/i18n present as phantom production deps) → it is **4 of 8**, and the row's implication that admin and health are wired is wrong | **DONE 2026-11-05** — header rewritten, prior verdict kept as provenance |
| T15 | `cicd.md`: "7 jobs defined" | `artifact-self` (one type, and sufficient under §0's new boundary): `.github/workflows/ci.yml` defines **8** jobs — Lint, Type Check, Test, E2E (Chromium), Migration chain, Build, Docker Build, Governance Gates (the last from ADJ-7f). The second half of the row — "first green run not yet observed" — stays true and unresolvable from here (no GitHub remote) | header updated 2026-11-05; the "unobserved-CI" caveat was retired the same evening with evidence — zero green runs since 9-20 because the file is rejected wholesale (E11); "unresolvable from here" proved wrong, the run pages are public |
| T16 | `testing.md`: "ratchet floors 46-77" | `artifact-self`: `vitest.config.ts` thresholds are `statements 46 / branches 71 / functions 70 / lines 46` — "46-77" mis-states the pair, and measured coverage (56.33 / 79.31 / 80.23 / 56.33) means the 80 % target holds only for branches and functions. The vitest case counts (972 then; 1556 claimed since) were **not re-run** and stay `[unverified]` | header updated 2026-11-05 for the floors; case-count claim left explicitly unverified |
| T17 | **`@accessbase/react` does not exist, but design docs treat it as shipped** | `[measured]` 2 types: package inventory (`packages/*/package.json` names → admin, audit, health, i18n, identity, logging, migration, types — no react) + document scan — the original citations are `branding.md:100` (`import { AccessBaseProvider } from '@accessbase/react'`) and `integration.md:53`, `:66` (an SDK table row), `:86`, `:229` (a deploy manifest `package: @accessbase/react`). No count is stated here on purpose: once the caveats below were added, a `grep -c` over these files returns more hits than the original list, which is exactly the kind of number that goes stale by being written down | not a wording fix: two documents describe a delivery surface that is not in the repo. **Ruled 2026-11-05 (R11=A): design intent, signal-gated** — both documents re-marked in future tense with the rise condition (a real consumer frontend starts); the design record is kept, nothing deleted, nothing scheduled. Found **while executing T1**: my own integration.md header rewrite left its body citing the phantom package |
| T18 | `api.md`: "versioning/deprecation policy unwritten" | `artifact-self`: §23.2 "API 版本控制" does exist (URL-path versioning), and openapi lists 104 paths of which only `/health/{live,ready,startup}` sit outside `/api/v1` — so the accurate claim is "versioning documented, **deprecation** policy absent", not "versioning unwritten" | **DONE 2026-11-05** — header rewritten on the artifact-self boundary (re-measured same day: 104 paths / 3 outside `/api/v1`), A10 and the Q1–Q4 write-up gap explicitly carried as not-re-checked |

### L2 · Engineering health

| # | Item | Evidence |
|---|---|---|
| E1 | Coverage ratchet stalled: floors `statements 46 / lines 46 / branches 71 / functions 70`, comment says "raise ~5pt per batch, never lower" written 2026-09-20 | `[measured]` vitest.config.ts:20-27 |
| E2 | Measured reality (`asOf` the 2026-11-02 `coverage/coverage-final.json`; **not re-run** in this audit): **56.33 % statements / 80.23 % functions / 79.31 % branches**; `apps/server` 90.43 %, `packages/audit` 88.83 %, `packages/identity` 82.48 %, **`apps/admin-ui` 2.51 % (198/7903, 65 files at zero)**; 4 unused packages + logging + types at 0 % | `[measured]` coverage-final.json dated 2026-11-02 |
| E3 | Unused packages — per-package status differs, **no blanket claim**: `admin` 1356 lines, 0 source imports **and** 0 dependency declarations → truly orphaned. `i18n` 162 lines, 0 imports but **declared in `apps/server/package.json` `dependencies` (`workspace:*`) — a phantom declaration**. `health` 881 lines, 0 imports but 1 type-only import (`identity/src/fastify.d.ts:7`) **plus a phantom production declaration**, and it duplicates the live `routes/health.ts` (139 lines). `migration` 835 lines, 0 imports, 0 declarations, **but it is the execution host of `db:push`/`db:generate`/`db:migrate`** (root `package.json:24-26` → `pnpm --filter @accessbase/migration`; `accessbase.sh:668`) → live tooling, not dead | `[measured]` 2026-11-05: source-import grep + `package.json` dependency scan + command chain trace |
| E3b | **Phantom production dependency declarations** (`@accessbase/health`, `@accessbase/i18n` declared by `apps/server` but imported nowhere): dead wiring that survives `pnpm install`, misleads consumer analysis, and would break a `--frozen-lockfile` build if the packages vanished without removing the declarations. Whether this counts as "a consumer" for R4 purposes is unresolved → panel conflict **X-2** | `[measured]`; classification open |
| E3c | **Build-chain coupling — a fourth kind of consumer, missed by the first draft of S3.** `accessbase.sh:809` runs `for pkg in types logging i18n migration health identity audit admin` and `:575` does `pnpm --filter @accessbase/migration build`. So every one of the four packages is wired into the repo's build/prepare path even with zero source importers: deleting a package without editing these two sites is a silent-behaviour or hard-failure change. Also `[measured]`: the root has **no** `drizzle-kit`/`drizzle-orm` dependency, so moving the `db:*` scripts to root would add one (a lockfile change) | `[measured]` 2026-11-05, added by the self-review after panel P2 exposed the single-axis view |
| E4 | Empty-catch cleanup is done (0 occurrences, re-checked with a multiline-aware regex) **but no ESLint rule guards it** — only `no-empty-pattern: warn` is configured | `[measured]` eslint.config.mjs:68 |
| E5 | G7 monolith quartet: `Login` 563 (split), `Settings` 614, `Webhooks` 535, `Groups` 528 | `[measured]` wc -l |
| E6 | G12 error-catalog regen-diff CI step absent | `[measured]` grep of ci.yml = 0 |
| E7 | ~~**10 commits unpushed**~~ — **superseded the same evening**: every queued commit is now on Gitee origin (observed 2026-11-05, pushed outside this session), and the D122 mirror **does** sync — run #29 corresponds to `6d1e0a2`, fired within minutes of the push. But no job ran (E11), so D122 consequence (1) ("first push after a workflow change must be verified by a green Actions run") stays UNMET, now behind a located blocker rather than an absence of evidence; `Governance Gates` still has never executed | `[observed execution]` 2026-11-05: GitHub run list + run #29 annotations (`chengxuewen/AccessBase/actions`) + `git status -sb` clean — **W2 advanced it 2026-11-05**: run #31 executed the job graph, so the located blocker moved from file-rejection to two config defects (E12/E13); Governance Gates reached an executed node for the first time but died at the pnpm setup step before its gate commands ran — UNMET until a green run lands |
| E8 | ~~A `@deprecated DEAD API with zero src callers` marker remains~~ — **closed**: re-grepped 2026-11-05, 0 hits; the concurrent session cleaned it up between the audit pass and the plan being written. Kept as a row deliberately: it went stale **within one day of writing**, which is the failure mode §0 exists for | `[measured]` closed 2026-11-05 |
| E9 | `bash accessbase.sh test:e2e` is a **silent fake success**: the wrapper filters pnpm to `@accessbase/admin-ui`, which defines no `test:e2e` script; pnpm answers "None of the selected packages has a test:e2e script" and the wrapper still reports OK — nothing runs | `[observed execution]` 2026-11-05 (T8): the real entry is the root `pnpm test:e2e` (playwright). Wrapper fix is a one-liner; deferred pending user sanction (code change) |
| E10 | e2e on HEAD: **9 failures** — api-keys ×3 + clients ×5 mock table-row assertions, setup-real-flow ×1 environmental (needs a real backend that was not started) — against AGENTS.md's "184 (+3 skip) all green" | `[observed execution]` 2026-11-05 (T8, dev-server mode over a dual-stack vite, proxy env stripped): attribution **open** — pre-existing regression vs dev-server cold-compile flake not yet separated; a rerun on built assets (or a bisect) is required before the word "regression" is allowed |
| E11 | **`.github/workflows/ci.yml` has been invalid since 2026-09-20** — `no_proxy` (L112) and `NO_PROXY` (L113) duplicate one env key under Actions' case-insensitive check, so GitHub rejects the whole file (`'NO_PROXY' is already defined`, Line 113 Col 7) and **no job has ever run** — all 8 included. Runs #17-#29 all carry this single annotation (spot-checked #29 = `6d1e0a2` and #24 = `2989747`, same error). `git log -S` puts the pair in `646f561` (final-review wave, 09-20 13:03) — three days **before** D122 was decided: the green-run duty was never executable, and 46 days of red runs went unread because nobody opened one. No local gate catches this class: nothing runs workflow-schema validation (actionlint absent) — **CLOSED 2026-11-05 (W1+W2)**: duplicate `no_proxy` removed; run #31 = `124bf8a` (id 42010758080) shows the 8-node job graph executing — the file-level rejection is dead; remaining reds are config-level, registered as E12/E13 | `[observed execution]` (run #29 + #24 annotations, public pages) + `[measured]` local file L112-113 + `git log --all -S NO_PROXY` single introducing commit — 2 types, independent |
| E12 | **pnpm version declared twice** — ci.yml passed `version: ${{ env.PNPM_VERSION }}` (9) into pnpm/action-setup while `package.json` declares `packageManager: pnpm@9.15.0`; the action refused the mismatch and **6 of 8 jobs died at the setup step in 5-13 s, before any command ran** (identical annotation per job). — **FIXED 2026-11-06 (W2.x, user-sanctioned route A)**: the global `PNPM_VERSION` env and ALL SEVEN `with: version` blocks removed (initial "6" was a truncated grep — Governance Gates carried a seventh; self-corrected against the file), `packageManager` is now the single version source; acceptance = the next executed run clears the setup step | `[observed execution]` run #31 annotations + `[measured]` local ci.yml/package.json cross-check, post-fix residue grep = 0 — 2 types |
| E13 | **Migration chain service container fails at `docker create` (exit 125)** — **root cause CONFIRMED 2026-11-06 by local repro, 2 evidence types**: Actions word-splits the `options` string, so bare `--health-cmd pg_isready -U accessbase` reaches docker as separate args (`-U` parsed as an unknown shorthand → the SAME exit 125 reproduced locally in the Actions arg order; first repro attempt with the image NOT last proved nothing — wrong arg order, self-caught) — quoting the value → exit 0 with the full parameter set. **Fix landed** (quoted health-cmd); acceptance = the service comes up and ops-migrate executes in the next run | `[observed execution]` run #31 annotation + `[measured]` local docker create repro (fail-125 + success-0 pair) — 2 types |

### L3 · Capability gaps — three tiers (R7-D)

Tier assignment is provisional until S1 re-judges each row; the tier, not the item, is the decision.

**Tier 1 — risk-driven** (a known correctness or security gap exists)

| Item | Evidence | Note |
|---|---|---|
| Optimistic locking / concurrent-write protection | `[measured]` no `tokenVersion` / `FOR UPDATE` in `routes/users.ts`, `routes/roles.ts` → simultaneous admin edits silently overwrite | `[unverified]` whether a Manager-level or transactional guard exists elsewhere — **must be settled in S1 before scoping** |
| `identity-sdd` drifted contract (A3: `setup`+`enable` standing in for `enable`+`confirm`; `validateSession`/`rotateRefresh*` naming) | `[doc-claim]` | contract truth, precedes any new surface |

**Tier 2 — one step away** (already built, needs a decision or a mount, not a feature)

| Item | Evidence | What "one step" means |
|---|---|---|
| Message queue | §17.4 "unimplemented (outbox = interim)" vs. a production outbox with `FOR UPDATE SKIP LOCKED` + lease + drain | **decision**: ratify outbox as the long-term design (record as a D-entry) or open a real MQ project |
| Secret management wording | `secret-mgmt.md` says "Vault/KMS zero hits" (literally true) while envelope key versioning + `scripts/re-encrypt.ts` are live | re-label to "self-managed envelope encryption exists; no external KMS integration" |
| API versioning / deprecation policy | only 3 scattered `deprecat*` comments; no policy text | documentation + one convention (sunset headers, deprecation window) |
| Data-export scope | export endpoints exist; whether they satisfy portability obligations is undecided | scope question, then decide tier |

**Tier 3 — signal-gated**: the authoritative register is **L3b** below (per R2-D2=C, the
`gap-map-v2` §3 ledger was merged into it row by row; the prose list that follows is retained only
for the items whose evidence exists in measured prose form, and where the two disagree **L3b wins**).

### L3b · Merged deferred register (single authoritative ledger, from R2-D2=C)

Every row of `docs/superpowers/reports/2026-11-02-gap-map-v2.md` §3, dispositioned against the
code. Verdicts: `closed` (was listed, already shipped) · `open` (still absent) · `split` (one row
contained two items in different states — the granularity defect this merge exists to catch).

| §3 item | Verdict | Now | Evidence / rise condition |
|---|---|---|---|
| Portal separation (permission-less Profile chrome) | open `[doc-claim]` | Tier 3 | rise: white-label customer demand. Not probed by pattern scan — S1 must confirm or upgrade the label |
| FGA / policy engine | open `[doc-claim]` | Tier 3 | rise: roadmap decision, not engineering backlog |
| LDAP full sync | open `[doc-claim]` | Tier 3 | LDAP exists as a login provider `[doc-claim, AGENTS.md]`; *sync* not verified. rise: a real AD |
| Helm chart | open | Tier 3 | `[measured]` `helm\|kubernetes\|service.discovery` → only `helmet` false positives. Bundled with V3 (docker integration day) |
| Tencent SMS | open `[doc-claim]` | Tier 3 | rise: demand; blocked on provider credentials (V4) |
| Phone binding UI | open | Tier 3 | `[measured]` `bindPhone` = 0; column exists, API ruled out by an earlier batch |
| OTel tracing | open | Tier 3 | deferred by a heavy-deps ruling, not by omission |
| SAML **IdP** side (we are SP only) | open `[doc-claim]` | Tier 3 | rise: market. SP-side SSO+SLO is shipped `[doc-claim]` |
| SAML IdP metadata XML ingestion | open `[doc-claim]` | Tier 3 + V7 | rise: a real IdP; surrogate-IdP results must be labelled surrogate (§ L4 rule) |
| Password **history** policy | **closed** | — | `[measured]` `packages/identity/src/db/schema.ts:246` `password_history` + index; `UserManager` insert/delete/keep |
| Password **expiry** policy | **open** | Tier 3 | `[measured]` `passwordExpiry\|maxPasswordAge\|passwordChangedAt` → 0. **Split from the row above: §3 listed them together and one of the two is already shipped** |
| Tenant switcher (frontend) | open | Tier 3 | `[measured]` `TenantSwitcher\|switchTenant` = 0; rise: multi-tenant UX ruling |
| Redis-backed permission cache | open, **rejected by ruling** | Tier 3 (parked) | YAGNI ruling on record `[doc-claim]`; a zero-dependency in-process TTL cache exists per batch B `[doc-claim]` — S1 must verify it before the row is closed as "superseded by design" |
| Search / notifications / bulk ops | open | Tier 3 | `[measured]` `GlobalSearch`/`NotificationCenter`/`bulkAction` = 0; ordering handled by R6-C's UI track |
| Mobile / responsive admin | open | Tier 3 | `[measured]` breakpoint usage confined to the setup wizard; main surface has none |
| `events` UI realtime tail | open | Tier 3 | `[measured]` `WebSocket\|socket.io\|SSE` = 0; read surface shipped, tail is demand-gated |
| *(not in §3, added by R11)* front-end SDK family (`@accessbase/react`/`vue`/`sdk`/`jwt`) | open by design, **signal-gated by ruling** | Tier 3 | `[measured]` 2 types (T17): package inventory (no such package) + git history (born with the 2026-08-21 module split, zero mentions in any batch plan since). Rise: a real consumer frontend (MediaServo React / MES Vue) starts; §15.2's standard OIDC path is the shipped alternative |
| *(not in §3, added by this merge)* alerting integration | open by design | Tier 3 | **3 evidence types** (11-05 P3-A): deployment-chain grep = 0 hits; file read shows 7 complete rules with severity/`for`/annotations; every referenced metric exists in code (`metrics.ts`, `webhook-metrics.ts`, `audit-metrics.ts`) — an operator-facing deliverable, so bundling a Prometheus deployment is a product posture, not a missing step (T12) |

Standing rule for this table: **a row may not be closed without ≥2 evidence types (§0), and a row
that bundled two items must be split** (two of the fifteen were). Evidence counts today: password
history **closed on 2 types** (schema anchor `db/schema.ts:246` + reproducible grep); alerting
carries **3 types** and is therefore safely tiered — command (deployment-chain grep = 0 hits),
artifact (read the file: 7 rules with severity/`for`/annotations, aimed at this product's own
signals), and cross-source (every metric it references exists in code: `metrics.ts`,
`webhook-metrics.ts`, `audit-metrics.ts`) — so it is an operator-facing deliverable, not a stub.
All 7 rows still marked `[doc-claim]` hold exactly one type or none and stay open by rule.
Absorbing this ledger is S1's first bookkeeping act; after that `gap-map-v2` §3 is a snapshot, not
a backlog.

Vault/KMS external integration · Helm chart + k8s/failover/multi-region (`distributed.md`, zero
code) · licensing enforcement (`/v1/license` absent) · file-storage · notification centre (no
table/routes/component) — also the backend half of R6's deferred item · realtime event tail ·
tenant switcher · phone-binding UI (column exists, API ruled out) · OTel tracing (heavy-deps
ruling) · mobile/responsive admin (breakpoint logic exists **only** in the setup wizard;
main admin surface has none — §37.6's design-only verdict is substantially correct) ·
**alerting integration** (per 11-05 P3-A: alert *definitions* ship as an operator-facing sample; whether
this product bundles a Prometheus deployment at all is a product-posture decision, not a
half-finished task — so it is not in Tier 2 and its absence is not a gap until that posture is set).
Rise condition for alerting: an operator requirement to bundle monitoring, or a customer due-diligence
ask. What S1 owes it (T12): `monitoring.md` §13.3 must stop saying "unimplemented" and say
"rules provided; integration operator-side", and `rules.yml`'s header must state the same boundary.

All "absent / zero" judgements in the paragraph above: `[measured]` 2026-11-05 by one
pattern-scan over `apps/server/src`, `apps/admin-ui/src` and `packages/*/src` (tests excluded),
patterns `vault|kms|secretsmanager`, `helm|kubernetes|service.discovery|blue.green`,
`licenseKey|entitlement|/v1/license`, `multer|s3client|putObject|multipart`,
`/notifications|NotificationCenter`, `WebSocket|socket.io|ServerSentEvent`,
`TenantSwitcher|switchTenant`, `bindPhone`, `If-Match|expectedVersion|optimisticLock`.
Two known limits of that scan, recorded so the labels are not over-read: `helm` matched
`helmet` (54 false positives, corrected by inspection), and absence of a keyword is not proof of
absence of a capability reached by another name — the S1 re-judgement must treat these as
starting points, not verdicts.

**UI track (R6-C)** — ordering is fixed by capability, not by spec:
0. Prerequisite: `apps/admin-ui` test surface (75 source files vs 8 vitest files) + the tiered
   coverage gate from R3-B, so this area stops being averaged away by the backend.
1. a11y to §14.16 (171 lines of spec; `autoComplete` 24 / `aria-label` 19 / `role=` 8 present,
   **`aria-live` 0 / focus trap 0** `[measured]`) — incremental, compliance-relevant, testable.
2. Bulk operations §14.11.3 (72 lines) — rides existing list APIs.
3. Global search §14.17 (93 lines) — needs a backend search endpoint (Tier 2 work).
4. Notification centre §14.18 (102 lines) — **register, do not schedule** (needs new table + routes + UI).
5. Mobile/responsive §37.6 (72 lines) — demand-gated.

### L4 · Condition-gated verification debt

| # | Item | Gate — triage status per R5-C |
|---|---|---|
| V1 | CI first green on the mirror | **condition met** (network reachable `[measured]`: `docker pull hello-world` succeeds; the 11-02 "push proxy-blocked, 22 commits queued" entry is stale) → S0 |
| V2 | Keycloak live-fire L1/L2 | probably met — `[unverified]` image pull from quay.io not tested |
| V3 | Docker integration day (compose.prod boot paths, deploy trust, tag pin) | **met** — docker 28.1.1 running; `postgres:16-alpine`, `redis:7-alpine`, `accessbase:dev` images already local `[measured]`; `ghcr.io/accessbase/accessbase:latest` needs a local build `[unverified]` |
| V4 | SMS real delivery | not attainable — needs provider credentials |
| V5 | dispatcher SKIP-LOCKED cross-node race under load | likely met — local multi-process against shared PG/Redis `[unverified]` |
| V6 | `entrypoint-dev` loud-fail in real docker | **met** `[measured]` docker available |
| V7 | G4 SAML redirect-arm cache gap; real-IdP SAML live-fire; Q3D live-RP | not attainable without a real IdP; surrogate IdP possible but its result **must be labelled surrogate** |

Standing rule (R5-C): surrogate verification never discharges a real-environment claim; the
register records `verified-by: surrogate | real | none` plus a condition-recheck date. This
carrier merges with R7's tier register so there is exactly one document of outstanding
verifications, not two.

---

## 3. Phase plan

Reversibility tier per R10-D: **G**reen (additive/reversible, no hot-zone overlap) runs
continuously; **Y**ellow (edits shared files) requires `git status`/`git diff HEAD` reconciliation
first, one confirmation per batch; **R**ed (irreversible, cross-boundary, or dependent on an
unruled item) stops for explicit approval each time.

| Phase | Scope | Deliverables | Acceptance | Tier | Depends on |
|---|---|---|---|---|---|
| **S0 Field close-out** | Push the queued commits — count at run time via `git rev-list --count origin/master..HEAD` (11 asOf 2026-11-05; deliberately not fixed in prose, per §0's run-time rule); observe whether the Gitee→GitHub mirror syncs and whether Actions runs; record the `Governance Gates` result | a run reference recorded against D122 consequence (1); V1 closed — **observation done 2026-11-05**: mirror syncs (run #29 = `6d1e0a2`, minutes after push, `pushed by chengxuewen`), Actions fire, result RED at file level (E11) — a third outcome between the two acceptance branches: not green, not mirror-broken, workflow-invalid; run reference recorded here; green-run acceptance stays open behind a one-line ci.yml fix pending sanction — **W1 fix landed and W2 observed (same evening)**: run #31 = `124bf8a` executed the 8-job graph for the repo's first time; still red at config level (E12 pnpm double-version, E13 service-container exit 125), so the branch is neither-green-nor-mirror-broken advanced one step: jobs-execute-but-fail, fixes sanction-gated | every job under `jobs:` in `.github/workflows/ci.yml` green (8 asOf 2026-11-05, including Governance Gates — the figure explains why a hard-coded "7" would already have been wrong, and it is not the acceptance criterion), **or** a mirror-broken finding recorded (which flips R8-C → option A) | **R** (push) | user coordination with the concurrent session |
| **S1 Truth reconciliation** | All L1 rows (12 when written, 18 as of 2026-11-05 — the cuts kept finding new ones; count at run time per §0); re-judge the **38 live module status headers** per section (44 total minus 5 superseded and 1 informational, which are only re-labelled, not re-judged), each rewritten as `Implementation status (as of <date>, evidence: <cmd or file:line>)`; the new format+recency lint lands **in this phase, with its own red/green demo performed in the same change** (R2-D gate is unimplemented as of 2026-11-05 — no prior demo exists to cite); its machine-checkable subset covers the L1/L3b ledgers too — a row marked `closed` or re-tiered must list ≥2 **distinct** evidence types from §0's enum, and a listed type must not be two greps over the same input (R2-X3=B); CHANGELOG batch-collapsed for the post-2026-10-12 commit range; status.md recent-work brought current — **deferred on the hot-zone rule** (the file is the concurrent session's; T8 registered the corrected numbers in the ledger instead); **L3b becomes the sole deferred ledger** (`gap-map-v2` §3 absorbed, a pointer added to that report; R2-D2=C) | doc/commit wave; a measured test baseline (**delivered 2026-11-05**, closes T8 — see the L1 row) | zero `[doc-claim]` left in module headers; **the new lint demonstrated RED on a planted stale/missing date, then GREEN** | **Y** | none (this is the gate for everything else) |
| **S2 Governance close-out** | P0-a pilot (`.qoder/rules` field spelling, recursion, meaning of "active" in the 100 000-char budget) → ADJ-7b/7j Qoder rules face; the outstanding panel findings from 2026-11-04 (count deliberately not restated here — read the report's merge table, per the R2-D no-handwritten-counts rule). **ADJ-7c is NOT in this phase**: it is hard-blocked by panel finding **11-04 C-2** (see §7) and opens as its own item once ruled | third host receives rules; no skill silently truncated | each new gate demonstrated red→green in its own commit | **Y**, with **R** sub-steps (deleting/rewriting skill bodies) | S1 (do not project rules whose text is still being corrected) |
| **S3 Dead-asset disposal** | Per R4-C **as amended by panel finding 11-05 P2 / conflict 11-05 X-1**: delete `admin` (1356 lines, orphaned on both axes); `i18n` and `health` deletion additionally requires removing their phantom declarations in `apps/server/package.json` (11-05 X-2 pending); **`migration` is not deletable by simply removing the directory** — see E3/E3c: its `db:*` scripts are thin `drizzle-kit` wrappers, so the options are keep-as-tooling-host, strip-its-unimplemented-CLI, or move-the-3-scripts-to-root (needs a new root `drizzle-kit` devDep). **Every package deletion must also edit `accessbase.sh:575` and the 8-package loop at `:809`, plus the `Dockerfile` COPY lines and the SDD headers.** `health`'s duplicate-of-`routes/health.ts` question stays separate. 11-05 X-1=A settled `migration`: strip the unimplemented CLI (5 source files, 835 lines incl. two `TODO: Implement …`), keep the package as the `drizzle-kit` tooling host — no lockfile change, no `accessbase.sh` edit. 11-05 P3-A settled alerting: its documentation fixes (`rules.yml` header, `monitoring.md` §13.3) belong to **S1**, not here | package set consistent with its docs | `pnpm install --frozen-lockfile` + `bash accessbase.sh typecheck` + **a local docker build** + the `db:*` commands re-invoked after any move | **R** | **its own pre-flight, not S1's**: the E3c binding inventory (complete for the 4 packages as of 2026-11-05: 2 shell sites, 8 Dockerfile lines, 0 root declarations, 2 phantom declarations in `apps/server`) |
| **S4 Quality climb** | Tiered coverage gates (R3-B) instead of one averaged number; per-area floors with `asOf` dates; E5 remaining three monolith splits; E4 empty-catch lint; E6 error-catalog regen-diff | `apps/admin-ui` visible as its own number, not hidden | each area's floor raised once with a measured baseline; vitest + e2e green | **Y** | **none from S3** (the dead packages are worth only 2.68 pt — see the ordering note below); does need confirmation of vitest's per-area capability `[unverified]` |
| **S5 Contract close-out** | Tier-2 API versioning/deprecation policy; `identity-sdd` drift reconciliation; regenerate `openapi.json`; settle T4's export-scope question | api.md is the contract surface, self-consistent | generated-artifact diff empty; no `[doc-claim]` in contract docs | **Y** | S1 |
| **S6 Capability batches** | One batch per opened Tier-1/Tier-2 item, in tier order; Tier-3 stays on the register | per item: spec → plan → batch → review, existing pipeline | per item; each Tier-3 rise recorded with its trigger | **R** per item | S1 re-judgement, plus user's go per batch |
| **S7 Condition unlock** | V2/V3/V5/V6 as soon as S0 proves the environment; V4/V7 stay gated | runbook entries with `verified-by: real \| surrogate` | evidence recorded in `docs/runbooks/` (the `multi-node.md` §6/§7 "proved / still owes" shape is the existing convention) | **Y** | S0 |

Ordering note forced by measurement: my earlier assumption "dispose of dead packages before
coverage work, because they pollute the denominator" is **wrong** — removing all four packages
moves statements only 56.33 % → 59.01 % (`[measured]` asOf the 2026-11-02 coverage artifact,
recomputed from its per-file totals, not a fresh run). S3 and S4 are therefore independent,
and S4's real content is `apps/admin-ui`, not the dead packages.

---

## 4. Milestones

| Milestone | Closes | Signal that it happened |
|---|---|---|
| M1 Truth baseline | S0 + S1 | anyone can read one document and get an accurate "what remains"; every module header has a date and an evidence pointer |
| M2 Third host wired | S2 | Qoder receives project rules; no skill body is silently truncated; the 30 000-char host limit is a project assertion |
| M3 Honest denominator | S3 + S4 | no package that is neither used nor deleted; coverage numbers per area with named exceptions |
| M4 Contract surface | S5 | api.md/openapi.json agree with routes; deprecation policy written |
| M5 Verification register | S7 | V1–V7 each real / surrogate / outstanding, with recheck dates |

---

## 5. Risks

| Risk | Likelihood | Effect | Mitigation |
|---|---|---|---|
| **Concurrent author on the same tree** — another session is actively landing governance batches here (it shipped 8 of 11 rulings before I could) | high | conflicting edits, duplicated decisions, stale measurements | Yellow-tier pre-flight `git diff HEAD`; Batch 7 plan carries a standing concurrent-author alert; one decision document (§8) rather than parallel notes |
| Measurements decay while this plan is executed | high | the plan starts scheduling on stale facts again | evidence classes (§0) + re-judge dates in module headers + the R2-D recency lint |
| Mirrors/CI topology cannot be verified (S0 fails) | medium | every "gates are enforced" claim stays false; R8-C collapses into R8-A | run S0 first; record the outcome either way |
| Package deletion breaks the image build | medium | broken docker job discovered late (it only runs on push) | S3 acceptance includes a local image build, not just typecheck |
| Optimistic-locking scope balloons (touches every write path + 409 handling + a migration) | high | Tier-1 item consumes the roadmap | scope it in S5/S6 as its own spec, and let S1 first establish whether an existing guard already covers it |
| Tiered coverage gate invents a mechanism the repo cannot maintain | low–med | another unenforced rule | prefer vitest-native configuration; if an external script is needed, it is one file in `scripts/agents/` with a red/green demo |

---

## 6. Success criteria

1. **No `[doc-claim]` remains** in any module status header, deferred ledger row, or AGENTS.md
   status/narrative paragraph (rows T1–T12) — everything is either measured with a date and an
   evidence pointer, or explicitly labelled unverified.
2. **One authoritative backlog** for "what remains"; the other carriers either point at it or are
   marked superseded.
3. Governance gates run **somewhere other than this machine** (S0) and their result is recorded.
4. The third host receives the rule layer without first importing the text errors (R7d ordering).
5. Coverage of each area is individually visible; the aggregate number is no longer used as a
   pass/fail claim.
6. Tier-3 items are **still on the register** and explicitly unbuilt — an honest backlog is
   allowed to contain "not now", provided it names the rise condition.

---

## 7. Execution protocol (R10-D)

- **Green** — additive, reversible, no overlap with the concurrent session's hot files
  (`AGENTS.md`, `.agents/memorys/*`, `scripts/agents/*`, `docs/modules/*`): proceed continuously.
- **Yellow** — edits shared/hot files or regenerates tracked artifacts: pre-flight `git status`
  + `git diff --stat HEAD`, reconcile, then one confirmation per batch.
- **Red** — irreversible or cross-boundary (deleting packages, pushing, Dockerfile, migrations,
  write-path changes) **or** implementing anything not yet ruled (ADJ-7c pending 11-04 C-2, the
  optimistic-locking scope, `health` rewiring): stop and ask, one item at a time.
- **Hard blocks** (may not be implemented before their ruling/decision exists): panel **11-04 C-2**
  blocks ADJ-7c (7c is therefore absent from S2's scope above); **11-05 P2 / X-1** blocks any
  deletion of `packages/migration` — settled as 11-05 X-1=A, so the block is now "deleting the package
  wholesale", while stripping its unimplemented CLI is approved; **11-05 X-2** blocks the
  `i18n`/`health` deletion shape until the dependency graph is truthful; **11-05 P3-A** settled
  alerting as Tier 3. Still open: R4's `health` duplicate-vs-rewire sub-decision, the
  optimistic-locking scope (Tier 1), and mirror reachability before any CI-enforcement claim.
  Naming rule for this list: panel items always carry their report date (`11-04 C-2`,
  `11-05 X-2`) — see the collision note in §8.
- No commit or push without explicit user sanction in that turn (repo C1-equivalent).
- Every new or changed gate ships with a deliberate-violation → RED → restore → GREEN record in
  its commit message (CONSTRAINTS.md verification discipline). A gate claimed without a negative
  demonstration counts as not done — this plan is the document where that lesson was learned.

---

## 8. Adjudication record (2026-11-05, one at a time, adjudication-walkthrough protocol)

| # | Question | Ruling | Binding note |
|---|---|---|---|
| R1 | Scheduling doctrine | **A** truth-first | S0+S1 precede all feature or debt work; S0 push does not wait |
| R2 | Depth of truth reconciliation | **D** layered | 38 headers re-judged **per section** with mandatory evidence date; machine gate checks format + recency only, never content truth; generatable facts go through generation (`gen-api-inventory.mts` precedent) |
| R3 | Coverage target structure | **B** tiered gates | per-area floors with `asOf` dates; zero-coverage areas must be named and justified; the aggregate stops being the claim |
| R4 | Dead packages | **C** per-package | delete `admin`/`migration`/`i18n`; decide `health` separately (it duplicates the live `routes/health.ts`). **AMENDED same day by self-review P2/X-1: `migration` is the execution host of `db:push`/`db:generate`/`db:migrate`, so its deletion is blocked pending re-ruling; `i18n`/`health` additionally carry phantom production declarations (E3b). Ruling stands for `admin` only.** |
| R5 | Verification debt | **C** triage first | measured reality already disproved one recorded blocker; real vs surrogate must be labelled; conditions get recheck dates |
| R6 | UI four-piece set | **C** build the carrier first | admin-ui test surface before any UI feature; a11y → bulk → search; notification centre deferred (needs backend model) |
| R7 | Backend ordering | **D** three tiers after re-judgement | tier assignment is provisional until S1; "one step away" items (alerting wiring, MQ ratification, deprecation policy) go first |
| R8 | CI topology | **C** keep mirror, make D122 executable | record the mirror URL + sync state; workflow-touching commits must cite a green run; delete or explain the dead `pull_request` trigger; **S0 push is the feasibility test** — if the mirror does not sync, this flips to A |
| R9 | Plan carrier | **C** rewrite `docs/implementation-plan.md` | v3.0 retained below with a superseded header (option ①), not deleted |
| R10 | Execution mode | **D** reversibility-tiered | Green continuous, Yellow pre-flight per batch, Red/ruled-dependent one stop each |
| R11 | Phantom `@accessbase/react` SDK family (L1 T17): product status | **A** design intent, signal-gated | the family stays as design documentation in future tense (integration.md §15.3-15.5, branding.md §16.5) with rise condition "a real consumer frontend starts"; nothing deleted, nothing scheduled; the shipped integration route remains §15.2 standard OIDC. Investigation found: born with the 2026-08-21 module split, never scheduled in any of the batch plans, named consumers are L2 products outside this repo |

### Panel-round rulings (2026-11-05, same protocol, on this plan)

Prefix collision, recorded because it broke the §0 naming rule the same page states: this round's
items are also called X-1…X-3, and the 2026-11-04 report has X-1…X-3 with different meanings
(there: `question()` scope, ADJ-7b premise, E-1 severity). **Hereafter always write the date.**
The table below is therefore `11-05 X-1` etc.; the older ones are `11-04 X-1` etc.

| # | Question | Ruling | Effect |
|---|---|---|---|
| 11-05 X-1 | Is `packages/migration` deletable? | **A** strip-the-shell | delete the 5 unimplemented CLI sources (835 lines incl. 2 permanent TODOs); keep the package as the `drizzle-kit` tooling host → no lockfile, no `accessbase.sh`, no Dockerfile churn. R4-C's deletion list narrows to `admin` (uncontested) + `i18n`/`health` (behind X-2) |
| 11-05 X-2 | Does a phantom dependency count as a consumer? | **B** fix the graph, then gate it | order: ① declare `health` in `packages/identity` (its `fastify.d.ts` already imports it undeclared — the only build-fragile finding); ② clear the 6 declared-but-unused; ③ then a `pkg-deps-lint` layer with mandatory `--self-test` fixtures. `health`/`i18n` deletability is decided *after* the graph is truthful |
| 11-05 X-3 | Severity of this document violating its own evidence rules | **C** self-application | no new mechanism: the S1 lint's declared scope now covers this file too; only the load-bearing rows were spot-anchored by hand, and the audit trail records that the throwaway verification scripts were each wrong in a different way — "the tool said so" is not an evidence class |
| 11-05 P3 | Which tier is alerting? | **A** Tier 3, keep the file | "bundles a monitoring stack or not" is a product-posture decision, not a half-finished task; `monitoring.md` §13.3 wording and the `rules.yml` header become S1 documentation corrections (new row T12) |
| R2-X1 | Run-time vs decision quantities | **C** split by class | see the round-2 table below |
| R2-D2 | §6 criterion naming an unowned ledger | **C** absorb + point | see the round-2 table below |
| R2-X3 | How much to discount the author's own re-review | **B** evidence-type pluralism | §0 gains four evidence types and the "close needs ≥2 types, stay-open needs 1" asymmetry; C's labelling half folded in as the `evidence types` counts in L3b. Chosen over identity-separation because every correction in this audit came from adding a second evidence type, not from a second person |

### Panel round 2 rulings (2026-11-05, same day, against the committed plan `d69e241`)

| # | Question | Ruling | Effect |
|---|---|---|---|
| R2-X1 | May the plan contain run-time quantities? | **C** split by class | §0 gains a decision-vs-run-time rule; S0's commit and job counts became commands with an `asOf` note; the self-violation tallies were de-numbered into an enumeration; the S1 lint may only warn, because classifying a number is semantic |
| R2-D2 | §6 criterion #1 names a deferred ledger no phase owns | **C** absorb + point | new **L3b** is the sole deferred register (all 15 `gap-map-v2` §3 rows dispositioned, two split, one closed with a measured anchor); §0 gains the snapshot rule; the report body is untouched and carries a downward pointer; S1's scope now names L3b explicitly |

Round 2 also produced two clean confirmations worth keeping on the record: the dependency-graph
counts (6 / 1) and the T12 Prometheus finding reproduced exactly, and `gap-map-v2`'s own coverage
line matched an independent recomputation — so the failure mode here is **staleness and granularity**,
not measurement incompetence, which is what L3b's "split rows" and "anchor or stay open" rules
address. Open items from round 1 that round 2 did not touch remain open.

**Defaults I applied where the ruling letter did not answer the sub-question** (each reversible):
R3: named exception list maintained inside the gate config, not a separate document ·
R4: `health` treated as a separate decision, nothing deleted yet ·
R5: verification register merged with R7's tier table into **one** document ·
R6: notification centre registered as deferred rather than scheduled ·
R7: `identity-sdd` drift kept in Tier 1 ·
R8: `pull_request` trigger deletion proposed, not performed ·
R9: historical content **kept in place with a header** (option ①) rather than archived to
`docs/reference/`.

Panel round: 11-05 X-2's `declared-but-unused` severity → **yellow when the gate ships, red after the 6
existing rows are cleared** (two-stage, since shipping it red today would block every commit);
11-05 X-1's "may `admin` proceed to S3 immediately?" → **not executed**, S3 stays behind S0/S1;
11-05 P3-A chose "keep the sample file" — the `rules.yml` header wording itself was left for S1 rather
than edited now.

**Deferred / open, explicitly not swallowed:**
- Panel findings still unruled from the 2026-11-04 review: **11-04 C-2** (blocks ADJ-7c), and that
  report's own conflict items **11-04 X-1** (`question()` ban scope), **11-04 X-2** (whether the
  100 000-char "active" premise can be sustained — it may reopen ADJ-7b), **11-04 X-3** (severity
  of the skills-path evidence label), plus its 7 MEDIUM and 3 LOW rows.
- Measurements owed before their phases: P0-a `.qoder/rules` pilot (frontmatter spelling,
  recursion, the meaning of "active" in the 100 000-char rule budget); P0-b `.qoder/agents`
  sub-agent capability probe (three data points now that this host exposes no team API); P0-c
  vitest/e2e baseline recount (**measured 2026-11-05, closes T8** — see the L1 row and E9/E10).
- **Unverified / future-measured**: `ghcr.io` and Keycloak image pull reachability; vitest
  per-area threshold support; `workspace:*` dependency declarations before S3; the L3b rows
  labelled `[doc-claim]` (Portal separation, FGA, LDAP sync, Tencent SMS, SAML IdP side,
  metadata ingestion, the batch-B in-process permission cache).
- Governance Batch 7 remainder: ADJ-7b/7j (pilot-gated), ADJ-7c (ruled, unimplemented, blocked
  on 11-04 C-2).
- D122 obligation (1) — the mirror run reference — closed only by S0.
- Batch 6 of the governance plan remains deferred by decision (book index / llms.txt /
  spec-trace).

### Same-day self-review of this document (2026-11-05)

The plan was audited by its own panel protocol immediately after being written —
`docs/superpowers/reports/2026-11-05-longterm-plan-panel-review.md` (sequential track, 3 roles:
correctness officer, evidence officer, `doc-audit` lens).

Verdict: **not clean** — 3 CRITICAL / 3 HIGH / 5 MEDIUM / 3 LOW. Two categories of outcome:

- **Fixed in place without a ruling** (they were my own errors, not decisions): the false
  "0 consumers anywhere" claim (E1 → per-package E3 + new E3b), the citation of a red/green demo
  that cannot exist yet (P1), the stale `@deprecated` row (E3), the hand-written panel item count
  (E2, removed per R2-D), missing `asOf` on artifact-derived figures (E5), the alerting tier
  mis-assignment recorded as pending (P3), ADJ-7c appearing both as a hard block and as S2 scope
  (P4), the `workspace:*` pre-flight hung on the wrong phase (D2), the un-indexed document (D1),
  the two-H1 note (P5), prefix collisions (D3), carrier undercount (D4), and the §6 criterion-1
  gap (E4 → new row T11). Two new binding rules were added to §0 as a result.
- **Escalated, not fixed** (they touch rulings the user owns): **X-1** reopens R4-C's migration
  half; **X-2** asks whether a phantom dependency counts as a consumer; **X-3** disputes the
  severity of a document violating the evidence-class rule it introduces.

While executing 11-05 X-3 (=C, self-application of the R2-D lint principle) further
self-violations surfaced, all in this document, all fixed: a raw pipe inside the T7 table cell (the
exact defect ADJ-7a fixes in the generated digest), a four-column separator row over a
three-column header in §4, and a batch of `[measured]` tags with no anchor plus a set of
hand-written figures — of which only the
rows load-bearing for a deletion or a phase were spot-anchored, because the complete pass is the
S1 lint's job, not another round of hand-written scripts. The audit-trail point matters more than
the fixes: the throwaway verification scripts written during this audit were **each wrong in a
different way** — over-broad scan roots (the `helmet`/`helm` false positives); a directory-level
`.d.ts` heuristic whose verdict table had to be withdrawn; a path-splitting bug that mislabelled 16
dependency rows; and an anchor-counting regex that reported 28 undated references while also
counting the dated ones — which is precisely why the eventual lint must ship with `--self-test`
fixtures and why "the tool said so" is not an evidence class.

On the counting of these episodes: any tally of them — including the word "seven" used in the
round-1 report — is itself a **run-time quantity** under §0's rule, because executing a fix changes
the total. The enumerated list above is the authoritative form; the numbers are removed rather than
updated, which is precisely the disposition R2-X1=C prescribes.

Why this matters more than the individual rows: the failure mode this plan was written to remove —
a claim that looks authoritative and is stale — recurred **inside the plan itself, on the day it
was written, three times**. The corrective response is not "be careful"; it is the two §0 rules
plus the S1 format/recency lint, which are now the plan's own first acceptance target.

---

## S1 execution log (started 2026-11-05)

**First cut: the L1 ledger was re-verified before any module document was edited — and it failed
re-verification.** Applying §0's two-type rule to my own table:

- **T2 withdrawn** (`audit-sdd.md`): the header line carries its own `SUPERSEDED by the R-audit
  batch (2026-09-28)` correction naming the chain migration, the four new columns, both new tables
  and the verify endpoint. My claim came from `grep -m1` hitting the first half of a single very
  long line — one evidence type, and the weakest kind.
- **T3 withdrawn/narrowed** (`database.md`): the header already separates retention (consumed
  since Q2a) from archival (not). I had read the existence of an `archiveAfterDays` value as "the
  feature landed".
- **T6 downgraded** to wording: two types are needed to say whether `permission.ts:36`'s "non-goal"
  means the shipped `data-scope` engine or a different spec; today it has one.
- **T12 reclassified** from contradiction to precision-of-wording, on 3 types — and it *hardens*
  11-05 P3-A rather than reopening it.
- **T4 strengthened** (2 types): sanctioned RTBF erasure is wired into user deletion at
  `routes/users.ts:683-749`, so "user delete hard-cascades" is genuinely stale.
- **T5 split** into history (closed, 2 types) and expiry (open) — the §3 row that bundled two
  items in different states.
- **T13 added**: `doc-audit`'s own scope list points at 12 non-existent paths of 16 and asserts 11
  TDD docs where the glob returns 0; until S1 fixes it, any `/doc-audit` run yields fabricated gaps.

Consequence for the plan's execution: **no module status header was edited in this cut.** The five
headers originally targeted would have been rewritten on evidence that did not survive a second
look, which is precisely the failure this whole exercise is meant to prevent. The first cut is
therefore re-scoped: T1/T4/T5/T13 are the rows with two types today, and only those may drive edits.

**Second cut (same day).** T1 and T4 executed: `docs/modules/integration.md` and
`docs/modules/compliance.md` status headers rewritten into §0's shape (`as of <date>, evidence:
<file:line>`), each keeping the 2026-09-23 verdict as an explicit superseded line rather than
deleting it. T4's portability question deliberately stayed open inside the new header — the
evidence supports "exports and sanctioned erasure exist", not "portability is discharged".
**T13 was not executed**: `.agents/skills/doc-audit/SKILL.md` was last written at 09:25 and
committed at 09:26 by the concurrent session, so it is that session's active area — editing it now
would risk overwriting in-flight work. It stays registered, and no `/doc-audit` run should be
trusted until it is repaired.

**Third cut (same day) — evidence completion, one more withdrawal.** Reading enclosing context to
supply second evidence types produced: **T6 withdrawn** (the `permission.ts` "scope engine" phrase
belongs to the API-key bypass comment, not to `data-scope` — a third fragment-out-of-context error,
since generalised into a §0 rule); **T9 and T11 upgraded to two types each** and therefore genuinely
fixable — but both target `AGENTS.md`, last written 09:23 by the concurrent session's ADJ-7h, so
they are deferred on the same hot-zone rule used for T13 rather than edited here.

Ledger state after three cuts: executed T1/T4/T5; withdrawn on re-reading T2/T3/T6; reclassified
T12; evidence-complete but deferred to a hot file T9/T11/T13; T7 since executed by the fourth cut
below, leaving T8 unverified; T10 closed as documentation. The count of edits made is small; the
count of claims that did not survive their own verification rule is the more useful number, and it
is three.

**Fourth cut (same day).** T7 executed: `CHANGELOG.md` gained six wave-level entries covering the
50 commits after 2026-10-12 (`03dfb3e`) — Q3D completion, the gap-remediation wave, hygiene batch
v2, governance batches 1-8 with the MCP dependency incident, and this session's roadmap plus its
two panel reviews. Grouped by wave, not by commit, so the file stays readable. Two entries were
missed on the first pass and added on check (the flow-token cross-node live-fire runbook, and the
ModuKit D19 ledger-format reference), as was one misspelling; the commit count in the message was
corrected from an estimated 53 to the measured 50 — the same habit §0 exists to enforce.

**Fifth through ninth cuts (same day) — three cold-zone headers, one product ruling, one recount.**
Recorded in one entry because each of the cuts themselves left only its table row and commit
message. T14/T15/T16 rewrote three cold-zone status headers: core-packages wiring is **4 of 8**,
not 6; cicd defines **8 jobs**, not 7, with the never-observed-CI caveat kept; testing's ratchet
floors are 46/71/70/46 against "46-77", and the 80 % target holds only for branches and functions.
T17 rose to a product ruling: **R11=A** — the phantom `@accessbase/react` family is design intent,
signal-gated, re-marked future-tense in `integration.md` §15.3-§15.5 and `branding.md` §16.5,
nothing deleted, nothing scheduled. T18 corrected the `api.md` header to "versioning documented,
**deprecation** policy absent" on the artifact-self boundary (104 paths / 3 outside `/api/v1`,
re-measured same day). **T8, this cut, measured what the ledger had only quoted**: vitest
1588/1588 (143 files) with 12 uncaught PG-57P01 teardown cross-kill errors — local exit non-zero,
while the CI Test job has no `services:` block and is therefore green-by-skip — and e2e 9 failed
through the real entry the wrapper had been hiding (new **E9**: silent fake success; new **E10**:
attribution open). `status.md` is the concurrent session's active file (written 09:28 today), so
its corrected numbers live in the T8 row; the claim itself narrowed — 491/107 is a 09-12 history
line mistaken for the live header — the fourth member of the T2-family. Governance P0-c closes
with the same measurement.

**Tenth cut (same day) — the hot zone cooled, so T9/T11/T13 landed.** AGENTS.md and the doc-audit
skill had stood still since 09:22-09:26; both were re-measured on disk before editing. T9: the
"re-encrypt tool" carryover left AGENTS.md's ladder (the OVERVIEW historical mention stays — it
records what shipped, not what is owed). T11: both STRUCTURE counts removed, not recounted — the
disk held **15** skill dirs against the claimed 13 (the digest table itself omits two skills),
which is exactly the rot the removal prevents. T13 was the big one: the doc-audit skill was a
wholesale port from the defunct plugin-platform era — 13 of its referenced paths MISSING
(re-measured same day), an asserted "11 SDD / 11 TDD docs" against a measured **8 / 0**, a
declared absence of packages/ and CI against 8 packages and 8 CI jobs, `@audebase/` scopes and
manifest-engine modules that do not exist. Rebuilt on the real doc surface; the gap dimension now
points at the authoritative ledgers instead of carrying its own rotting list; the
`team_create`/`oracle` sample kept with a host-capability note. The L1 ledger is now fully
dispositioned.

**Same-evening D122 observation (not a cut).** The mirror check S0 owed: all queued commits had
reached Gitee origin (pushed outside this session), and the mirror proved alive — run #29 =
`6d1e0a2` fired minutes after the push. The finding is worse than "no green run observed": every
run since #17 carries one annotation — `Invalid workflow file … 'NO_PROXY' is already defined` —
because `ci.yml:112-113` duplicates an env key case-insensitively; the pair predates D122 itself
(`646f561`, 09-20). Registered as **E11**; T15's unobserved-CI caveat retired; E7 superseded. The
one-line fix awaits user sanction (CI config change), and its lesson (no local workflow-schema
gate; red runs went unread for 46 days) is a PIT candidate.

**Eleventh + twelfth cuts (same evening) — the panel-gated close-out wave opened.** Per the user's
flow instruction (draft plan -> panel -> revise -> re-review -> execute), the S0+S1 close-out plan
was drafted with measured inputs, reviewed in two sequential 3-role rounds, and both conflict items
ruled (X-1=A strict rides `agents check`; X-2=C first-batch-then-continuous). Round 1 caught the
plan locking its own repo (pre-commit IS the agents check chain) and an exit criterion that would
force date-painting; round 2 caught the same hole reopened at the parser level (44/44 headers carry
dates, only 7 use the `as of` spelling). Plan + reports landed as W0; W1 removed the duplicate
`no_proxy` key from ci.yml — authoritative acceptance is W2's run graph, which needs the push word.

**Thirteenth cut (same evening) — W2 executed the gate the user opened with the push word.** The
push landed (`124bf8a` on origin); run #31 is the **first executed CI run in repo history** — the
8-node job graph renders, so E11's acceptance criterion (job nodes, not file rejection) is met and
E11 closes. The run is still red overall in 18 s, at config level in two clusters: E12 (pnpm
double-version kills 6 jobs at setup before any command runs — one-line fix, sanction-gated) and
E13 (migration-chain service container exit 125, cause left open honestly — logs need sign-in).
D122 consequence (1) stays UNMET until a green run; per ruled D-a nothing was fixed inside the
observation — repair options went to the user the same evening.

**Fourteenth cut (2026-11-06, W2.x route A sanctioned).** E12 + E13 fixed in one CI-config commit:
the double pnpm version declaration removed everywhere (7 `with:` blocks + the global env — the
initial "6" was a truncated grep, corrected against the file before committing; single source is
now `packageManager`), and the health-cmd quoted after LOCAL CONFIRMATION — the Actions arg order
reproduced exit 125 exactly, the quoted form produced exit 0; an earlier repro attempt with the
image in the wrong position proved nothing and was caught before writing the row (first
observation-vs-assertion miss of this class — the memory line's "疑似" is now fact). Acceptance
for both rows moves to "next run clears setup + service starts": needs the push word; a green
run closes D122 consequence (1) and S0.

**Fifteenth cut (2026-11-06, W3).** `scripts/agents/header-lint.mts` landed as the FIFTH lint in
the agent-links aggregate (import + runLayers + LINTS + targets-comment, 4→5): E1 missing status
line / E2 no parseable ISO date ANY spelling (the R2-C1 regression fixture is in the self-test),
W1 staleness >45 d and W2 as-of-without-evidence as warns only, exemptions derived at run time
from header text (D-d). REPORT mode per the C-1 two-stage rule — aggregate never blocks; the
strict flip ships with W4's exit commit (X-1=A wiring, R2-C3 same-commit rule). Self-test: 8
synthetic fixtures with RELATIVE dates (test set cannot rot), PASS. Red/green demo on a planted
real file: strict RED exit=1 → remove → GREEN exit=0 — measured honestly only on the third
attempt: the first two grabbed the exit code of `tail` after a pipe, not node (the `$?`-after-pipe
trap — detector-self-check material for PIT-090). Live tree: 0 error / 0 warn over 44 files;
noted honestly: the 09-23 legacy dates sit at 44 days, one day inside the 45-day window — W4's
driver is the plan's triage list, NOT lint warnings; the window is a heuristic, not the trigger.
Also honestly recorded: an earlier WebFetch pulled run #31's page while chasing #32 (SHA-based
reference lesson P-2 working as intended — the in-flight row stays open until the right run is
read).

**Sixteenth cut (2026-11-06, W4 first batch under X-2=C).** Triage table landed
(docs/superpowers/reports/2026-11-06-header-triage.md) with measured last-touch; five-header
batch executed: monitoring + secret-mgmt REWRITTEN on ledger anchors (3-type / 2-type, inline
provenance lines), database + audit-sdd + messaging **KEPT-HONEST-STALE** — and the batch
earned its keep immediately: the whole-line-read rule caught a TRIAGE ANCHOR ERROR (messaging
had been classified REWRITTEN against T1, but T1 is webhooks/events = webhook.md territory;
messaging's own 09-28 update text already reads correctly). 2 rewrites, 3 kept, 1 self-caught
misclassification — the standard and the anti-date-painting gate are both proven. X-2=C
sequence: user eyeballs THIS batch's product; remaining batches run on approval-by-artifact.
Process note per the user's meta-question the same morning: no further plan docs or panel
rounds inside this approved plan — panel gates are for real decision branches (skill's own
table), and pre-asking what X-2=C already decided (confirm-by-product, not by pre-question)
was itself corrected mid-flight.

---

## Historical plan — v3.0 (dated 2026-08-21), SUPERSEDED

> Retained in place per R9, option ①. It predates both the D121 English-only persistence policy
> (2026-09-21) and Phase 9, and its own header ("waiting to start implementation") is what
> triggered the truth-layer audit — read it as history, not as backlog. Its Phase 0–4 structure
> survives above as the section skeleton. Not back-translated (same convention as
> `.agents/rules/zh/`). Note: this section keeps its original top-level heading, so the file
> intentionally contains two H1s — demoting it would edit preserved historical text (review P5,
> accepted with this note).

# AccessBase 实施计划

> **状态**: 设计定稿完成（v3.0），**已被上方长期计划取代（SUPERSEDED，2026-11-05）**
> **更新日期**: 2026-08-21
> **预计工期**: 14 周（3.5 个月）
> **最小可用版本**: v0.1.0（含 identity + admin + audit 基础能力）

---

## 1. 项目总览

### 1.1 项目目标

AccessBase 是面向"任何需要后台管理与安全治理的平台"的可复用基石层（L0），提供认证、授权、审计、日志、迁移、国际化、主题机制、基础 CRUD 八项能力。

核心交付目标：

- 8 个 L0 包通过 `@accessbase/*` npm scope 独立发布
- 任何平台（MediaServo、MES、企业应用平台等）可直接依赖，无需 L1/L2 层
- 认证+授权+审计作为安全底座，覆盖 OWASP 基础要求
- 后台管理框架开箱即用，支持品牌注入和主题定制

### 1.2 技术栈确认

| 层级 | 组件      | 选择                    | 版本要求 |
| ---- | --------- | ----------------------- | -------- |
| 后端 | Web 框架  | Fastify                 | ≥5.0     |
| 后端 | ORM       | Drizzle ORM             | ≥0.35    |
| 后端 | 数据库    | PostgreSQL              | 16       |
| 后端 | 缓存      | Redis                   | ≥7.0     |
| 前端 | 框架      | React                   | ≥19.0    |
| 前端 | UI 组件库 | Ant Design              | ≥5.0     |
| 前端 | 构建工具  | Vite                    | ≥6.0     |
| 前端 | 状态管理  | Zustand                 | ≥5.0     |
| 前端 | 路由      | React Router            | ≥7.0     |
| 基础 | 包管理    | pnpm (workspace)        | ≥9.0     |
| 基础 | 语言      | TypeScript (strict)     | ≥5.6     |
| 基础 | 测试      | Vitest + Playwright     | 最新     |
| 后端 | 日志      | pino                    | ≥9.0     |
| 前端 | 国际化    | i18next + react-i18next | 最新     |
| 后端 | 认证      | jsonwebtoken (RS256)    | 最新     |
| 后端 | 密码      | bcrypt                  | 最新     |

### 1.3 设计文档索引

| 类别          | 文档                             | 内容                          |
| ------------- | -------------------------------- | ----------------------------- |
| 架构概述      | `docs/modules/overview.md`       | §1-§7 需求/定义/架构/迁移映射 |
| 技术选型      | `docs/modules/tech-stack.md`     | §9 后端+前端技术栈            |
| 核心包设计    | `docs/modules/core-packages.md`  | §10 八个 L0 包详细设计        |
| 数据库 Schema | `docs/modules/database.md`       | §22 核心表结构                |
| API 规范      | `docs/modules/api.md`            | §23 RESTful 约定              |
| UI 设计       | `docs/modules/ui.md`             | §14+§37 布局/导航/组件/页面   |
| 安全设计      | `docs/modules/security.md`       | §19+§25+§29+§36 安全全量      |
| 测试策略      | `docs/modules/testing.md`        | §30 测试框架与覆盖要求        |
| CI/CD         | `docs/modules/cicd.md`           | §31 持续集成与部署            |
| 认证架构      | `docs/modules/auth-provider.md`  | §12 OAuth/WebAuthn/LDAP/OIDC  |
| 监控告警      | `docs/modules/monitoring.md`     | §13 APM/指标/告警             |
| 分布式        | `docs/modules/distributed.md`    | §11 集群/消息/一致性          |
| 错误处理      | `docs/modules/error-handling.md` | §20 统一错误码体系            |
| 秘钥管理      | `docs/modules/secret-mgmt.md`    | §28 密钥管理方案              |
| 国际化        | `docs/modules/i18n.md`           | §35 i18n 架构                 |
| 设计决策      | `.agents/memorys/decisions.md`   | D1-D95 共 95 项决策及理由     |

**SDD（软件设计文档）**:

| 包名                       | SDD 路径                                  |
| -------------------------- | ----------------------------------------- |
| `@accessbase/identity`     | `docs/modules/identity-sdd.md`（1171 行） |
| `@accessbase/admin`        | `docs/modules/admin-sdd.md`（1126 行）    |
| `@accessbase/audit`        | `docs/modules/audit-sdd.md`               |
| `@accessbase/logging`      | `docs/modules/logging-sdd.md`             |
| `@accessbase/i18n`         | `docs/modules/i18n-sdd.md`                |
| `@accessbase/migration`    | `docs/modules/migration-sdd.md`           |
| `@accessbase/health-check` | `docs/modules/health-check-sdd.md`        |
| `@accessbase/shared-types` | `docs/modules/shared-types-sdd.md`        |

---

## 2. 实施阶段划分

### Phase 0: 基础设施搭建（Week 1-2）

目标：建立可立即开始编码的开发环境。

#### 2.0.1 Monorepo 初始化

**产出**: 可用的 pnpm workspace 项目骨架

| 任务                       | 说明                                                                               | 验收标准                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 创建根 `package.json`      | `name: "accessbase-monorepo"`, `private: true`, 声明 `pnpm-workspace.yaml`         | `pnpm install` 成功，无报错                                                                          |
| 创建 `pnpm-workspace.yaml` | 声明 `packages: ["packages/*"]`                                                    | `pnpm ls --depth 0` 列出所有 workspace 项目                                                          |
| 创建 8 个包目录            | `packages/{shared-types,logging,i18n,migration,identity,audit,health-check,admin}` | 每个包有独立 `package.json`（含 `name: "@accessbase/xxx"`, `version: "0.1.0"`, `main`/`types` 字段） |
| 配置 `tsconfig.json`       | 根 tsconfig（strict mode）+ 每包 tsconfig 引用根配置                               | `tsc --noEmit` 全量通过                                                                              |
| 配置 npm scope             | 所有包 `publishConfig.access: "public"`，scope `@accessbase`                       | `pnpm publish --dry-run` 每个包可发布                                                                |

**目录结构**:

```
packages/
├── shared-types/    → src/index.ts (类型导出)
├── logging/         → src/index.ts (pino 封装)
├── i18n/            → src/index.ts (i18next 封装)
├── migration/       → src/index.ts (Drizzle 迁移)
├── identity/        → src/{auth,user,role,permission,session,mfa}.ts
├── audit/           → src/index.ts (审计钩子)
├── health-check/    → src/index.ts (健康检查)
└── admin/           → src/{components,hooks,stores,theme}.tsx
```

#### 2.0.2 开发环境配置

**产出**: `docker-compose.yml` 可一键启动开发环境

| 任务               | 说明                                                                      | 验收标准                                        |
| ------------------ | ------------------------------------------------------------------------- | ----------------------------------------------- |
| PostgreSQL 16 容器 | 端口映射 5432，持久化 volume，`listen_addresses='*'`                      | `psql -h localhost -p 5432 -U postgres` 可连接  |
| Redis 容器         | 端口映射 6379，AOF 持久化                                                 | `redis-cli -h localhost -p 6379 ping` 返回 PONG |
| 开发数据库初始化   | 创建 `accessbase_dev` 数据库和 `accessbase_test` 数据库                   | 两个库均存在且可连接                            |
| 环境变量模板       | `.env.example` 列出所有必需变量（DATABASE_URL, REDIS_URL, JWT_SECRET 等） | `cp .env.example .env` 后开发环境可运行         |

#### 2.0.3 CI/CD 基础

**产出**: GitHub Actions 工作流可触发

| 任务                  | 说明                                    | 验收标准                                     |
| --------------------- | --------------------------------------- | -------------------------------------------- |
| TypeScript 检查工作流 | `pnpm install` → `tsc --noEmit`（全包） | push 到 main/PR 时自动运行，类型错误阻塞合并 |
| 测试工作流            | Vitest 单元测试 + 覆盖率报告            | push 时自动运行，覆盖率 < 80% 标记警告       |
| Lint 工作流           | ESLint + Prettier 检查                  | 格式/规范错误阻塞合并                        |
| Docker 构建验证       | `docker build` 可成功构建生产镜像       | 镜像 < 200MB，可启动并响应 health check      |

#### 2.0.4 代码规范工具

**产出**: 统一的代码风格和规范

| 任务          | 说明                                                                                        | 验收标准                                        |
| ------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| ESLint 配置   | `eslint.config.ts`（flat config）：TypeScript + React + Import 规则                         | `eslint packages/` 无报错                       |
| Prettier 配置 | `.prettierrc`：单引号、分号、2 空格缩进、尾逗号 always                                      | `prettier --check packages/` 通过               |
| EditorConfig  | `.editorconfig`：UTF-8、LF 换行、缩进规则                                                   | 所有编辑器使用统一配置                          |
| Git Hooks     | `husky` + `lint-staged`：commit 前自动 `tsc --noEmit` + `eslint --fix` + `prettier --write` | `git commit` 触发 pre-commit 检查               |
| 包特定规则    | 每个 L0 包的 `tsconfig.json` 引用根配置，strict 模式                                        | 禁止 `as any`、`@ts-ignore`、`@ts-expect-error` |

#### 2.0.5 测试框架搭建

**产出**: 测试基础设施可运行

| 任务            | 说明                                                         | 验收标准                                           |
| --------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| Vitest 配置     | 根 `vitest.config.ts`，每个包 `src/**/*.test.ts` 覆盖        | `pnpm vitest run` 可执行（当前无测试，0 结果通过） |
| Playwright 配置 | `playwright.config.ts`：chromium、超时设置、baseURL          | `npx playwright install chromium` 成功             |
| 测试数据库      | `accessbase_test` 独立库，每次测试前 `drizzle-kit push` 重置 | 测试隔离，不干扰开发数据                           |
| 覆盖率配置      | `vitest` coverage provider（v8），最低 80%                   | `vitest --coverage` 生成报告                       |

---

### Phase 1: 核心包实施（Week 3-8）

按依赖顺序实施 8 个 L0 包。每个包遵循 TDD 流程：先写测试，再实现，再重构。每包完成时 `tsc --noEmit` 通过 + 单元测试 ≥ 80% 覆盖。

#### 2.1.1 `@accessbase/shared-types`（Week 3）

**依赖**: 无（最底层，其他所有包依赖）

**职责**: 跨包共享的类型定义、枚举、常量。

| 任务              | 文件                 | 说明                                                              |
| ----------------- | -------------------- | ----------------------------------------------------------------- |
| 项目错误码定义    | `src/error-codes.ts` | 统一错误码枚举（AUTH_001, RBAC_001 等），参见 `error-handling.md` |
| API 通用类型      | `src/api.ts`         | `PaginationParams`, `ApiResponse<T>`, `PaginatedResponse<T>` 等   |
| 用户/角色模型类型 | `src/models.ts`      | `User`, `Role`, `Permission`, `Tenant` 接口（不含 ORM Schema）    |
| JWT 类型          | `src/auth.ts`        | `JwtPayload`, `AccessToken`, `RefreshToken` 类型                  |
| 审计日志类型      | `src/audit.ts`       | `AuditLog`, `AuditAction` 等类型                                  |
| 类型导出          | `src/index.ts`       | 统一导出所有类型                                                  |

**测试**: 类型导出检查（`tsc --noEmit` 覆盖类型正确性，无运行时行为）

**交付物**: `@accessbase/shared-types@0.1.0`，零运行时依赖

#### 2.1.2 `@accessbase/logging`（Week 3）

**依赖**: 无

**职责**: 基于 pino 的结构化日志封装，包括敏感字段脱敏和请求追踪。

| 任务         | 文件                           | 说明                                                                                             |
| ------------ | ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Logger 工厂  | `src/logger.ts`                | `createLogger(options)`: pino 实例创建，环境感知（dev 用 pino-pretty，prod 用 JSON）             |
| 脱敏配置     | `src/redaction.ts`             | 预定义脱敏路径：`req.headers.authorization`, `req.headers.cookie`, `password`, `token`, `secret` |
| Fastify 插件 | `src/fastify-plugin.ts`        | 注册 X-Request-ID hook（`onRequest`），挂载 logger 到 `request.log`                              |
| 日志级别管理 | `src/levels.ts`                | 运行时日志级别切换 API                                                                           |
| 单元测试     | `src/__tests__/logger.test.ts` | 验证：创建实例、环境切换、脱敏生效、requestId 注入                                               |

**交付物**: `@accessbase/logging@0.1.0`，依赖 `pino` + `pino-pretty`

#### 2.1.3 `@accessbase/i18n`（Week 3-4）

**依赖**: 无

**职责**: 双命名空间国际化（包名命名空间 + client 命名空间），语言检测，翻译加载。

| 任务         | 文件                         | 说明                                                                             |
| ------------ | ---------------------------- | -------------------------------------------------------------------------------- |
| I18nEngine   | `src/engine.ts`              | i18next 初始化、命名空间注册、语言切换 API                                       |
| 双命名空间   | `src/namespaces.ts`          | 包名命名空间（identity/admin/audit/...）+ client 命名空间，优先级：client > 包名 |
| 语言检测     | `src/detector.ts`            | 检测顺序：URL 路径 → Cookie → Accept-Language → 默认 zh-CN                       |
| 语言包骨架   | `src/locales/{zh,en}/`       | 基础翻译文件（common 通用键）                                                    |
| Fastify 插件 | `src/fastify-plugin.ts`      | 从 Accept-Language 头初始化服务端 i18n                                           |
| React Hook   | `src/react-provider.tsx`     | `<I18nProvider>` 组件 + `useTranslation()` hook 导出                             |
| 单元测试     | `src/__tests__/i18n.test.ts` | 验证：命名空间优先级、语言检测、切换、fallback                                   |

**交付物**: `@accessbase/i18n@0.1.0`，依赖 `i18next` + `react-i18next`

#### 2.1.4 `@accessbase/migration`（Week 4）

**依赖**: 无

**职责**: 基于 Drizzle ORM 的三阶段数据库迁移（preload → postsync → postload）。

| 任务         | 文件                              | 说明                                                                      |
| ------------ | --------------------------------- | ------------------------------------------------------------------------- |
| 迁移 Runner  | `src/runner.ts`                   | 扫描迁移文件、SemVer 排序、按阶段执行（preload → Schema sync → postload） |
| 迁移锁       | `src/lock.ts`                     | 数据库 advisory lock，防止并发迁移执行                                    |
| 迁移状态     | `src/status.ts`                   | 记录已执行迁移版本到 `_migrations` 表                                     |
| CLI 命令     | `src/cli.ts`                      | `up`/`down`/`status`/`generate` 命令入口                                  |
| 三阶段执行器 | `src/phases.ts`                   | preload（Schema 前）/ postsync（Schema 后，默认）/ postload（数据后）     |
| 单元测试     | `src/__tests__/migration.test.ts` | 验证：SemVer 排序、阶段分组、锁机制、状态记录                             |

**交付物**: `@accessbase/migration@0.1.0`，依赖 `drizzle-orm` + `drizzle-kit`

#### 2.1.5 `@accessbase/identity`（Week 4-6）

**依赖**: `shared-types`（类型）、`logging`（日志，可选）、`i18n`（错误消息国际化，可选）

**职责**: 认证（Authentication）+ 授权（Authorization）核心能力。这是最复杂、最核心的包。

**数据模型**（Drizzle Schema）:

| 表名               | 说明          | 核心字段                                                                                            |
| ------------------ | ------------- | --------------------------------------------------------------------------------------------------- |
| `users`            | 用户          | id, username, email, password_hash, display_name, avatar, status, tenant_id, created_at, updated_at |
| `roles`            | 角色          | id, name, description, is_system, tenant_id                                                         |
| `permissions`      | 权限          | id, code, description, module, resource, action                                                     |
| `user_roles`       | 用户-角色关联 | user_id, role_id                                                                                    |
| `role_permissions` | 角色-权限关联 | role_id, permission_id                                                                              |
| `tenants`          | 租户          | id, name, status, config                                                                            |
| `refresh_tokens`   | Refresh Token | id, user_id, token_hash, expires_at, revoked                                                        |
| `login_attempts`   | 登录尝试记录  | id, username, ip, success, timestamp（限流和安全审计用）                                            |

**模块拆分与任务**:

| 模块              | 文件                        | 说明                                                              | 预估   |
| ----------------- | --------------------------- | ----------------------------------------------------------------- | ------ |
| 数据模型          | `src/schema.ts`             | Drizzle 表定义（8 张表）                                          | 1 天   |
| AuthService       | `src/auth/service.ts`       | 登录、登出、注册、密码重置、Token 签发/验证                       | 3 天   |
| JWT 工具          | `src/auth/jwt.ts`           | RS256 签发/验证、密钥管理、Access Token + Refresh Token           | 2 天   |
| 密码工具          | `src/auth/password.ts`      | bcrypt 哈希/验证、密码策略（最小长度、复杂度）                    | 0.5 天 |
| LDAP Provider     | `src/auth/ldap.ts`          | Admin Bind 模式、属性映射、自动用户供给、AES-256-GCM 加密连接密码 | 2 天   |
| SessionManager    | `src/session/service.ts`    | Redis Token 缓存、token_version 数据库追踪、Refresh Token 轮转    | 2 天   |
| UserManager       | `src/user/service.ts`       | 用户 CRUD、租户过滤、状态管理、密码变更                           | 2 天   |
| RoleManager       | `src/role/service.ts`       | 角色 CRUD、RBAC1 继承链解析、租户级角色                           | 1.5 天 |
| PermissionManager | `src/permission/service.ts` | 权限 CRUD、角色-权限关联、权限缓存（Redis）                       | 1 天   |
| ACLGuard          | `src/auth/acl.ts`           | RBAC 权限检查（角色继承展开 + 权限匹配）、Fastify preHandler 插件 | 1.5 天 |
| MfaManager        | `src/mfa/service.ts`        | TOTP 生成/验证、可信设备机制                                      | 1.5 天 |
| Fastify 插件      | `src/fastify-plugin.ts`     | 注册路由、中间件链、preAuth/postAuth hooks                        | 2 天   |

**关键接口**:

```typescript
// AuthService
interface AuthService {
  login(credentials: LoginCredentials, tenantId: string): Promise<AuthResult>;
  logout(refreshToken: string): Promise<void>;
  register(data: RegisterData, tenantId: string): Promise<User>;
  refreshAccessToken(refreshToken: string): Promise<TokenPair>;
  resetPassword(userId: string, newPassword: string): Promise<void>;
}

// PermissionEngine
interface PermissionEngine {
  check(userId: string, permission: string, tenantId: string): Promise<boolean>;
  getRoles(userId: string, tenantId: string): Promise<Role[]>;
  getPermissions(roleIds: string[]): Promise<Permission[]>;
  invalidateUserCache(userId: string): Promise<void>;
}

// ACLGuard（Fastify preHandler）
function aclGuard(...permissions: string[]): FastifyPreHandler;
```

**测试**:

- AuthService: 登录成功/失败、Token 签发/过期、Refresh Token 轮转
- LDAP: Mock LDAP 服务器测试认证流
- ACLGuard: 角色继承、权限匹配、跨租户隔离
- MFA: TOTP 生成/验证、可信设备标记
- SessionManager: Token 缓存、版本失效、并发刷新

**交付物**: `@accessbase/identity@0.1.0`，最核心包，需最仔细的代码审查

#### 2.1.6 `@accessbase/audit`（Week 6-7）

**依赖**: `identity`（用户关联）、`logging`（日志写入）

**职责**: API 写操作自动审计、审计查询接口、审计管理页。

| 任务         | 文件                          | 说明                                                                                                              |
| ------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 审计数据模型 | `src/schema.ts`               | `audit_logs` 表（userId, action, resourceType, resourceId, requestBody, timestamp, tenantId, requestId, success） |
| AuditService | `src/service.ts`              | `log()`, `query()`, `export()` 方法                                                                               |
| 脱敏处理     | `src/sanitize.ts`             | 审计记录中 password、token、secret 等字段自动脱敏                                                                 |
| Fastify 插件 | `src/fastify-plugin.ts`       | `onResponse` hook：POST/PUT/PATCH/DELETE 请求自动记录                                                             |
| 审计查询 API | `src/routes.ts`               | GET /audit-logs（分页、时间范围、用户、操作类型筛选）                                                             |
| 单元测试     | `src/__tests__/audit.test.ts` | 验证：自动记录、脱敏生效、查询过滤、导出                                                                          |

**交付物**: `@accessbase/audit@0.1.0`

#### 2.1.7 `@accessbase/health-check`（Week 7）

**依赖**: `logging`（健康检查日志）

**职责**: 服务健康检查端点，检查数据库、Redis 等依赖连通性。

| 任务          | 文件                           | 说明                                                                                 |
| ------------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| HealthChecker | `src/checker.ts`               | 注册检查项（DB、Redis、自定义），汇总结果                                            |
| Fastify 插件  | `src/fastify-plugin.ts`        | GET /health（200/503）、GET /health/ready（readiness）、GET /health/live（liveness） |
| 检查实现      | `src/checks/`                  | `database.ts`（SELECT 1）、`redis.ts`（PING）                                        |
| 单元测试      | `src/__tests__/health.test.ts` | 验证：全健康返回 200、部分异常返回 503、liveness 始终 200                            |

**交付物**: `@accessbase/health-check@0.1.0`

#### 2.1.8 `@accessbase/admin`（Week 7-8）

**依赖**: `identity`（登录/用户管理）、`audit`（审计管理页）、`i18n`（多语言 UI）、`shared-types`

**职责**: 企业级后台管理框架外壳，含登录页、布局、主题、CRUD 框架、IAM 管理页面。

**模块拆分**:

| 模块        | 目录                                | 说明                                                                                         |
| ----------- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| 布局组件    | `src/components/layout/`            | ProLayout 外壳（侧边栏 + 顶部导航 + 面包屑 + 用户头像）                                      |
| 主题系统    | `src/theme/`                        | ThemeProvider、ThemeContext、亮暗切换、持久化到 localStorage                                 |
| BrandTokens | `src/theme/tokens.ts`               | BrandTokens 接口（primaryColor, secondaryColor, logo, brandName, fontFamily）                |
| 登录页      | `src/pages/login/`                  | 登录表单、记住密码、OAuth/SSO 入口（按配置显示）                                             |
| 用户管理页  | `src/pages/users/`                  | ProTable 封装：用户列表（分页/搜索/筛选）、新建/编辑表单、批量操作                           |
| 角色管理页  | `src/pages/roles/`                  | 角色列表、权限树形选择、角色继承配置                                                         |
| 租户管理页  | `src/pages/tenants/`                | 租户列表、租户配置                                                                           |
| 审计日志页  | `src/pages/audit/`                  | 审计日志列表（时间线/表格切换）、导出                                                        |
| 状态管理    | `src/stores/`                       | Zustand stores: `authStore`（登录态）、`uiStore`（侧边栏折叠/主题）、`dataStore`（全局数据） |
| API 客户端  | `src/api/client.ts`                 | Axios 封装、自动 Token 刷新、请求/响应拦截、防重复提交                                       |
| 路由注册    | `src/routes.tsx`                    | React Router 配置、懒加载、权限守卫                                                          |
| 错误边界    | `src/components/error-boundary.tsx` | 全局错误捕获、降级 UI、错误上报                                                              |
| 前端权限    | `src/hooks/usePermission.ts`        | `usePermission(code)` hook，基于 ACLGuard 前端版                                             |
| 空状态      | `src/components/empty-state.tsx`    | 统一空状态组件                                                                               |

**关键组件接口**:

```typescript
// BrandTokens（L0 默认中性，由 L1/L2 注入覆盖）
interface BrandTokens {
  primaryColor: string; // 默认 '#1677ff'（AntD 默认蓝）
  secondaryColor: string; // 默认 '#f0f0f0'
  logo: string | ReactNode;
  logoCollapsed?: string | ReactNode;
  brandName: string; // 默认 'AccessBase'
  brandTagline?: string;
  fontFamily?: string;
}

// Admin 入口组件
interface AccessBaseAdminProps {
  brandTokens?: Partial<BrandTokens>;
  loginComponent?: React.ComponentType;
  routes?: RouteConfig[];
  beforeLogin?: (credentials: LoginCredentials) => Promise<void>;
  afterLogin?: (result: AuthResult) => Promise<void>;
}

// RouteConfig（页面注册）
interface RouteConfig {
  path: string;
  component: React.LazyExoticComponent<any>;
  label: string; // 菜单显示名（i18n key）
  icon?: string;
  permission?: string; // 所需权限码
  children?: RouteConfig[];
}
```

**测试**:

- 主题切换：亮暗模式切换、持久化、BrandTokens 注入
- 登录流程：表单验证、成功跳转、错误提示、SSO 入口
- CRUD 框架：ProTable 分页、筛选、新建/编辑表单弹窗
- 权限守卫：无权限页面跳转、菜单权限过滤
- 响应式：移动端侧边栏折叠、断点适配

**交付物**: `@accessbase/admin@0.1.0`，完整的后台管理框架外壳

---

### Phase 2: 集成与 API（Week 9-10）

目标：将 8 个 L0 包集成为可运行的后端服务和前端应用。

#### 2.2.1 Fastify 服务搭建

| 任务          | 文件                              | 说明                                                                     |
| ------------- | --------------------------------- | ------------------------------------------------------------------------ |
| 服务入口      | `packages/server/src/index.ts`    | Fastify 实例创建，加载所有插件                                           |
| 插件注册      | `packages/server/src/plugins.ts`  | 按顺序注册：logging → i18n → identity → audit → health-check → admin API |
| 配置管理      | `packages/server/src/config.ts`   | 环境变量读取 + 验证（zod schema），缺失时启动报错                        |
| 错误处理      | `packages/server/src/errors.ts`   | 统一错误响应格式，错误码映射到 HTTP 状态码                               |
| CORS/Security | `packages/server/src/security.ts` | CORS 配置、Helmet 头、Rate Limiting                                      |

#### 2.2.2 API 路由实现

| 模块     | 前缀                                       | 端点                                                             | 说明               |
| -------- | ------------------------------------------ | ---------------------------------------------------------------- | ------------------ |
| 认证     | `/api/v1/auth`                             | `POST /login`, `POST /logout`, `POST /refresh`, `POST /register` | 参见 `api.md`      |
| 用户     | `/api/v1/users`                            | `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`         | RBAC 保护          |
| 角色     | `/api/v1/roles`                            | `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`         | 含权限树           |
| 权限     | `/api/v1/permissions`                      | `GET /`, `POST /`                                                | RBAC 保护          |
| 租户     | `/api/v1/tenants`                          | `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`                     | 仅 superadmin      |
| 审计     | `/api/v1/audit-logs`                       | `GET /`                                                          | 仅读取，admin 角色 |
| 健康检查 | `/health`, `/health/ready`, `/health/live` | GET                                                              | 无认证             |
| MFA      | `/api/v1/mfa`                              | `POST /setup`, `POST /verify`, `POST /disable`                   | 需认证             |

**API 响应格式**（统一）:

```typescript
// 成功
{ success: true, data: T }

// 分页
{ success: true, data: { items: T[], total: number, page: number, limit: number } }

// 错误
{ success: false, error: { code: string, message: string, details?: object } }
```

#### 2.2.3 中间件链

请求处理顺序：

```
1. Helmet（安全头）
2. CORS（跨域）
3. Rate Limiting（限流）
4. Request ID 注入（logging）
5. i18n 初始化（Accept-Language）
6. JWT 验证（identity）
7. RBAC 权限检查（identity/ACLGuard）
8. 业务处理
9. 审计记录（audit onResponse hook）
```

#### 2.2.4 前端 Admin UI 搭建

| 任务            | 说明                                                           |
| --------------- | -------------------------------------------------------------- |
| Vite 项目初始化 | `packages/admin-ui/` 独立 Vite 项目，引用 `@accessbase/admin`  |
| 开发代理        | `vite.config.ts` 配置 proxy 到后端 `localhost:5101`            |
| 路由打通        | 登录页 → Dashboard → 用户管理 → 角色管理 → 租户管理 → 审计日志 |
| API 联调        | 前端 API 客户端对接后端路由                                    |
| 开发模式启动    | `pnpm dev` 同时启动后端（5101）+ 前端（5173）                  |

---

### Phase 3: 测试与优化（Week 11-12）

目标：达到质量标准，确保生产可用。

#### 2.3.1 单元测试

| 范围        | 要求                                                  |
| ----------- | ----------------------------------------------------- |
| 每个 L0 包  | ≥ 80% 代码覆盖率                                      |
| identity 包 | ≥ 90% 覆盖率（安全核心）                              |
| 测试模式    | AAA 模式（Arrange-Act-Assert）                        |
| 测试命名    | `returns X when Y` / `throws error when Z`            |
| Mock 策略   | 数据库用 in-memory 或测试 DB，外部服务（LDAP）用 Mock |

**重点测试场景**:

| 包        | 关键测试                                                                               |
| --------- | -------------------------------------------------------------------------------------- |
| identity  | 密码哈希/验证、JWT 签发/过期/轮转、RBAC 继承链解析、租户隔离、LDAP Mock 认证、MFA TOTP |
| audit     | 审计自动记录、脱敏正确性、查询过滤                                                     |
| admin     | 主题切换持久化、路由权限守卫、表单验证                                                 |
| migration | SemVer 排序、阶段分组、迁移锁、回滚                                                    |
| logging   | 脱敏字段验证、requestId 注入                                                           |

#### 2.3.2 集成测试

| 场景         | 说明                                                                           |
| ------------ | ------------------------------------------------------------------------------ |
| 完整登录流程 | 注册 → 登录 → 获取 Token → 访问受保护接口 → 刷新 Token → 登出                  |
| RBAC 权限链  | 创建角色 → 分配权限 → 创建用户 → 分配角色 → 验证权限 → 修改角色 → 验证即时生效 |
| 多租户隔离   | 两个租户创建数据 → 验证租户 A 看不到租户 B 数据                                |
| 审计追踪     | 执行写操作 → 验证审计记录 → 验证脱敏 → 查询过滤                                |
| 迁移执行     | 执行迁移 → 验证表创建 → 回滚 → 验证表删除                                      |

#### 2.3.3 E2E 测试（Playwright）

| 流程       | 操作                                    | 验证点                                                           |
| ---------- | --------------------------------------- | ---------------------------------------------------------------- |
| 登录       | 打开页面 → 输入凭证 → 点击登录          | 跳转到 Dashboard，控制台无应用错误                               |
| 用户 CRUD  | 导航到用户管理 → 创建用户 → 编辑 → 删除 | 表格数据更新，成功提示                                           |
| 角色管理   | 创建角色 → 分配权限 → 分配给用户        | 权限树选择正确，保存成功                                         |
| 主题切换   | 点击主题切换按钮 → 亮暗模式             | 样式即时切换，刷新后持久化                                       |
| 侧边栏导航 | 点击所有菜单项                          | 每页正确渲染，URL 正确                                           |
| 响应式     | 调整浏览器宽度                          | 侧边栏在移动端折叠                                               |
| 控制台检查 | 每个操作后检查                          | 0 应用 error（过滤 findDOMNode/chrome-extension/ResizeObserver） |

**通过标准**:

- 所有测试 0 失败
- 控制台 0 应用错误
- DOM 完整性：`.ant-layout-sider` ≤ 1

#### 2.3.4 性能测试

| 指标                | 目标                        | 测试方法                  |
| ------------------- | --------------------------- | ------------------------- |
| API 响应时间（P95） | < 200ms                     | k6 或 Artillery 压测      |
| 并发登录            | 100 并发无报错              | k6 并发测试               |
| 数据库查询          | 单次 < 50ms                 | pg_stat_statements 监控   |
| 前端首屏            | LCP < 2s                    | Lighthouse                |
| 打包体积            | Admin UI < 500KB gzip       | `npx vite build --report` |
| 内存占用            | 服务端 < 512MB（1000 连接） | 监控                      |

#### 2.3.5 安全审计

| 检查项       | 说明                                        |
| ------------ | ------------------------------------------- |
| OWASP Top 10 | 逐项核查（SQL 注入、XSS、CSRF、认证绕过等） |
| JWT 安全     | RS256 密钥强度、Token 过期检查、轮转机制    |
| 密码安全     | bcrypt cost factor ≥ 12、密码策略执行       |
| 敏感数据     | 无硬编码密钥、日志无明文密码、审计脱敏      |
| 依赖审计     | `pnpm audit` 无高危漏洞                     |
| RBAC         | 权限校验无遗漏、跨租户隔离无漏洞            |

---

### Phase 4: 部署与文档（Week 13-14）

目标：生产就绪，可交付。

#### 2.4.1 Docker 镜像构建

| 任务                    | 文件                  | 说明                                                      |
| ----------------------- | --------------------- | --------------------------------------------------------- |
| 后端 Dockerfile         | `Dockerfile.backend`  | 多阶段构建（build → production），node:20-alpine 基础镜像 |
| 前端 Dockerfile         | `Dockerfile.frontend` | 多阶段构建（build → nginx:alpine），静态文件部署          |
| docker-compose.prod.yml | 生产编排              | 后端 + 前端 + PostgreSQL + Redis                          |
| 镜像优化                | —                     | 层缓存、`.dockerignore`、依赖只装生产包                   |

#### 2.4.2 Kubernetes 部署配置

| 文件                           | 说明                                           |
| ------------------------------ | ---------------------------------------------- |
| `k8s/namespace.yaml`           | 命名空间定义                                   |
| `k8s/backend-deployment.yaml`  | 后端 Deployment（replica=2, resources, probe） |
| `k8s/frontend-deployment.yaml` | 前端 Deployment                                |
| `k8s/service.yaml`             | Service 配置（ClusterIP）                      |
| `k8s/ingress.yaml`             | Ingress 规则                                   |
| `k8s/configmap.yaml`           | 配置注入                                       |
| `k8s/secret.yaml`              | 敏感配置模板（Secret）                         |

#### 2.4.3 文档

| 文档        | 说明                                                     |
| ----------- | -------------------------------------------------------- |
| README.md   | 项目概述、快速开始、包列表                               |
| 各包 README | `packages/*/README.md`：安装、使用示例、API 概览         |
| API 文档    | Fastify 自动生成 OpenAPI/Swagger（@fastify/swagger）     |
| 部署指南    | `docs/deployment.md`：Docker / K8s / 裸机部署步骤        |
| 开发指南    | `docs/contributing.md`：开发环境搭建、贡献流程、编码规范 |
| 运维手册    | `docs/ops.md`：日志排查、监控告警、备份恢复              |

#### 2.4.4 发布准备

| 任务         | 说明                                                            |
| ------------ | --------------------------------------------------------------- |
| npm 发布配置 | 每包 `package.json` 含 `files`、`main`、`types`、`exports` 字段 |
| 版本管理     | 统一使用 `changesets` 管理版本号                                |
| CHANGELOG    | 自动生成变更日志                                                |
| Release 流程 | GitHub Actions: push tag → build → test → publish to npm        |

---

## 3. 包依赖关系图

依赖方向：箭头指向被依赖方（下方依赖上方）。

```
                    ┌─────────────────┐
                    │  shared-types   │  ← 纯类型，零运行时依赖
                    │  (types only)   │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐   ┌──────────────┐    ┌──────────────┐
│   logging    │   │     i18n     │    │  migration   │
│  (pino)      │   │  (i18next)   │    │  (drizzle)   │
└──────┬───────┘   └──────┬───────┘    └──────────────┘
       │                  │                (独立)
       │                  │
       ▼                  ▼
┌──────────────────────────────────┐
│           identity               │  ← 核心包，最复杂
│  (JWT + RBAC + LDAP + MFA)       │
│  依赖: shared-types, logging, i18n│
└──────────┬───────────┬───────────┘
           │           │
           ▼           │
    ┌──────────────┐   │     ┌──────────────────┐
    │    audit     │   │     │   health-check   │
    │ (审计钩子)   │◄──┘     │   (健康检查)     │
    │ 依赖: identity│        │ 依赖: logging    │
    └──────┬───────┘        └──────────────────┘
           │                    (独立于 audit)
           ▼
┌──────────────────────────────────┐
│             admin                │  ← 最大的包
│  (后台框架 + 页面 + 主题)        │
│  依赖: identity, audit, i18n,   │
│         shared-types             │
└──────────────────────────────────┘
```

**并行实施策略**: shared-types、logging、i18n、migration 四个无依赖包可在 Week 3 并行开发。

---

## 4. 里程碑与交付物

| 里程碑                    | 时间       | 交付物                                                | 验收标准                                                        |
| ------------------------- | ---------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| **M0: 基础就绪**          | Week 2 末  | Monorepo 骨架、Docker 环境、CI/CD、规范工具、测试框架 | `pnpm install` → `tsc --noEmit` → `vitest run` 全链路通过       |
| **M1: 无依赖包完成**      | Week 4 末  | shared-types + logging + i18n + migration             | 每包独立 `tsc --noEmit` 通过，单元测试 ≥ 80%                    |
| **M2: Identity 核心完成** | Week 6 末  | @accessbase/identity 完整版                           | 登录/登出/Token 刷新通过，RBAC 权限检查通过，LDAP Mock 测试通过 |
| **M3: 全部 L0 包完成**    | Week 8 末  | 8 个 L0 包全部 0.1.0                                  | 每包 `tsc --noEmit` + 单元测试 ≥ 80%                            |
| **M4: 集成运行**          | Week 10 末 | Fastify 服务 + Admin UI 可联调                        | `pnpm dev` 启动后登录 → 创建用户 → 分配角色 全流程通过          |
| **M5: 质量达标**          | Week 12 末 | 测试覆盖 ≥ 80%、E2E 通过、安全审计通过                | Playwright 12/12 通过，k6 压测 P95 < 200ms                      |
| **M6: 生产就绪**          | Week 14 末 | Docker 镜像 + K8s 配置 + 文档 + npm 发布              | `docker compose up` 全栈启动，API 文档完整，README 清晰         |

---

## 5. 风险评估

### 5.1 技术风险

| 风险                           | 可能性 | 影响 | 缓解措施                                                   |
| ------------------------------ | ------ | ---- | ---------------------------------------------------------- |
| identity 包复杂度超预期        | 高     | 高   | 预留 2 周缓冲；LDAP/MFA 放 Week 5-6；MVP 先做密码+JWT+RBAC |
| Drizzle ORM 迁移能力不足       | 中     | 中   | 提前 POC 三阶段迁移；备选：保留现有迁移工具做适配器        |
| 前后端联调耗时                 | 中     | 中   | Phase 2 预留 2 周；提前约定 API 格式（OpenAPI spec 先行）  |
| pnpm workspace 包间依赖解析    | 低     | 中   | Phase 0 先验证包间引用；使用 `workspace:*` 协议            |
| React 19 + Ant Design 5 兼容性 | 低     | 低   | 稳定版发布后再升级；Phase 0 先验证基础组件渲染             |

### 5.2 进度风险

| 风险                                 | 可能性 | 影响 | 缓解措施                                           |
| ------------------------------------ | ------ | ---- | -------------------------------------------------- |
| 设计文档细节不够实施                 | 中     | 高   | 实施前逐包读 SDD；遇到歧义先记录再集中讨论         |
| 人员不足或变动                       | 中     | 高   | 优先保证 identity + admin + audit 三包（最小可用） |
| Phase 3 测试耗时超预期               | 中     | 中   | 测试随开发同步进行（TDD），不集中到 Phase 3        |
| 外部依赖变更（Fastify/Drizzle 版本） | 低     | 中   | 锁定主要依赖版本；定期 `pnpm update` + 回归测试    |

### 5.3 质量风险

| 风险                  | 可能性 | 影响 | 缓解措施                                                                 |
| --------------------- | ------ | ---- | ------------------------------------------------------------------------ |
| 安全漏洞（认证/授权） | 中     | 极高 | identity 包 ≥ 90% 覆盖；发布前安全审计；静态扫描（ESLint security 插件） |
| 性能不达标            | 低     | 高   | Phase 1 中 benchmark 关键路径；identity 查询加 Redis 缓存                |
| 代码风格不一致        | 中     | 中   | ESLint + Prettier + pre-commit hook 强制执行                             |
| 文档与实现脱节        | 高     | 中   | 实施完成后立即更新 SDD；PR review 检查文档同步                           |

---

## 6. 成功标准

### 6.1 代码质量

| 指标                | 目标                        | 检查方式                                |
| ------------------- | --------------------------- | --------------------------------------- |
| TypeScript 严格模式 | `strict: true`，零 `as any` | `tsc --noEmit` + ESLint no-explicit-any |
| ESLint              | 零 error（warn 允许）       | `eslint packages/`                      |
| Prettier            | 100% 格式一致               | `prettier --check packages/`            |
| 文件大小            | ≤ 800 行/文件               | CI 检查脚本                             |
| 函数大小            | ≤ 50 行/函数                | 代码审查                                |

### 6.2 测试覆盖率

| 范围              | 最低覆盖率    | 关键包提升       |
| ----------------- | ------------- | ---------------- |
| 全局              | ≥ 80%         | —                |
| identity          | ≥ 90%         | 认证、RBAC、LDAP |
| audit             | ≥ 85%         | 脱敏、自动记录   |
| E2E（Playwright） | 核心流程 100% | 登录、CRUD、权限 |

### 6.3 性能基准

| 指标                    | 目标值               |
| ----------------------- | -------------------- |
| API 响应时间（P50）     | < 50ms               |
| API 响应时间（P95）     | < 200ms              |
| API 响应时间（P99）     | < 500ms              |
| 并发登录                | 100 并发无报错       |
| 前端首屏（LCP）         | < 2 秒               |
| Admin UI 包体积（gzip） | < 500KB              |
| 后端 Docker 镜像        | < 200MB              |
| 服务内存占用            | < 512MB（1000 连接） |
| 数据库查询              | 单次 < 50ms          |

### 6.4 安全合规

| 项目         | 标准                                                            |
| ------------ | --------------------------------------------------------------- |
| OWASP Top 10 | 逐项覆盖（SQL 注入防护、XSS 防护、CSRF 令牌、认证暴力破解防护） |
| JWT          | RS256 签名，Access Token 15 分钟过期，Refresh Token 轮转        |
| 密码         | bcrypt cost factor ≥ 12，最小 8 字符，要求大小写+数字           |
| HTTPS        | 生产环境强制 TLS 1.2+                                           |
| 依赖安全     | `pnpm audit` 无高危（critical/high）漏洞                        |
| 日志脱敏     | authorization header、cookie、password、token 自动脱敏          |
| 审计完整性   | 所有写操作 100% 审计记录                                        |

---

## 7. 团队分工建议

### 7.1 角色定义

| 角色                 | 人数 | 职责                                       |
| -------------------- | ---- | ------------------------------------------ |
| 后端工程师（Senior） | 2    | identity 核心、JWT/RBAC/LDAP、Fastify 集成 |
| 后端工程师（Mid）    | 1    | audit、health-check、migration、日志       |
| 前端工程师（Senior） | 1    | admin 框架、主题系统、ProLayout 集成       |
| 前端工程师（Mid）    | 1    | CRUD 页面、表单组件、管理页面              |
| 全栈/DevOps          | 1    | CI/CD、Docker、K8s、数据库、部署           |
| 测试/QA              | 1    | E2E 测试、性能测试、安全审计               |

**最小团队（3 人）**: 1 全栈后端 + 1 全栈前端 + 1 DevOps/测试

### 7.2 人员分配

| 阶段             | 后端 (Senior)            | 后端 (Mid)                 | 前端 (Senior)     | 前端 (Mid)         | DevOps       | QA       |
| ---------------- | ------------------------ | -------------------------- | ----------------- | ------------------ | ------------ | -------- |
| Phase 0 (W1-2)   | 骨架搭建                 | 测试框架                   | Vite 初始化       | —                  | Docker + CI  | 测试环境 |
| Phase 1a (W3-4)  | identity 前半            | logging + i18n + migration | admin 主题 + 布局 | —                  | —            | —        |
| Phase 1b (W5-6)  | identity 后半 (LDAP/MFA) | audit                      | admin API 客户端  | 登录页 + CRUD 框架 | —            | —        |
| Phase 1c (W7-8)  | identity 收尾 + review   | health-check + audit 收尾  | admin 管理页面    | 管理页面           | npm 发布准备 | 集成测试 |
| Phase 2 (W9-10)  | Fastify 集成 + API       | API 路由实现               | 前后端联调        | 页面联调           | 部署脚本     | API 测试 |
| Phase 3 (W11-12) | 单元测试收尾             | 单元测试收尾               | E2E 测试          | E2E 测试           | 性能测试     | 安全审计 |
| Phase 4 (W13-14) | Bug 修复                 | 文档                       | 文档              | 文档               | K8s 部署     | 回归测试 |

### 7.3 协作约定

| 项目      | 规则                                                                 |
| --------- | -------------------------------------------------------------------- |
| 分支策略  | `main`（稳定） + `feat/*`（功能分支） + `fix/*`（修复分支）          |
| PR 要求   | 至少 1 人 approve、CI 通过、`tsc --noEmit` 通过                      |
| 每日站会  | 15 分钟，同步进度和阻塞                                              |
| 周 Review | 每周盘点里程碑进度，调整计划                                         |
| 代码审查  | identity 相关代码需 2 人 review                                      |
| 文档同步  | 实施完立即更新 SDD，PR 检查文档同步                                  |
| 提交规范  | Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:` |
| 版本发布  | 使用 changesets 管理，统一发布                                       |

---

## 附录 A: 技术决策速查

以下关键决策影响实施（详见 `.agents/memorys/decisions.md` D1-D95）:

| 决策                                    | 编号 | 实施影响                |
| --------------------------------------- | ---- | ----------------------- |
| AccessBase 命名 + `@accessbase/*` scope | D1   | 所有包名、npm scope     |
| 8 项能力进入 L0                         | D2   | 包边界定义              |
| auth + rbac 合并为 identity             | D3   | identity 包最复杂       |
| L0 用配置点，不用插件                   | D4   | admin 只提供扩展接口    |
| JWT: 15min Access + 7d Refresh + 轮转   | D5   | SessionManager 设计     |
| RBAC1 角色继承                          | D6   | ACLGuard 继承链解析     |
| Drizzle ORM 统一迁移和数据访问          | D7   | migration + Schema 设计 |
| pino 结构化日志                         | D8   | logging 包选型          |
| i18next 双命名空间                      | D9   | 包名 + client 命名空间  |
| Refine + ProLayout 混合 UI              | D26  | admin 布局方案          |

## 附录 B: 包发布配置模板

```json
{
  "name": "@accessbase/identity",
  "version": "0.1.0",
  "description": "AccessBase 身份与访问管理（认证+授权+RBAC+LDAP+MFA）",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./fastify": {
      "types": "./dist/fastify-plugin.d.ts",
      "import": "./dist/fastify-plugin.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

## 附录 C: 环境变量清单

| 变量                   | 必需 | 默认值                  | 说明                                  |
| ---------------------- | ---- | ----------------------- | ------------------------------------- |
| `DATABASE_URL`         | 是   | —                       | PostgreSQL 连接串                     |
| `REDIS_URL`            | 是   | —                       | Redis 连接串                          |
| `JWT_PRIVATE_KEY_PATH` | 是   | —                       | RS256 私钥路径                        |
| `JWT_PUBLIC_KEY_PATH`  | 是   | —                       | RS256 公钥路径                        |
| `JWT_ACCESS_EXPIRY`    | 否   | `15m`                   | Access Token 有效期                   |
| `JWT_REFRESH_EXPIRY`   | 否   | `7d`                    | Refresh Token 有效期                  |
| `NODE_ENV`             | 否   | `development`           | 运行环境                              |
| `LOG_LEVEL`            | 否   | `info`                  | 日志级别                              |
| `PORT`                 | 否   | `5101`                  | 后端监听端口                          |
| `CORS_ORIGIN`          | 否   | `http://localhost:5173` | 允许的跨域来源                        |
| `LDAP_URL`             | 否   | —                       | LDAP 服务器地址                       |
| `LDAP_BIND_DN`         | 否   | —                       | LDAP 绑定 DN                          |
| `LDAP_BIND_PASSWORD`   | 否   | —                       | LDAP 绑定密码（AES-256-GCM 加密存储） |
| `SMTP_HOST`            | 否   | —                       | 邮件服务器（密码重置用）              |
| `DEFAULT_LOCALE`       | 否   | `zh-CN`                 | 默认语言                              |
