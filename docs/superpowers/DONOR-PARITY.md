# DONOR-PARITY — inventory of every donor asset (three states, no duplication)

> States: HAVE (equivalent exists here) / RULED-IN-PENDING (ruled adopt, port
> not landed) / RULED-OUT (reason + ruling id) / OWED (shape, source, reason —
> NO trigger fields). **Five-field detail (shape/source/reason/REOPEN
> TRIGGER/recheck carrier) lives ONLY in `docs/superpowers/DEFERRED.md`** —
> OWED rows carry a pointer, never a copy. (RA-1818-A: single authority, no
> consistency gate.)

> Recheck: `skill:repo-audit` Full runs cross-check this ledger's rows
> (2D asset line below); transitions (OWED→ruled→HAVE) update on landing.

## Skills (donor inventory: 37 dirs — counted 2026-11-18 via `ls -d .refinfo/MediaServo/.agents/skills/*/ | wc -l`)

| Donor skill | State | Note |
|---|---|---|
| adjudication-walkthrough | HAVE | our 15-skill set carries it |
| book-to-skill | HAVE | |
| code-review-and-quality | HAVE | our rewrite |
| code-simplification | HAVE | |
| design-system | HAVE | our own, richer than donor's 55-line |
| doc-audit | HAVE | |
| expert-panel-review | HAVE | lineage via 11-17 panel input (RCH D22) |
| lesson-review | HAVE | |
| mechanism-porting | HAVE | RA-1818-2-adjacent |
| repo-audit | HAVE | RA-1818-1 (this repo's own rewrite; donor 411-line blueprint) |
| reuse-first | HAVE | RA-1818-2 |
| security-hardening | HAVE | absorbed review-hardcode duty (donor did same) |
| skill-creator | HAVE | |
| skill-router | HAVE | |
| test-harness | HAVE | |
| think-before-act | HAVE | fused with pre-existing repo version (PIT-089 lesson) |
| openspec-apply-change | RULED-OUT | D123 (retire openspec family, 2026-09-23) |
| openspec-archive-change | RULED-OUT | D123 |
| openspec-explore | RULED-OUT | D123 |
| openspec-propose | RULED-OUT | D123 |
| openspec-sync-specs | RULED-OUT | D123 |
| ui-ux-review | RULED-IN-PENDING | own ruling pending (panel found NO prior ruling basis; donor 59 lines). REOPEN TRIGGER + performance-optimization React-profiling thought MERGED here (RT-C G2-2: one trigger, two assets) |
| api-interface-design | OWED | RT-C G3: real gap (contract-first discipline); dangling refs (expert-panel lens) cleaned at DEFERRED seeding |
| browser-testing | OWED | → DEFERRED row |
| ci-cd-automation | RULED-OUT | RT-C G1: donor-specific infra, no real overlap |
| context-engineering | OWED | → DEFERRED row (tombstone weak refs) |
| debugging-and-error-recovery | RULED-IN (mechanism absorbed) | RT-C G1: bisect/layer-localization/evidence-capture folded into think-before-act |
| deprecation-and-migration | OWED | → DEFERRED row |
| documentation-and-adrs | OWED | → DEFERRED row |
| incremental-implementation | RULED-IN (mechanism absorbed) | RT-C G1: thin-slice discipline folded into team-execution rule |
| lsp-code-analysis | RULED-IN-PENDING | RT-C G1: real gap (zero recorded mention); REOPEN TRIGGER: next cross-package symbol surgery batch |
| observability-and-instrumentation | OWED | → DEFERRED row |
| performance-optimization | OWED | → DEFERRED row |
| repo-triage | OWED | → DEFERRED row |
| shipping-and-launch | OWED | → DEFERRED row |
| source-driven-development | RULED-OUT | RT-C G3: mechanism already in reuse-first + evolution-protocol source-verification step |
| test-driven-development | RULED-OUT | RT-C G1: strong overlap with test-harness; 8 dangling refs cleaned (now /test-harness) |
| weaknet-testing | OWED | RT-C G3: real gap (no weaknet plane); REOPEN TRIGGER: weak-network scenario demand |

## Non-skill donor assets

| Asset | State | Note |
|---|---|---|
| `.agents/agents/` role layer (10 files) | RULED-IN-PENDING | RA-1818-B1 A+ form: render tracked `.codebuddy/agents/`, live-fire at next panel |
| `.agents/teams/` routing + lineups | RULED-IN-PENDING | RA-1818-B1 |
| rule language domains (superset) | HAVE | cpp is donor's product; we carry zh legacy |
| `.agents/targets.json` | HAVE | ours: scripts/agents/agent-targets.json (richer: pixi kind) |
| `.agents/mcp.json` | HAVE | ours richer (pixi kind, honest disabled records) |
| donor quarterly-quota cells | RULED-OUT | stripped per evolution-protocol (per-batch anchors only) |
