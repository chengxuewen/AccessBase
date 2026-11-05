# Panel review round 1 — S0+S1 close-out plan (2026-11-05)

- Target: `docs/superpowers/plans/2026-11-05-s0-s1-closeout.md` (draft as written).
- Track: SEQUENTIAL (this host exposes no team API — measured precedent, 11-04 governance
  session + ADJ-7k). Three roles, separate passes, no cross-feeding; shared acceptance bar:
  decision-complete, every fact re-derivable by a stated command, machine-checkable acceptance
  per wave, consistent with the parent ledger, no scope creep.
- Gate (per skill): plan review → standard 3 roles (2 core + doc-audit lens).

## Role 1 · Correctness officer ("assume the plan is wrong")

- **C-1 HIGH — the plan locks its own repository.** W3 wires the lint into `agents check`;
  measured (`.githooks/pre-commit`): the hook IS an `agents sync → agents check` chain, and the
  ci chain reruns the same check. An error-level lint landing BEFORE W4 cleaned 37 stale verdicts
  fails every commit — including W4's own batches and W5-W7. Fix: two-stage wiring
  (report-mode land, strict at W4 exit).
- **C-2 HIGH — W4 exit criterion contradicts §0.** Demanding `grep -L "as of 2026-11-05"` return
  only the exemption set forces date-painting rewrites wherever evidence says "verdict survived,
  no rewrite warranted" — over-claim under gate pressure, the exact failure class this plan's §0
  exists to prevent (four T2-family occurrences on record). Fix: exit = disposition row per header
  (REWRITTEN / KEPT-HONEST-STALE / EXEMPT) + lint green on FORMAT invariants; staleness is a
  warn-level triage input, not an error.
- Dependency graph otherwise sound: W3 defines formats, W4 derives the list — no cycle.
- Not covered by this role: pixi-env runtime behavior; GitHub-internal schema rules beyond the
  observed annotation.

## Role 2 · Evidence officer (unproven claims)

- **P-1 MEDIUM — W1 acceptance cites a tool that does not exist.** `package.json` dependency scan
  (measured): no `js-yaml`/`yaml`. And a YAML parse cannot prove Actions-schema acceptance
  anyway; the authoritative check is W2's run graph. Narrow W1 acceptance accordingly.
- **P-2 MEDIUM — W2 silently assumes the run finishes inside the polling window and that run
  numbers stay stable.** 46 days of unexecuted CI ⇒ first real run may outlast historical
  durations; an intervening push from the concurrent session shifts numbers. Fix: record by SHA;
  define in-flight handling ("record, read in next interleave, never substitute an older run").
- **P-3 LOW — W1's "the case-convention most tooling reads" is an unsourced claim.** Strip it;
  keeping uppercase is convention, nothing more.
- Verified sound (this role checked): 46-day arithmetic (09-20 → 11-05); the 7-rewritten file
  list; doc-claim=0; cold-hours figures; `--self-test` precedent (rule-ref-lint.mts:22,189-201);
  public run pages readable without auth.
- Not covered: whether Actions accepts the file post-fix (that is W2's experiment, by design).

## Role 3 · doc-audit lens (self-consistency, carriers, numbering)

- **A-1 MEDIUM — triage artifact location contradicts the parent plan.** Landing the triage table
  in gitignored `.omo/reports/` re-creates the "coexisting carrier with no authority" the parent
  plan was written to end (its §1 inventory). Fix: `docs/superpowers/reports/`.
- **A-2 LOW — D-a…D-d collide with decisions.md D-numbering** in prose read by the same audience.
  Add a one-line disambiguation.
- **A-3 LOW — two measured facts missing from §0 inputs**: the pre-commit chain (the C-1 fact
  belongs in the Inputs table, not only in the finding), and the `agent-targets.json` "4 lints"
  registration layer W3's tool must join (becomes the fifth).
- Consistency pass clean: D122(1) phrasing matches decisions.md; S1 acceptance quotes match the
  parent phase row; "twelfth+ cuts" numbering continues the log correctly; non-goals restate the
  parent's tier boundaries without contradicting any R-ruling.

## Merge (lead, single pass, deduplicated)

CRITICAL 0 · HIGH 2 (C-1, C-2) · MEDIUM 3 (P-1, P-2, A-1) · LOW 4 (P-3, A-2, A-3, +triage
last-touch column). All six mechanical fixes were the lead's own drafting errors, not decisions →
folded into the plan immediately (precedent: 11-05 same-day self-review); none touches a
user-owned ruling.

## Conflicts preserved (majority smoothing banned) → handed to adjudication

- **X-1** (was D-b): after report-mode lands, does STRICT mode ride `agents check` — i.e.
  double enforcement via the measured pre-commit + CI Governance Gates chain — or stay local?
  Both roles see the value differently: CI enforcement polices the mirror itself (nicest), but
  it makes every future push hostage to header freshness warnings-turned-errors; the third role
  notes CI already reruns check, so strict-in-check = the mirror audits doc debt on every push.
- **X-2** (was D-c): W4 authorization granularity — per-batch confirm (plan default, ~5-8
  headers × ~5 batches) vs one sanction for the whole wave vs first-batch-then-continue-unless-
  triage-categories-change.

## Locked without a ruling (endorsed by all three passes)

- D-a register-only handling of W2 failures; D-d run-time exemption derivation + fixtures;
  batch order cold→hot now backed by the last-touch column; report-first wiring as the C-1
  mechanism fix (the strict-location residue went to X-1).

---

# Panel review round 2 (re-review of the revised plan, rulings X-1=A / X-2=C landed)

Same three roles, fresh sequential passes over the revised text. Adversarial brief unchanged.

## Correctness officer

- **R2-C1 HIGH — the strict error bar reopened C-2 at the parser level.** Measured: 44/44 status
  lines carry a date, but only 7 use the `as of` spelling; legacy forms are
  `(2026-09-23 gap audit)` / `(…, updated 2026-10-08)`. An error-level "`as of` date parseable"
  rejects every KEPT-HONEST-STALE header — the very disposition round 1 declared legal. Folded:
  error = missing line / no ISO date in ANY spelling; the full `(as of, evidence:)` shape binds
  REWRITTEN headers only.
- **R2-C3 MEDIUM — strict-flip commit ordering.** With X-1=A (strict inside `agents check`, which
  pre-commit runs), a flip commit separate from and earlier than the final header cleanup would
  red its own pre-commit. Folded: the flip ships inside W4's exit commit; W3 lands report-mode
  only.

## Evidence officer

- **R2-P1 verified (passes):** the 7 rewritten headers carry `as of 2026-11-05, evidence` — 7/7 by
  per-file grep count; W3's claimed convention is real, not aspirational. Both round-1 input
  rows (pre-commit chain, 4-lints registry) re-verified against their sources.
- Not covered: whether registering the fifth lint needs an entry point beyond
  `agent-targets.json` (read at execution; plan says so).

## doc-audit lens

- W4's heading still read "one confirmation per batch" after X-2=C — fixed in fold.
- Bookkeeping gap found: the plan + review rounds had no commit wave of their own — folded as
  **W0** (parent precedent `fdf8cc2`: plans and reviews live in the tracked truth surface).
- Round-1 text kept intact; round 2 appended — snapshot doctrine honored.

## Round-2 merge & disposition

HIGH 1 (R2-C1) · MEDIUM 2 (R2-C3, W4 heading) · LOW 1 (W0 bookkeeping) · verification passes 2.
All are mechanism fixes on the lead's own drafting — folded without rulings; no user-owned
decision touched; **no new conflict items**. Ladder state: X-1=A, X-2=C, D-a/D-d confirmed, both
rounds folded → plan is decision-complete for W0/W1; W2 stays gated on the push word.
