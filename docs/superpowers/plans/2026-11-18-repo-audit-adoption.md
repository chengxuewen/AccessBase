# Repo-Audit Adoption + Backlog-Exit Plan (v2, panel-revised)

> **Scale figures here are point-in-time (2026-11-18) with counting commands.**
> Recount, never trust the literal (ADJ-7h): skills `ls .agents/skills | wc -l`,
> rules/scripts/layers from `bash accessbase.sh agents check` layer summaries.
> Layer count is DYNAMIC — `bash accessbase.sh agents status` prints it; this
> plan deliberately quotes no layer literal (CONSTRAINTS.md rule).

> **Provenance:** drafted 2026-11-18 from the evolution protocol's event
> triggers (donor update + user finding on the deferred graveyard). v2
> (same day) folds in the ra-panel review (3 read-only officers, parallel
> track; 5 CRITICAL + 4 HIGH + 4 MEDIUM, all closed in this revision — per-item
> mapping in the Amendments table below).

**Date:** 2026-11-18
**Status:** ADJUDICATED (rulings RA-1818-1..3 below) — panel-revised v2.
Execution NOT yet sanctioned; RA-1..RA-4 may run as one session on one "go".
**Donor:** `.refinfo/MediaServo/.agents/skills/repo-audit/SKILL.md` (411
lines, wc -l). Lineage: introduced in VisiaEngine at `158565a` (2026-09-03)
at 311 lines; MediaServo adopted and evolved it to the current 411 — the
delta is donor-side maturation, so the blueprint of record is the MS version
(donor's own ledger entry: "donor VisiaEngine, adapt", no hash). License:
VE root carries dual LICENSE-MIT + LICENSE-APACHE — clean; ledger row due at
landing.

## Proposal card (five elements, retroactively completed per panel C-4)

| Element | Content |
|---|---|
| Options + recommendation | 1-A full port + retire ecosystem-scan (RECOMMENDED) / 1-B port + coexist / 1-C merge fragments into doc-audit. 2-A reuse-first rides along (RECOMMENDED) / 2-B separate batch / 2-C decline. 3-A antd guard now (RECOMMENDED) / 3-B defer with trigger / 3-C fix + re-enable (rejected: re-enable is user-reserved) |
| Source evidence | Donor files measured (411/83 lines); MS status ledger records the B1b-1 ecosystem-scan retirement and the R2 net-0 replacement; AccessBase surfaces verified via layer summaries. The 2026-11-17 analysis-panel inputs are DISTILLED ONLY (full text unpersisted — recorded as C-3 in `docs/superpowers/reports/2026-11-17-ms-increment-panel-review.md`) |
| Strategy tag | **harden** (all three: closed-loop discovery engine, reuse guard, PIT-090 family disarm — no new judgment path claimed) |
| Pre-registered recheck | Existing gates only: skill-lint/TRIGGERS bidirectional green; agents check full-roster exit 0; first Quick audit = 9 live domains each tagged (three-state, see RA-1); ci census pass=4 |
| Ruling IDs | **RA-1818-1 / RA-1818-2 / RA-1818-3** (all ruled A, 2026-11-18) — the first commit of each batch cites its ID |

## Baseline findings (revised per panel)

1. The 2026-11-17 distillation demoted repo-audit to P2 fragments (the two
   mechanism names survive verbatim in `.omo/plans/2026-11-17-ms-increment-adoption.md`
   Open items) while dropping the 411-line host; a hidden assumption that
   ecosystem-scan "covered auditing" ignored the donor's own replacement
   evolution. (Input reports: distilled, unpersisted — see proposal card.)
2. The evolution protocol (G3, 2026-11-17) lacks its discovery engine: no
   2B/2C pattern cards, no recurring audit carrier.
3. The deferred graveyard is exit-less (exception: 11-04 Batch 6's three
   items carry triggers — the exemplar; the Qoder gated bundle carries an
   unlock condition).
4. **PIT-090 family is armed on the ENABLED surface**: FIVE self-healing
   installers ship in `.opencode/init-mcp-*.mjs` (playwright, codegraph,
   drizzle mutate the root pnpm tree and are enabled; antd same shape,
   disabled; postgres installs into `.opencode/`'s subtree). Additionally the
   opencode host face launches them directly (`pixi run node …`) WITHOUT
   passing through `scripts/agents/mcp-launch.sh` — any launcher-exported
   guard is invisible to that face.

## Adjudication record (2026-11-18)

| ID | Point | Ruling |
|---|---|---|
| RA-1818-1 | repo-audit adoption | **A** — full adapt port; RETIRE ecosystem-scan (tombstone, net-0 active quota); gatekeeper pass + dismissal log + 2D/3D inventories come WITH the skill; gates-first cites the dynamic layer roster |
| RA-1818-2 | reuse-first | **A** — same batch; charter summary attributed into docs/reference |
| RA-1818-3 | PIT-090 family disarm | **A** — scope CORRECTED by panel: `MCP_NO_INSTALL` branch in ALL FIVE init wrappers (not antd-only); launcher export retained for the GUI face; opencode face explicitly EXEMPTED (documented, with the reason: that face's launch path bypasses the launcher — closing it means re-plumbing the opencode projection, deferred as its own card); `mcp-cli.mts` header contract updated in the same change. antd STAYS disabled; re-enablement remains the user's ruling |

## Domain mapping (corrected per panel H-1)

> Reading rule (donor slogan, kept deliberately — ledgered): if the
> enforcement owner is green, that domain's mechanical health is proven.
> Three-state tagging (panel M-1): **gate-green** / **manual-judgment-ran** /
> **coverage-gap** — manual is a legitimate state, not a gap.

| # | Domain | AccessBase surface | Enforcement owner HERE |
|---|---|---|---|
| 1 | skills | `.agents/skills/` | skill-lint + skills-index (gate-green) |
| 2 | rules | `.agents/rules/` | rule-ref-lint + rules-links (gate-green) |
| 3 | mcp | single source + 2 faces + mcp-* | gate-mcp (gate-green) |
| 4 | scripts | `scripts/` | scripts-lint syntax+orphan (gate-green); **CRLF/LF, shebang, exec-bits = scan-run gap-checks (assigned to the audit, not to a gate)** |
| 5 | docs | `docs/` | header-lint freshness (gate-green, WARN-level); links = manual-judgment |
| 6 | book | N/A | pointer to 11-04 Batch 6 deferred exemplar |
| 7 | cli | `accessbase.sh` + pixi tasks | **manual-judgment** (scripts-lint covers `scripts/` only — accessbase.sh is NOT in its syntax scope, it appears only as reference corpus; USAGE↔pixi sync is manual) |
| 8 | tests | vitest + e2e | ci census + coverage floors (gate-green) |
| 9 | structure | repo tree | **manual-judgment** (root-pollution adjacent to check-leaks but distinct semantics — tracked-and-ignored ≠ pollution) |
| 10 | naming | files/tasks/branches | partial gate (lint); case-collision = manual-judgment |
| 11 | agents/teams | `.codebuddy/teams/` (runtime only) | coverage-gap by design → deferred register pointer |

2D eight-asset inventory: skills, rules, mcp, scripts, memorys (4 books),
constraints hub, plans register, donor ledger. 3D increment table: diff
against `docs/superpowers/reports/repo-audit-latest.md` (git history is the
time series). **Donor-adaptation note (panel M-2): strip donor quarterly-
quota cells/fields (2D "net ≤2 per quarter" etc.) — our protocol forbids
inherited per-quarter anchors; the 3D schema keeps Asset/Current/Gap/Candidate/
Landing/Cost/Gate columns and DEFERRED-relevant rows LINK to the register
rather than duplicating trigger fields.**

## Batches (v2)

### RA-1 — repo-audit port + ecosystem-scan tombstone + routing sweep

- Deliverables: adapted SKILL.md (domain table above, Quick <30s donor figure
  / Full deep + 2B/2C, gatekeeper pass + dismissal log, three-state tagging);
  **tombstone template per lint reality**: `status: inoperative` + description
  = "INOPERATIVE — superseded by repo-audit … Use when the user asks to scan
  the ecosystem (routes to repo-audit 2B/2C)" (satisfies checks 3/4/5: ≥20
  chars, trigger word, INOPERATIVE prefix); AGENTS.md row KEPT, Purpose cell
  rewritten; TRIGGERS row kept, owner re-pointed to `skill:repo-audit`;
  **routing sweep** (5 live references to the dead skill): skills-router.md
  (×3 sections), skill-router SKILL.md, think-before-act SKILL.md,
  mechanism-porting SKILL.md (discovery now points to repo-audit 2B/2C);
  skill-lint summary gains an ACTIVE count alongside the directory count
  (tombstone-aware instrument, panel H-3); donor-ledger row declaring BOTH
  the domain-table template reuse AND the verbatim reading-rule slogan.
- Acceptance: skill-lint green — summary prints directories AND active
  counts (16 active + tombstone on disk); TRIGGERS bidirectional green;
  first Quick audit: 9 live domains, each tagged gate-green / manual-ran /
  gap; red/green: planted missing TRIGGERS row → RED.

### RA-2 — reuse-first port

- Deliverables: adapted SKILL.md (four-step chain); attributed charter
  summary in `docs/reference/reuse-first-charter.md`; TRIGGERS row.
- Acceptance: skill-lint green (both counts); V3 spot-check EXTENDED here:
  TRIGGERS row + charter file exists and carries attribution.

### RA-3 — deferred registry + supersession + audit-hook reconciliation

- Deliverables: `docs/superpowers/DEFERRED.md` — the register IS the single
  authority going forward (panel H-4 option i): five mandatory fields (full
  shape / source / drop reason / REOPEN TRIGGER / recheck carrier), seeded
  from the itemized appendix below; **supersession pointers** added to BOTH
  old plans' open-items sections (AMENDED-style, originals kept): 11-04 and
  `.omo/plans/2026-11-17-ms-increment-adoption.md`; **doc-audit SKILL.md
  amended**: dimension-4 gap-list authority line updated from
  "implementation-plan.md is the only authority" to name DEFERRED.md for
  governance-class deferrals, and a new check item for five-field
  completeness (machine-checkable: non-empty cells).
- Acceptance: register rows == appendix item count; both old plans carry
  pointers; doc-audit amended; agents check green.

### RA-4 — PIT-090 family disarm (scope corrected per panel)

- Deliverables: `MCP_NO_INSTALL` branch in **ALL FIVE** init wrappers
  (missing binary → stderr + exit 1, never install; version-mismatch check
  is NET-NEW logic, implemented once and shared verbatim); legacy self-heal
  path retained with a loud PIT-090 warning; `scripts/agents/mcp-launch.sh`
  exports the var (GUI face guarded); **opencode face exemption documented**
  in the single source note + registered as its own deferred card
  ("opencode-face launcher re-plumbing"); `scripts/agents/mcp-cli.mts`
  header contract updated (wrappers are no longer unconditional self-healers).
- Acceptance (red/green): simulated missing binary under the var in each of
  the three ENABLED wrappers → exit 1, pnpm tree untouched (lockfile sha
  compared); without the var → self-heal warns. antd remains disabled.

## Verification plan

- **V1** batches land → `bash accessbase.sh agents check` full roster exit 0;
  `bash accessbase.sh ci` census pass=4 fail=0 skip=0.
- **V2** first Quick audit → `docs/superpowers/reports/repo-audit-latest.md`;
  9 live domains three-state tagged; findings feed proposal cards.
- **V3** tombstone + routing sweep spot-check (no live route to the dead
  skill; TRIGGERS/AGENTS rows coherent); RA-2 charter + attribution.
- **V4** RA-4 demo outputs recorded here.
- **V5** DEFERRED.md row count == appendix; both old plans superseded-true.

## Appendix — deferred-register seed list (panel C-5: the count's authority)

From `.omo/plans/2026-11-17-ms-increment-adoption.md` Open items (11): role
layer+quota+agent_lint+check_quotas bundle; per-field dialect probing; MCP
same-name/user-level detection+probe fields; unslop AI-look taxonomy;
prototype governance (README brief + location); self-driven screenshot loop;
computed-style assertions; plan soft-close; repo-audit gatekeeper+dismissal
log; reuse-first charter; duty roster. — Of these, TWO are absorbed by this
plan (gatekeeper+dismissal → RA-1818-1; reuse-first → RA-1818-2): net 9
remain.
From `docs/superpowers/plans/2026-11-04-agent-governance-port.md`: Batch 6
exemplar trio (mdBook / llms.txt / spec-trace — each WITH trigger); Qoder
gated bundle (7b+7g+7j, unlock = Qoder host present); scripts/agents
type-check path (deferred-to-user); memory-bridging (ADJ-7i). — 6 items.
New this plan: opencode-face launcher re-plumbing. — 1 item.
**Register seed total: 16** (9 + 6 + 1; counting rule stated here, rows are
the authority at landing).

## Execution log (filled on landing)

**EXECUTED 2026-11-18 — RA-1..RA-4 landed; V1/V2/V3/V5 green; V4 green; ci
typecheck gate RED on pre-existing business debt (details + disposition
below).**

- **RA-1**: repo-audit skill landed (mechanism-level rewrite, corrected
  domain table, three-state tagging, gatekeeper pass + dismissal log, 2D/2C,
  3D links to the register). ecosystem-scan tombstoned per template
  (INOPERATIVE prefix + trigger word + ≥20 chars — checks 3/4/5 green).
  Routing sweep: 5 live references re-pointed (skills-router ×3,
  skill-router, think-before-act, mechanism-porting — 0 residue). TRIGGERS:
  re-point + new repo-audit row + tombstone row kept (bidirectional check
  caught the missing tombstone row live — second time the check earns its
  keep on its own authors). skill-lint summary now dual-count
  (`18 dirs / 17 active, 1 tombstone` — panel H-3 instrument fix). Ledger
  rows for RA-1818-1/-2 with declared slogan overlap + stripped
  quarterly-quota note.
- **RA-2**: reuse-first landed (four-step chain) + attributed charter +
  TRIGGERS row. V3 spot-check: charter exists with attribution.
- **RA-3**: `docs/superpowers/DEFERRED.md` seeded (16 rows, five fields,
  counting rule in-file); supersession pointers appended to BOTH old plans
  (AMENDED-style); doc-audit L3b authority reconciled (engineering-health vs
  governance-class split) + five-field completeness check added. V5: 16 rows
  counted.
- **RA-4**: MCP_NO_INSTALL hard guard in ALL FIVE wrappers (playwright +
  codegraph via batch pattern; drizzle/antd/postgres via precise edits after
  the batch pattern missed their template-literal shapes). Launcher exports
  the var (GUI face); opencode-face exemption documented + registered as
  its own deferred card; mcp-cli header contract updated. V4 red/green:
  first demo attempt was a PREDICATE MISS (binaries existed — `!existsSync`
  never true; no positive sample constructed — PIT-097 shape No.6, corrected
  same run via fake-path injection): four enabled wrappers → rc=1 with
  guard message, pnpm-lock sha `efb7cf8d…` UNTOUCHED throughout.
- **V1**: agents check full roster exit 0 (all layer summaries; dual-count
  instrument verified). **V2**: first Quick audit landed at
  `docs/superpowers/reports/repo-audit-latest.md` — 9 live domains
  three-state tagged; one LOW fixed live (exec bits); one predicate artifact
  dismissed and corrected in-run.
- **ci disposition**: census shows `typecheck FAIL (pass=0 fail=1 skip=3)`.
  22 errors in apps/server + packages/identity (`http` vs `node:http`
  module split + crypto/Oidc residue) — same-file family as the 11-17 debt,
  NOT introduced by this batch (zero business code touched; TS still 5.6.3;
  lock and node_modules verified identical to the green runs). Working
  hypothesis (unconfirmed, recorded honestly): **tsc incremental buildinfo
  masked these errors in earlier green runs**; the mask fell when the tree
  was touched. This is a gate-the-gates Q3 finding (coverage gap: cached
  green ≠ green) — PIT candidate; the business debt itself belongs to the
  jose/OIDC line (parallel session's scope), NOT this governance batch.
  agents-check gate: GREEN; the four governance batches are complete and
  verified on their own surface.
