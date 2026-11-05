# Panel Review — Long-Term Plan & Phase Roadmap (docs/implementation-plan.md)

**Date:** 2026-11-05
**Artifact under review:** the new long-term plan at `docs/implementation-plan.md` §0–§8
(270 lines added, v3.0 retained below under a superseded header) — i.e. the plan that encodes
rulings R1–R10 of 2026-11-05.
**Panel gate:** plan / cross-batch ruling review → Standard, 3 roles (2 fixed core + mounted
`doc-audit` lens). Not escalated to Deep on purpose: the mounted-lens table only offers
`doc-audit` as relevant to this artifact (no security surface, no API contract shape, no UI
consistency claim), and the skill forbids inventing roles to reach a headcount.
**Track: SEQUENTIAL.** Third on-record data point that this host exposes no team API (see the
2026-11-04 panel report; `Agent` exposes only `Browser|CodeReview`, `experts/<session>` is a
single-leader record with empty `agents/`+`inboxes/`).
**Isolation:** three separate passes, each re-collecting evidence with fresh commands; no pass
was given an earlier pass's conclusions.
**Deviation from the skill's run-record location:** written to tracked
`docs/superpowers/reports/` instead of `.omo/reports/` — `.omo/` is gitignored, and creating yet
another out-of-repo copy of a decision record is the exact failure this plan's L1 layer exists to
remove. The skill's intent (dated, English, roles + per-role findings + merge + conflicts) is met.

## Per-role findings

### Pass 1 — correctness officer (assume the plan is WRONG)

- **P1 [CRITICAL]: §3 S1 acceptance cites a demonstration that does not exist.** The line reads
  "new format+recency lint green (see §5 of the governance plan for its red/green demo)". Two
  faults: (a) the governance plan has **no numbered §5** — its sections are `## Batch 1..8`,
  `## Adjudication results`, `## Batch 7 execution log`, `## OpenCode-adaptation adjudications`,
  etc.; (b) more seriously, the R2-D format/recency gate was **ruled today and is unimplemented**,
  so no red/green demonstration can exist yet. The plan therefore uses a not-yet-performed
  verification as the acceptance evidence for its own first big phase — precisely what
  CONSTRAINTS.md "Verification discipline" forbids, and what the plan's §5 risk table claims to
  guard against.
- **P2 [CRITICAL, decision-invalidating]: R4-C's deletion of `packages/migration` would break
  three documented commands.** Measured chain: `accessbase.sh:668 cmd_db_push()` → `pnpm db:push`
  → root `package.json:24-26` = `pnpm --filter @accessbase/migration run db:push|db:generate|
  db:migrate`. So the package is the live host of the drizzle-kit schema tooling surface, listed
  in AGENTS.md's COMMANDS block. My ruling argument was "D117 already condemned it" — but D117
  assigns **runtime migration execution** to `scripts/migrate.sh`; it says nothing about
  **schema push/generate**, which still runs through this package. The two were conflated.
  Consequence: R4-C's fact base is wrong for one of its three deletions; this returns to the
  adjudication table rather than being silently corrected by me.
- **P3 [HIGH]: alerting is mis-tiered.** §2 L3 Tier-2 claims "deployment wiring + documentation;
  near-zero code". Measured: `prometheus` appears **0 times** in `docker-compose.yml`,
  `docker-compose.prod.yml`, `docker-compose.dev.yml`, `Dockerfile`, `docker/entrypoint.sh`,
  `docker/entrypoint-dev.sh`. `docker/prometheus/rules.yml` self-describes as "Sample … NOT WIRED".
  So the "one step" is not mounting a file — it is introducing a monitoring stack that does not
  exist in this repo's deployment topology. Belongs in Tier 3 (signal-gated) or needs its own
  explicit "do we run Prometheus at all" decision.
- **P4 [MEDIUM]: the same item is both a hard block and in-scope work.** §7 hard-blocks ADJ-7c
  pending ruling C-2, while §3 S2 lists "ADJ-7c graphify split + `skill_budget` gate" inside the
  phase with only an inline note "**blocked on panel finding C-2 being ruled**". An implementer
  following the phase table starts S2 and reaches a wall mid-phase. One of the two must yield.
- **P5 [LOW]: two H1 headings in one file** — `# AccessBase — Long-Term Plan…` and the retained
  `# AccessBase 实施计划`. Acceptable for a preserved historical document, but it breaks any
  outline/navigation tool that assumes one H1; if kept, the historical H1 should be demoted.
- **Explicitly not covered:** whether the rulings themselves were wise (they are the user's);
  anything outside the new §0–§8 (the retained v3.0 text was reviewed only for the superseded
  header's correctness).

### Pass 2 — evidence officer (unproven claims, including in the plan's own evidence classes)

- **E1 [CRITICAL]: a `[measured]` label claims more than was measured.** §2 L2 E3 states the
  packages have "**0 consumers anywhere** `[measured]`". What was actually measured is source
  imports only. Measured now: `apps/server/package.json` `dependencies` contains
  **`@accessbase/health": "workspace:*"`** and **`@accessbase/i18n": "workspace:*"`** (plus
  audit/identity/logging). So health and i18n have zero source imports but **two live production
  dependency declarations** (phantom deps). The plan's §0 rule — "every claim carries its evidence
  class" — is broken by the plan's own document, in the same table that justifies deleting those
  packages.
- **E2 [HIGH]: a countable number written from memory.** §3 S2 says "panel's remaining **13**
  items". Measured: the 2026-11-04 panel merge table holds **16 findings** (C-1…C-4, D-1…D-6,
  E-1…E-6) plus 3 conflict items; minus already-handled (C-1 resolved by the concurrent session's
  exemption, D-1/D-4/D-5 fixed in-place, E-6 clean) leaves **11 + 3 = 14**. The plan whose R2-D
  ruling exists to purge hand-written measurable counts opens its phase table with one.
- **E3 [HIGH]: L2 E8 is already stale.** `grep -rn "DEAD API with zero src callers"` over
  `apps/` and `packages/` → **0 hits**; the `@deprecated` marker was cleaned up between my audit
  pass and now (the tree is actively moving). The row must be deleted or converted into
  "verified closed 2026-11-05".
- **E4 [MEDIUM]: §6 success criterion #1 outruns §2's coverage of it.** Criterion #1 demands zero
  `[doc-claim]` in "module headers, deferred ledger rows, **or AGENTS.md status line**", but the
  only L1 row addressing AGENTS.md is T9 (the re-encrypt item). The AGENTS.md "Status:" paragraph,
  the OVERVIEW batch narrative and the `[doc-claim]` surface I tagged in §1 all need their own
  rows, or criterion #1 is unachievable as scoped.
- **E5 [MEDIUM]: coverage figures are `[measured]` but as-of a stale artifact.** The numbers are
  real and reproducible, but they come from `coverage/coverage-final.json` dated **2026-11-02**,
  not from a re-run in this audit. §0's class definition says measured = "verified on this
  machine … command stated or reproducible"; a three-day-old report satisfies reproducibility but
  the plan should carry the as-of date on each coverage claim (E1/E2 rows do not).
- **E6 [LOW, checked-clean]:** re-opened every file:line the plan cites — `webhook-dispatcher.ts:111`
  (`FOR UPDATE SKIP LOCKED`), `docker/prometheus/rules.yml` header, `decisions.md:2401-2407`
  (D122), `Dockerfile` COPY lines 18/19/20/23/36/37/38/41, `vitest.config.ts:20-27`,
  `eslint.config.mjs:68`, `routes/{users,roles}.ts` absence of locking, package line counts
  (1356/835/162/881) — all match. Empty-catch count re-verified with a **multiline-aware** regex:
  still 0, so E4-of-L2's "0 occurrences" is sound.
- **Explicitly not covered:** the numeric health of the shipped product (no test run, no coverage
  re-run); whether `.agents/memorys/*` claims are true (out of this artifact).

### Pass 3 — doc-audit lens (numbering, cross-refs, index, dependency placement)

- **D1 [MEDIUM]: the authoritative document is not indexed.** The plan now lives at
  `docs/implementation-plan.md`, but `grep -n implementation-plan docs/AGENTS.md` → **0 hits**:
  the docs index that lists this directory's contents does not know it exists. §6 criterion #2
  ("one authoritative backlog") is undermined by the backlog being unreachable from the index a
  reader is told to start at.
- **D2 [MEDIUM]: a prerequisite hung on the wrong phase.** §3 S3 lists "Depends on: S1 (check
  `workspace:*` dependency declarations — `[unverified]`, not inspected in this audit)". That
  check is not an S1 deliverable anywhere in §3; it is an S3 pre-flight. As written, completing
  S1 does not cause the check to happen, and S3 can then break `pnpm install --frozen-lockfile`.
- **D3 [LOW]: prefix collision with the panel report.** The plan uses `E1…E8` for engineering
  health; the 2026-11-04 panel report uses `E-1…E-6` for evidence-officer findings, and `D-1…D-6`
  for its own doc-audit findings while the plan uses `D` for rulings R1–R10. §3 S2's "panel's
  remaining 13 items" lives in that shared space with no disambiguation.
- **D4 [LOW]: the carrier count in §1 is already incomplete.** §1 enumerates six backlog carriers;
  the governance plan now carries **three** adjudication sections (16 points, Batch 7's 11 points,
  and an `OpenCode-adaptation adjudications` section added by the concurrent session) plus two
  execution logs. The "six carriers" framing understates the fragmentation the plan sets out to fix.
- **Explicitly not covered:** prose quality, translation of the retained Chinese history, and the
  governance plan's own internal consistency (reviewed 2026-11-04).

## Merge (single pass, lead)

| # | Grade | Finding | Origin | Status |
|---|---|---|---|---|
| P2 | CRITICAL | R4-C deleting `packages/migration` breaks `db:push/generate/migrate` (root `package.json:24-26` → the package) | pass 1 | OPEN — returns to adjudication (X-1) |
| E1 | CRITICAL | "0 consumers anywhere `[measured]`" overstates: `apps/server` declares `@accessbase/health` + `@accessbase/i18n` as production deps | pass 2 | OPEN — re-label; feeds X-2 |
| P1 | CRITICAL | §3 S1 acceptance cites "§5 of the governance plan" (no such section) for a red/green demo that cannot exist yet (R2-D unimplemented) | pass 1 | OPEN — rewrite acceptance as its own demo obligation |
| P3 | HIGH | alerting mis-tiered: Prometheus appears 0 times in all compose files, Dockerfile and entrypoints; "one step" is really "adopt a monitoring stack" | pass 1 | OPEN — demote or decide |
| E2 | HIGH | "panel's remaining 13 items" is wrong (16 findings + 3 conflicts; 11+3 = 14 outstanding) — a hand-written count inside the plan that bans them | pass 2 | OPEN — replace with a pointer, per R2-D |
| E3 | HIGH | L2 E8 (`@deprecated DEAD API`) already cleaned: 0 hits — row is stale on the day of writing | pass 2 | OPEN — close with date |
| P4 | MEDIUM | ADJ-7c is simultaneously a §7 hard block and a §3 S2 deliverable | pass 1 | OPEN — pick the stop point |
| E4 | MEDIUM | §6 criterion #1 requires zero `[doc-claim]` in AGENTS.md, but L1 has only one row (T9) covering it | pass 2 | OPEN — add rows or narrow criterion |
| E5 | MEDIUM | Coverage claims tagged `[measured]` without their as-of date (source artifact is 2026-11-02) | pass 2 | OPEN — add asOf per row |
| D1 | MEDIUM | New authoritative plan is absent from `docs/AGENTS.md` index | pass 3 | OPEN — one-line index entry |
| D2 | MEDIUM | `workspace:*` pre-flight attached to S3's "depends on S1" although S1 never produces it | pass 3 | OPEN — move to S3 pre-flight |
| P5 | LOW | Two H1s in one file (retained history) | pass 1 | OPEN — demote or accept |
| D3 | LOW | Prefix collision E/D between plan rows and panel report items | pass 3 | OPEN |
| D4 | LOW | §1 "six carriers" understates current fragmentation (three adjudication sections exist now) | pass 3 | OPEN |
| E6 | — | All 12 spot-checked file:line citations verified; multiline-aware empty-catch re-check still 0 | pass 2 | CLEAN |

Dedup note: P2 and E1 are the same underlying defect (R4-C's evidence base) reached from two briefs
— mechanism/blast-radius vs. evidence-class — kept as two rows because their fixes differ
(R4-C re-ruling vs. label correction + a new phantom-dependency defect row).

## Conflict items (preserved, not smoothed)

- **X-1 — is `packages/migration` deletable?**
  - Correctness stance: **no.** It is the execution host of three documented commands; deleting it
    breaks `accessbase.sh db:*` and AGENTS.md's documented interface. R4-C stands only for
    `admin` and `i18n`-minus-declarations.
  - Ruling basis at the time: D117 ("runtime migration sole writer = `scripts/migrate.sh`") plus
    two `TODO: Implement migration/rollback` in `manager.ts`. That basis is not wrong about the
    *migration runner*; it was silently extended to the *package*, which also hosts drizzle-kit
    schema tooling.
  - This is not a disagreement about values, it is a factual premise that new measurement
    overturned — it goes back to the user, who owns R4.
- **X-2 — does a phantom dependency count as a consumer?**
  - Correctness stance: yes. `pnpm install` resolves it, the deletion must edit
    `apps/server/package.json`, so the "delete" is not a pure removal and must be planned as such.
  - Evidence stance: no. Zero source imports means it is not a consumer; the honest statement is
    "no runtime consumers; two phantom production declarations", and the phantom declarations are
    **their own defect** deserving an L2 row (dead dependency wiring), not a footnote to R4.
  - Consequence differs: X-1's reading merges the fix into S3; X-2's reading adds a new
  engineering-health item and a separate small cleanup.
- **X-3 — severity of the plan violating its own evidence-class rule (E1/E2/E5).**
  - Evidence officer: **CRITICAL.** Three separate rows in one document break the one convention
    the document was written to install; a rule that its author violates on day one will not be
    respected by the next session, and the plan's whole L1 layer exists because unverified claims
    were treated as authoritative.
  - Correctness reading (as it would have filed it): **MEDIUM.** Each instance is fixable wording
    around facts that are otherwise reproducible; the mechanism (§0) is still sound.
  - Left unresolved deliberately: whether a self-violating convention is a wording problem or a
    credibility problem changes what S1 must do about it.

## Run record

- Roles: correctness officer, evidence officer, `doc-audit` lens. Sequential track, three passes,
  fresh evidence per pass.
- Verdict: **not clean.** 3 CRITICAL, 3 HIGH, 5 MEDIUM, 3 LOW against 12 rulings the plan encodes.
  One CRITICAL (P2) invalidates a factual premise of a user ruling (R4-C); one (E1) shows the plan
  breaking the evidence rule it introduces.
- Handoff: to `adjudication-walkthrough`, one at a time, order P2 → E1 → P1 → X-2 → X-3 → P3 →
  E2 → E3 → the MEDIUM/LOW set.
- Not claimed: that R1–R10's judgements were wrong. Every finding attacks a premise, a citation, a
  tier assignment or the plan's own conventions. Only X-1 asks to reopen a decision, and it does so
  on new measurement rather than preference.

## Outcome (same day, after adjudication)

Ruled one at a time: **X-1 = A** (strip the package's unimplemented CLI, keep it as the
drizzle-kit tooling host), **X-2 = B** (repair the dependency graph first: declare `health` in
`packages/identity`, clear the 6 phantom declarations, only then ship a `pkg-deps-lint` layer with
mandatory fixtures), **X-3 = C** (the S1 lint's scope covers this plan too — self-application, no
new mechanism), **P3 = A** (alerting is Tier 3; bundling a monitoring stack is a product-posture
decision, not a half-finished task). The MEDIUM/LOW set was fixed in place, needing no ruling.

Three things worth keeping from the round, because they are uncomfortable:

1. **P2's own severity was over-stated by its author.** I filed "deleting `migration` breaks three
   documented commands" as CRITICAL; its scripts are thin `drizzle-kit` wrappers, so the true cost
   was a small move or none at all. X-1=A proves it: the package can keep its tooling role with no
   lockfile and no shell edits. A panel finding is not disqualified for having been wrong, but it
   should be re-checked before it reopens someone's ruling.
2. **Every verification script written during this audit was wrong somewhere.** Over-broad scan
   roots (`distributed 54` false positives), a directory-level `.d.ts` heuristic whose verdict table
   I withdrew, a path-splitting bug that mislabelled 16 rows, and an anchor-counting regex that
   reported 28 undated references while also counting the dated ones. The plan's S1 lint therefore
   must ship `--self-test` fixtures, and "the tool said so" is explicitly not an evidence class.
3. **The plan broke its own new rules seven times while being fixed for breaking them twice** —
   an in-cell pipe (the exact defect ADJ-7a fixes in the generated digest), a four-column separator
   over a three-column header, a `§5` citation to a section that does not exist and a red/green demo
   that has not happened yet, a hand-written "13 items" inside the document that bans hand-written
   counts, a stale `@deprecated` row, and a same-round prefix collision (`X-1…X-3` in two reports,
   which the file's own naming rule forbids). All seven are fixed and annotated in place; the
   pattern is why the recency/format lint is scheduled as S1's first deliverable rather than
   assumed to be solved by intention.
