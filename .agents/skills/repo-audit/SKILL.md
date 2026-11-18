---
name: repo-audit
description: "Whole-repo engineering audit across the mapped domains + governance inventory (2D eight-asset, 3D increment table) + external scan (2B adoptable skills/rules/MCP, 2C practice scan). Quick daily / Full deep. Use when the user says 审计/全仓审计/audit the repo, or for the evolution protocol's recurring discovery turn. Supersedes ecosystem-scan (tombstoned)."
---

# repo-audit — whole-repo audit + ecosystem scan (discovery engine of the evolution protocol)

> Ported from MediaServo's repo-audit (which evolved VisiaEngine's original),
> ruling RA-1818-1, 2026-11-18. Mechanism-level rewrite in this repo's
> vocabulary; the donor's reading rule is kept as a slogan (ledgered).

## Governing principle: gates-first

This repo's enforcement chain is dynamic (`bash accessbase.sh agents status`
prints the roster; the census canary requires the full roster in any green
run). **The audit never re-checks by hand what a gate proves.** It (a)
verifies every surface HAS an enforcement owner, (b) runs gap checks where no
gate exists, (c) spends deep analysis only where judgment is needed.

## Domains (mapped to THIS repo; three-state tagging)

Every Quick run tags each live domain: **gate-green** (owner verified green —
skip), **manual-judgment-ran** (no gate by design; judgment exercised and
recorded), **coverage-gap** (no owner, no judgment — a real hole).

| # | Domain | Surface | Owner (see plan's corrected table) |
|---|---|---|---|
| 1 | skills | `.agents/skills/` | skill-lint + skills-index |
| 2 | rules | `.agents/rules/` | rule-ref-lint + rules-links |
| 3 | mcp | single source + 2 faces + mcp-* | gate-mcp |
| 4 | scripts | `scripts/` | scripts-lint (syntax+orphan); CRLF/shebang/exec-bits = audit gap-checks |
| 5 | docs | `docs/` | header-lint (WARN) ; links = manual |
| 6 | book | — | pointer to 11-04 Batch 6 deferred exemplar |
| 7 | cli | `accessbase.sh` + pixi tasks | manual (scripts-lint scope is `scripts/` only; USAGE↔pixi sync manual) |
| 8 | tests | vitest + e2e | ci census + coverage floors |
| 9 | structure | repo tree | manual (root pollution ≠ check-leaks semantics) |
| 10 | naming | files/tasks/branches | partial gate; case-collision manual |
| 11 | agents/teams | `.codebuddy/teams/` (runtime) | coverage-gap by design → deferred register |

Quick mode: the NINE live domains (1-5, 7-10), each tagged. Full mode: adds
governance inventory + external scan + security lens.

## Modes

- **Quick** (daily-shape; donor figure <30s): nine-domain fast audit. Output:
  one line per domain with its tag + one-sentence evidence (layer summary
  quote or manual-judgment note).
- **Full** (deep): everything Quick does, plus 2D/2D-inventory, 3D increment
  table, 2B/2C external scan, and the `skill:security-hardening` lens over
  auth/key surfaces.
- **Single-domain deep dive**: `/repo-audit <domain>` for one domain's full
  treatment.

## Governance inventory

- **2D eight-asset table**: skills / rules / mcp / scripts / memorys (4
  books) / constraints hub / plans register / donor ledger — count with
  commands, never quote literals (ADJ-7h).
- **3D increment table**: columns Asset / Current / Gap / Candidate /
  Landing / Cost / Gate. Diff against the previous run's result stored at
  `docs/superpowers/reports/repo-audit-latest.md` (git history = time
  series). Donor's quarterly-quota cells are STRIPPED per our
  `rule:evolution-protocol` (per-batch anchors only). Deferred-relevant rows
  LINK to `docs/superpowers/DEFERRED.md` (the register owns trigger fields;
  this table never duplicates them).

## External scan (2B/2C — absorbs the tombstoned ecosystem-scan duty)

- **2B adoptables**: external skills/rules/MCP worth adopting — each becomes
  a proposal-card INPUT (the evolution protocol rules on adoption; this skill
  never executes adoption).
- **2C practice scan**: community practices (workflows, doc systems,
  conventions, tooling) — mechanism-level observations only.

## Gatekeeper pass + dismissal log (report discipline)

Before any report leaves this skill: re-open every cited file:line and re-run
every cited command. A finding that fails its own evidence is a FALSE
POSITIVE — record it WITH THE REASON in
`docs/superpowers/reports/repo-audit-dismissals.md`. The NEXT run reads that
log first and never re-investigates a dismissed finding unless new evidence
appears. One false positive is investigated exactly once.

## Output

Per finding: severity (CRITICAL/HIGH/MEDIUM/LOW) | domain | evidence
(file:line or command output) | suggested disposition. Disagreements between
lenses are preserved, never majority-smoothed. Coverage-gap findings feed
proposal cards (the closed loop's intake); they are never auto-executed.

## Relations

Discovery (this skill) → design/selection (`skill:think-before-act` +
`skill:adjudication-walkthrough`) → execution (`skill:mechanism-porting`).
Document self-consistency alone belongs to `skill:doc-audit`; this skill's
doc pass is domain 5 within the whole-repo frame.
