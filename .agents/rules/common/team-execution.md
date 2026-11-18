# Team Execution Discipline — delegation hard edges

> SCOPE: this rule is ACTIVE ONLY during team-execution / delegated
> implementation scenarios (inspection, planning, PR review are not affected).
> It is always-on in the instruction face by design (ruling 2026-11-17
> post-panel #1, option C: ~35 lines ≈ 1% of the face) but self-limiting in
> application — same as every other rule here. Adopted from shadcn/improve
> mechanisms (ruling #10, user 5xA at the donor), rewritten in our vocabulary.

## 1. Weakest-executor plan standard

Write the plan for the COLDEST executor who will read it:

- Self-contained: inline exact paths and short excerpts. "As mentioned above"
  is a defect, not a reference.
- Each step ends with a COMMAND + EXPECTED OUTPUT (machine-checkable
  completion), not a verb like "verify" or "ensure".
- Explicit HARD BOUNDARIES: out-of-scope list and STOP conditions (what to do
  when reality diverges — reconcile, do not improvise).
- Stamp the baseline commit ID on the plan and check for drift before start.
- Micro-batch exemption (landing + gate columns only) when the whole task is
  one reversible file with no cross-surface effect.

## 2. Reconcile-before-start — four questions

Before executing ANY delegated step:

1. Did the baseline move? (git diff against the stamped commit)
2. Are the prerequisites still true? (a gate that was green may be red now)
3. Did someone else already fix the finding independently? (check the log)
4. Is the touch surface still clean? (no concurrent edits on target files)

Any "no" → reconcile with the plan owner BEFORE proceeding. Do not push
through a stale plan; that is how a correct plan produced from a stale state
becomes a wrong change.

## 3. Bounded send-back

For delegated execution results, three verdicts only:

- **approve** — accept and proceed;
- **send-back** — at most TWO rounds, each with the exact failing evidence
  and required change;
- **block-and-refine-plan** — after two failed rounds, the defect is in the
  PLAN, not the executor. Rewrite the plan; do not send a third round.

User collaboration iterations (user ↔ lead) have NO round limit — the cap
applies only to lead ↔ delegated-executor loops.

## Thin-slice discipline (G1-3, mechanism from donor incremental-implementation)

Multi-file/multi-package work lands in THIN VERTICAL SLICES: implement →
test → verify → commit, one slice at a time, **each slice leaving the
workspace compilable and gates green**. A slice that cannot stand green on
its own is not a slice — it is half a change parked in the working tree.
Slices own their verification gates; never commit a slice that depends on a
future slice to pass.

## 4. Small-fix-no-ceremony

A one-line, reversible, single-surface change does NOT get a team, a panel,
or a proposal card. YAGNI applies to process itself (routing matrix in
`expert-panel-review` complexity gates).

## No re-delegation

A delegated member does not spawn further sub-agents. If a subtask needs a
different role, it returns to the lead and the lead re-routes (this repo's
team protocol: members are read-only or bounded-write, never recursive).

Check: on any delegation, verify the brief contains items 1-3 above; if not,
return it for refinement before the first execution step.
