# Repo Audit — Quick #1 (2026-11-18, RA-1818 first run)

> First Quick audit after the repo-audit port (RA-1818-1). Three-state tags.
> Evidence = layer summaries (this run's live output) + the manual commands
> recorded inline. Dismissals: none yet (first run).

| # | Domain | Tag | Evidence |
|---|---|---|---|
| 1 | skills | gate-green | skill-lint: `clean (18 dirs / 17 active, 1 tombstone, 10 checks each)` |
| 2 | rules | gate-green | rules-links: `clean (81 rules)` |
| 3 | mcp | gate-green | gate-mcp: `green (5 pins ok; latch-pair intact)` |
| 4 | scripts | gate-green + 1 gap fixed live | scripts-lint: `20 scripts parse clean; 0 orphan`; CRLF=0 (file probe); shebang 3/3 sampled; exec-bits: pg-url.sh + sync-official-refs.sh missing u+x → FIXED live (chmod); _common.sh exempt (sourced library) |
| 5 | docs | gate-green (partial owner) | header-lint `0 error, 22 warn` (freshness WARNs are triage input, non-blocking); links spot-check: 0 dead relative links in sampled plans |
| 7 | cli | manual-judgment-ran | usage↔command spot audit: 29 subcommands present in accessbase.sh dispatch; no missing-entry signal |
| 9 | structure | manual-judgment-ran | unexpected top-level dirs: NONE (whitelist diff empty) |
| 10 | naming | manual-judgment-ran | case-collision probe: 0 same-directory case-insensitive duplicates (first probe was cross-directory basename — dismissed as a predicate artifact, PIT-097 shape, corrected same run) |
| 11 | agents/teams | coverage-gap BY DESIGN | runtime-only teams dir; pointer row lives in DEFERRED.md |

Domain 6 (book): pointer to 11-04 Batch 6 exemplar (deferred with trigger).

## Findings (gatekeeper-passed)

| Sev | Domain | Finding | Disposition |
|---|---|---|---|
| LOW | 4 | two scripts lacked exec bits | FIXED live (this run); pattern noted for the audit's gap-check list |
| LOW | 4 | CRLF/shebang/exec are audit gap-checks, not gate-owned | recorded in domain table; candidate for a future scripts-lint extension (proposal-card input, NOT auto-executed) |

## 2D eight-asset snapshot (counting commands, no literals trusted)

skills 18 dirs/17 active (skill-lint) · rules 81 (rules-links) · mcp 7
registered/4 enabled (mcp-links) · scripts 20 (scripts-lint) · memorys 4 books
· constraints hub · plans register · donor ledger (rows live in
`docs/reference/donor-ledger.md`).

## 3D increment

Baseline run — no previous result to diff. Next run diffs against this file
(git history = time series). Deferred-relevant rows LINK to
`docs/superpowers/DEFERRED.md`.
