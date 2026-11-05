# Panel Review Round 2 — the long-term plan after its own fixes (d69e241)

**Date:** 2026-11-05
**Artifact:** `docs/implementation-plan.md` as committed in `d69e241` — i.e. the version that
already absorbed round 1 (11-05 X-1/X-2/X-3/P3-A) and the seven self-violations fixed then.
**Why a second panel:** round 1's fixes were written by the same author as the artifact and were
never independently checked; the plan's own §0 rule ("a `[measured]` tag may not assert more than
the stated command covered") is exactly the kind of claim that needs a reader who did not write it.
**Gate:** plan / cross-batch ruling review → Standard, 3 roles (correctness, evidence, mounted
`doc-audit` lens). **Track: SEQUENTIAL** (fourth measurement that this host exposes no team API).
**Isolation:** each pass re-ran its own commands against the committed file; no pass saw another's
conclusions before finishing.

## Per-role findings

### Pass 1 — correctness officer (assume the fixed plan is still wrong)

- **R2-C1 [HIGH] `S0` says "push the 10 queued commits"; it is 11.** Measured: `git rev-list
  --count origin/master..HEAD` → 11. The number went stale **during the very session that wrote
  it**, when the plan itself was committed. This is not a rounding error — it is the plan's own
  thesis demonstrated on the plan: a hand-written measurable count is wrong by the time it is read.
- **R2-C2 [HIGH] `S0`'s acceptance says "7 jobs green"; `ci.yml` defines 8.** Measured job names:
  Lint, Type Check, Test, E2E (Chromium), Migration chain, Build, Docker Build, **Governance
  Gates**. The eighth was added by ADJ-7f — the same ruling that rewrote S0's rationale. As
  written, S0's acceptance criterion is **unsatisfiable on its face**: seven jobs can never be
  green when eight exist.
- **R2-C3 [MEDIUM] one fact, three different numbers.** The count of this document's own
  self-violations is written as "Sixth self-violation" (§0, line ~46), "three further
  self-violations" (§8, line ~358), and "seven times" (round-1 report, Outcome item 3). Each is
  defensible in isolation ("the sixth one I annotated", "three more surfaced during X-3", "seven
  total") but a reader cannot reconcile them, and all three are hand-written counts inside the
  document that bans hand-written counts.
- **Explicitly not covered:** whether the 14 rulings were wise; the retained v3.0 history; the
  governance plan's internals (round 1 covered them).

### Pass 2 — evidence officer (re-measure what the plan claims `[measured]`)

- **R2-E1 [CLEAN, and it strengthens a prior ruling] T12 and X-2 both reproduce exactly.**
  Case-insensitive search for `prometheus` across all compose files, `Dockerfile`, `docker/` and
  `.github/` returns **only the rules file itself** — T12 holds. The dependency-graph counts
  reproduce as **declared-but-unused 6 / used-but-undeclared 1**, matching X-2's premise verbatim;
  and `packages/admin` and `packages/migration` still exist, confirming nothing was implemented
  ahead of its ruling.
- **R2-E2 [MEDIUM] T12 under-states its own evidence, in a way that matters.** The row says the
  sample "does ship alert definitions" and names two alerts. Measured: `grep -c '  - alert:'` →
  **7 alert definitions**. Seven coherent rules is not a stub awaiting a mount; it reads as a
  deliberate operator-facing deliverable. This does **not** reopen P3-A — it hardens it (the tier
  was set by the product-posture argument, and bigger sample ⇒ stronger case that bundling a
  Prometheus deployment is the operator's call). But the plan should cite 7, with `asOf`.
- **R2-E3 [LOW] `asOf` is used 7 times while the file carries many more dated claims**
  ("delivered 2026-10-08", "last entry 2026-10-12", "stops 09-12"). Those are dates *inside*
  document claims rather than measurements, so they are not violations — but the visual
  similarity between "2026-10-08" in a `[measured]` cell and the same format in a `[doc-claim]`
  cell is itself a trap for the next reader. Worth one line in §0.
- **Explicitly not covered:** product test baselines (still never re-run — correctly labelled
  `[unverified]` in T8); anything requiring a database or network.

### Pass 3 — doc-audit lens (self-consistency of the conventions the plan introduces)

- **R2-D1 [MEDIUM] the plan's own naming rule is not followed by the plan.** §0 and §8 declare
  that panel items must always carry their report date (`11-05 X-1`), and §7's hard-block list
  complies. But S3's row and L1/L3 prose use bare `X-1=A`, `P3-A`, `X-2 pending` within ~40 lines
  of that rule. A convention violated by its author two paragraphs down cannot be enforced later.
- **R2-D2 [MEDIUM] §6 criterion #1 scopes a document that S1 does not cover.** Criterion #1 demands
  zero `[doc-claim]` in "module status headers, **deferred ledger row**, or AGENTS.md paragraph
  (rows T1–T12)"; S1's scope lists 12 L1 rows + 38 headers + CHANGELOG + status.md + "deferred
  ledger re-adjudicated", but the deferred ledger lives in `gap-map-v2` §3 which is a report, and
  L3's Tier-3 rows still carry document-only assertions (`column exists, API ruled out`,
  `heavy-deps ruling`) with no owner. Either name the artifact that owns the ledger or narrow the
  criterion; today the success test and the task list do not meet.
- **R2-D3 [LOW, clean]** `monitoring.md` genuinely contains §13.3 ("告警规则设计", line 72) and its
  status header does say "§13.3-13.6 … unimplemented" — T12's citation resolves. The single report
  path referenced by the plan exists. The 38-header arithmetic (44 − 5 superseded − 1 informational
  = 38) checks out against a fresh scan of the 44 module files (22 partial / 8 implemented /
  5 superseded / 1 informational / 8 design-only).
- **Explicitly not covered:** prose quality; the historical Chinese section beyond its header.

## Merge (single pass, lead)

| # | Grade | Finding | Origin | Disposition proposed |
|---|---|---|---|---|
| R2-C2 | HIGH | "7 jobs green" vs 8 defined → S0 acceptance unsatisfiable as written | pass 1 | replace count with a pointer ("all jobs in `jobs:` green"); or state the count with `asOf` |
| R2-C1 | HIGH | "10 queued commits" is 11, made stale by this session's own commit | pass 1 | replace with `git rev-list --count origin/master..HEAD` at run time |
| R2-E2 | MEDIUM | T12 under-states: sample carries 7 alert definitions, not 2 | pass 2 | cite 7 with `asOf 2026-11-05`; strengthens P3-A, does not reopen it |
| R2-D1 | MEDIUM | date-prefix naming rule violated inside the same document | pass 3 | mechanical sweep in §2/§3 prose |
| R2-D2 | MEDIUM | §6 criterion #1 covers a deferred ledger no S1 task owns | pass 3 | name the owner or narrow the criterion |
| R2-C3 | MEDIUM | three different counts of the same self-violation set | pass 1 | drop the counts; keep the enumerated list |
| R2-E3 | LOW | `asOf` used 7× while dated document-claims use the same visual form | pass 2 | one clarifying line in §0 |
| R2-E1 | CLEAN | T12, X-2 counts, package presence all reproduce exactly | pass 2 | — |
| R2-D3 | CLEAN | §13.3 exists; report path resolves; 38-header arithmetic verified | pass 3 | — |

## Conflict items (preserved, not smoothed)

- **R2-X1 — fix the stale counts, or delete them?**
  - Correctness stance: correct them in place (10→11, 7→8, three→one). Fast, minimal, the plan
    reads true immediately.
  - Evidence stance: **delete them**. The decisive fact is R2-C1's mechanism: the number was
    already wrong by the time it was committed, because the act of committing changed it. Fixing
    it re-creates the same liability one commit later. The count should be replaced by the command
    that yields it at run time — which is what R2-D ruled for module headers and what R10's S1
    lint enforces.
  - Left open deliberately: the two readings differ on whether this plan is allowed to contain
    *any* run-time-variable quantity, and that is a policy, not a typo.
- **R2-X2 — is "7 jobs" a wording bug or an acceptance defect?**
  - Correctness: HIGH — a criterion that cannot be satisfied is a broken gate, and a broken gate
    that reports success is worse than no gate; S0 is the plan's first action.
  - Evidence: MEDIUM — the operative intent ("everything in `.github/workflows/ci.yml` green")
    is unambiguous to a human; the number is decoration around a working instruction.
  - Matters because the two grades imply different fixes: rewrite the acceptance column (HIGH) vs.
    annotate a figure (MEDIUM).
- **R2-X3 — does round 1's authorship taint round 2?**
  - Position A: yes, materially — every "self-violation" found in round 1 was found by the same
    agent who created it, so round 2 must assume undiscovered ones exist and keep counting the
    artifact's own claims at a discount.
  - Position B: no — the checks that produced round 2's findings were run against the committed
    file with fresh commands (`git rev-list`, `grep -c`, a re-derived dependency graph), which is
    exactly what independence means operationally here; the residual risk is addressed by the S1
    lint, not by distrust of measurement.
  - Not smoothed: this determines whether the fix for R2-C1/C2 is "trust but re-check each figure"
    or "make the machine re-check them", and it is the same question the plan has been circling
    since §0.

## Run record

- Roles: correctness officer, evidence officer, `doc-audit` lens; sequential track; 3 passes;
  all findings backed by a command in this report.
- Verdict: **not clean** — 2 HIGH, 4 MEDIUM, 1 LOW, 2 CLEAN. Notably, both CLEAN rows confirm
  round 1's repairs held, and both HIGH rows are the *same class* as the finding that motivated
  R2-D in the first place: quantities that change under the writer's own feet.
- Handoff: to `adjudication-walkthrough`, one at a time. Suggested order **R2-X1 → R2-C2 →
  R2-E2 → R2-D1 → R2-D2 → R2-C3 → R2-E3**, with R2-X2 and R2-X3 raised only if their fixes are
  contested.
- What round 2 adds beyond fixes: R2-X1 makes the policy question explicit. Round 1 established
  "machine checks format and recency, humans check meaning"; round 2 shows the plan has not yet
  decided whether it is even allowed to contain run-time quantities — the one place where its own
  rule bites its own text.
