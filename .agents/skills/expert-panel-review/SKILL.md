---
name: expert-panel-review
description: "多角色专家团审核一份计划/结论/决策：先独立后合并、隔离视角、必设对抗者、保留分歧、按复杂度设闸。Ported from RCH D22 and rewritten for this repo. Use when reviewing a plan, a design decision, or a batch of rulings before execution — or when the user says 复审/专家团/审查这份方案."
---

# expert-panel-review — multi-role panel review engine

> The panel's value is not headcount, it is INDEPENDENCE. Every design choice
> below exists to manufacture and protect perspective differences (the enemy:
> consensus illusion). Ported from RCH D22 (2026-11-03); rewritten for
> AccessBase's command surface and skill set.

## When to open a panel (complexity gates)

| Situation | Gate |
|---|---|
| 1-file fix, single-concern doc edit | NO panel — direct review |
| Plan / decision / cross-batch ruling review | Standard: 3 roles (2 fixed core + 1 mounted) |
| Architecture-level or security-critical review | Deep: 4-5 roles (2 core + 2-3 mounted) |

Burning 15x tokens (community evidence) on a 1-file review is an anti-pattern,
not diligence.

## Dual-track adaptation (pick by host capability)

- **Sequential track (DEFAULT)** — for hosts without `team_create` (CodeBuddy
  sessions, single-agent runs). One agent plays each role in SEPARATE passes.
  Isolation discipline is what keeps this honest:
  - each role receives ONLY the artifact under review + its adversarial brief
    + the shared acceptance criteria;
  - NEVER feed one role a previous role's conclusions (that is how consensus
    illusion starts);
  - each pass locks its output in a fixed shape: findings + evidence
    (file:line) + confidence + explicitly-not-covered list.
- **Parallel track (opt-in)** — hosts with team mode: 3-5 read-only members,
  no git writes, each in its own context. Same briefs, same output shape.

## Fixed core roles (always present)

1. **Correctness officer** — "Assume the conclusion is WRONG and try to
   falsify it." Hunt mechanism contradictions, broken invariants, circular
   dependencies, technical impossibilities.
2. **Evidence officer (devil's advocate)** — hunt UNPROVEN claims: assertions
   without a command output, coverage claims without a failing-case demo,
   "it works" without a verification trail (CONSTRAINTS.md verification
   discipline applies to review claims too).

## Scenario-mounted lens roles (reuse existing skills — never invent new ones)

| Review target | Mount |
|---|---|
| Security-sensitive surface | `security-hardening` lens |
| API / contract shape | `api-interface-design` lens |
| UI consistency claims | `design-system` lens |
| Document/plan self-consistency | `doc-audit` lens (numbering, cross-refs, dependency graph) |

## Four-layer division (who does what)

- `think-before-act` — WHETHER to act / whether to convene a panel at all
- **this skill** — HOW to run the panel review
- `adjudication-walkthrough` — how DISAGREEMENTS and findings are presented
  for the user's one-by-one rulings
- `doc-audit` — parallel lane (periodic document audits), does not call this
  skill

## Output discipline (lead, single merge pass)

1. Merge all role outputs ONCE; dedupe; grade CRITICAL → LOW.
2. DISAGREEMENTS BETWEEN ROLES ARE PRESERVED as conflict items. Majority-vote
  smoothing is BANNED — a disagreement is information, not noise.
3. Hand off the graded list to `adjudication-walkthrough` (one ruling at a
   time).
4. Record the run in `.omo/reports/` (English, dated): roles, per-role
   findings, merge result, conflict items.

## Red flags (abort or escalate)

- A role returns "looks good, no findings" in under a minute of real reading —
  re-brief it adversarially or mount a different lens.
- The panel converges instantly and unanimously on a complex artifact —
  suspect context leakage between passes; re-run the leaker role isolated.
- Findings cite no file:line and no command output — evidence officer failure.

## Anti-excuse table

| Excuse | Answer |
|---|---|
| "It's just a doc, no panel needed" | The gate table decides, not the artifact type |
| "I already know the answer, the panel is theater" | Then produce the falsification pass solo — skipping the adversarial brief is the failure mode |
| "Roles will repeat each other" | They repeat only when isolation leaked; fix the isolation, don't drop the roles |
| "Disagreement means the panel failed" | Disagreement is the product; smooth it in adjudication, not in the panel |
