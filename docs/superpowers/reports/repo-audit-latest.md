# Repo Audit — **FULL #1** (2026-11-18, Quick #2 + Full increments; superseded header kept below)

> Second Quick audit (repo-audit live). Increment table at the bottom diffs
> against Quick #1 (`git log` on this file = time series).

| # | Domain | Tag | Evidence |
|---|---|---|---|
| 1 | skills | gate-green | skill-lint: `clean (18 dirs / 17 active, 1 tombstone, 10 checks each)` |
| 2 | rules | gate-green | rules-links: `clean (81 rules)` |
| 3 | mcp | gate-green | gate-mcp: `green (5 pins ok; latch-pair intact)` |
| 4 | scripts | gate-green | scripts-lint `20 parse clean; 0 orphan`; CRLF=0; **exec-bits regression: NONE** (Quick #1 fix held); shebang sampled 3/3 |
| 5 | docs | **gate-green (FULL)** | header-lint `0 error, 22 warn`; **links NOW MACHINE-CHECKED** (docs-links layer landed this Full run — donor check_docs_links adopted per DEFERRED trigger; 131 files 0 broken; 5 book-to-skill template refs allowlisted) |
| 7 | cli | manual-judgment-ran | subcommand dispatch present; census semantics unchanged |
| 9 | structure | manual-judgment-ran | 14 top-level dirs: 6 new-since-#1 CLASSIFIED — 5 runtime artifacts correctly IGNORED (coverage/data/keys/playwright-report/test-results), 1 tracked deploy config CORRECT (docker/, 3 files); check-leaks corroborates (0 tracked-and-ignored). Quick #1's whitelist grep was a predicate artifact — precise classification run this time |
| 10 | naming | manual-judgment-ran | same-directory case-collision probe: 0 (cross-directory basename artifact corrected in #1, held) |
| 11 | agents/teams | coverage-gap BY DESIGN → **CHANGED** | role layer LANDED (RT-1818-B1): 10 roles + agent-lint + tracked projection — domain 11 is now gate-green |

Domain 6 (book): pointer unchanged (deferred with trigger).

## Findings (gatekeeper-passed)

| Sev | Domain | Finding | Disposition |
|---|---|---|---|
| INFO | register | DEFERRED row-1 trigger SATISFIED AND ACTED ON (role layer landed RT-1818-B1) | row CLOSED with DONE marker — first register closure ever |
| LOW | register | PARITY ledger had 38 rows vs 37 donor — 1 = skill-creator (OURS-ONLY, legit) + 1 = table-header parse artifact | ledger annotated; counting rule now distinguishes ours-only rows |
| — | 4 | Quick #1's exec-bit fix held; whitelist grep was under-reporting | precise classification replaces whitelist grep going forward |

## 2D eight-asset snapshot

skills 18 dirs/17 active/1 tombstone · rules 81 · mcp 7/4 · scripts 20 ·
memorys 4 books · constraints hub · plans register · donor ledger · **NEW:
DONOR-PARITY ledger (four-state, 37 donor assets + ours-only)** · **NEW:
DEFERRED register (16 rows, first closure recorded)** — the eight-asset
inventory grew by two registers this cycle (RA-1818 landed them).

## 3D increment (vs Quick #1)

- Domain 11: coverage-gap → **gate-green** (role layer landed) — first
  domain transition ever recorded.
- Domain 9: predicate upgraded (whitelist grep → precise classification);
  classification result: all clean.
- Registers: +2 (DONOR-PARITY, DEFERRED now tracked files with gates).
- DEFERRED: 16 rows, 1 closed (row-1), 15 open with triggers.
- New this cycle (since #1): role layer, agent-lint, roles-links, DONOR-PARITY,
  DEFERRED register, evolution-protocol retirement section,
  think-before-act failure-localization section, team-execution thin-slice,
  repo-audit entry-triage, serena+roles projections, MCP_NO_INSTALL guards
  on 5 wrappers.

## Security lens (Quick-lite)

gate-mcp dep-drift watch green; MCP_NO_INSTALL guards landed on all five
wrappers; PIT-090 watch outside pnpm tree (serena cache) — no recurrence.

## Boundaries

Not covered (Quick scope): 2B/2C external scan, security deep lens, book
domain (deferred), llms.txt — all Full-mode or deferred items.


---

## FULL #1 increments (2026-11-18, same day as Quick #2)

- **Domain 5 conversion**: links check manual → MACHINE (docs-links.mts, 15th
  layer). Donor tool adoption #1 — the DEFERRED tooling-batch trigger fired
  and was honored within the same session it was created.
- **Donor tool adoption**: check_docs_links mechanism ported (fence-strip,
  relative-target existence, allowlist file, self-test pairing); 5 template
  refs allowlisted (book-to-skill future artifacts). Donor 130-line python →
  our .mts idiom.
- **Implementation notes** (fixed live): block-comment `*/` termination
  (docs/**/*.md in prose); Python inline-flags regex `(?ms)` not valid JS →
  `/gms`; CRLF heredoc single-line replacement discipline.
- **Quick #2 increments all held**: domain-11 gate-green (roles), register
  closures, PARITY classification.
- 2B/2C external scan (Full duty, boundary recorded): donor parity ledger IS
  the 2B inventory (37 assets fully adjudicated); 2C community-practice scan
  deferred until an external-ecosystem session (donor update event) — recorded
  honestly rather than fabricated.

## Security lens (Full)

gate-mcp dep-drift green; MCP_NO_INSTALL on 5 wrappers; PIT-090 watch clean;
no secrets in tracked faces (check-leaks 0).
