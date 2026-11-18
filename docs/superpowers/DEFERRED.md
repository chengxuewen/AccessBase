# DEFERRED Register — the single authority for governance-class deferrals

> Created by ruling RA-1818 (2026-11-18, plan:
> `docs/superpowers/plans/2026-11-18-repo-audit-adoption.md`). Five fields per
> row, ALL mandatory (doc-audit checks completeness). REOPEN TRIGGER is the
> exit: a deferral without a trigger is a burial, not a decision. Recurring
> recheck carrier: `skill:repo-audit` Full runs cross-link this register's
> rows (3D table LINKS here; it never duplicates trigger fields). **First
> recheck happened 2026-11-18 (RT-1818-B2): row-1 trigger text amended to
> cover review panels and explicit rulings.**

| Shape (full) | Source | Drop reason | REOPEN TRIGGER | Recheck carrier |
|---|---|---|---|---|
| **DONE 2026-11-18 (RT-1818-B1 A+)** — Role layer (10 files) + agent-lint + roles-links projection + routing.md landed | 11-17 panel distillation | No role files existed at seeding | Team delegation trigger met and acted on (RA-1818-B1 A+) | DONE — see .agents/agents/ + agent-lint layer |
| Per-field host-dialect probing (never per-host assumptions) | MS status 2026-11-16 dialect defect | Single dominant host today | A second host consumes the faces (Qoder host present) | repo-audit domain 3 |
| MCP user-level same-name conflict detection + probe fields in registry | 11-17 panel (B12 shape) | Single-user machine; no ~/.codebuddy/mcp.json conflicts observed | Multi-developer machines or user-level MCP files appear | gate-mcp evolution card |
| unslop AI-look taxonomy (de-slop passes) | MS r47 adoption | UI implementation not started | First admin-ui visual polish batch | proposal card |
| Prototype governance (README brief trio + location ruling) | MS C53-55 + status | No prototypes yet | First www/prototype/ artifact | proposal card |
| Self-driven screenshot loop (never wait for pasted screenshots) | MS r45 | UI E2E visuals not in scope yet | Visual regression work starts | test-harness card |
| Computed-style assertions (attribute-string assertions are false-green on block containers) | MS PIT-224 | Frontend E2E era | Same as above | test-harness card |
| plan soft-close (delivered-parked + enumerated reopen triggers) | 11-17 panel | This register IS the interim mechanism | Plans accumulate unexecuted tail (>3 parked) | doc-audit |
| duty roster ("no one runs it" gate liveness) | 11-17 panel / MS PIT-226 family | census + roster canary landed instead | A gate is found unrun for >2 weeks | gate-the-gates recheck |
| mdBook index site | 11-04 Batch 6 | Governance surface fits AGENTS.md today | Surface outgrows AGENTS.md indexing (multi-workspace split) | doc-audit |
| llms.txt | 11-04 Batch 6 | No generated API docs exist | rustdoc-class API docs ship | repo-audit domain 5 |
| SDD clause↔test bidirectional spec-trace | 11-04 Batch 6 | Implementation-status headers sufficient | Headers prove insufficient in an audit | repo-audit domain 8 |
| Qoder gated bundle (ADJ-7b pilot + 7g projection + 7j dir-level BLOCKER, unlock TOGETHER) | 11-04 plan (ruled, unsanctioned) | No Qoder host on this machine | Qoder host available (pilot is hard precondition) | proposal card |
| scripts/agents type-check path inclusion | 11-04 deferred-to-user | .mts layers run under pinned node | tsc config rework era | repo-audit domain 4 |
| memory-bridging (export host memory ↔ project memory) | 11-04 ADJ-7i | Stale-copy retrieval worse than none; pitfalls actively written | Host memory stabilizes + retrieval demand demonstrated | doc-audit |
| opencode-face launcher re-plumbing (route init-wrappers through a guard-capable path) | This plan (RA-1818-3 exemption note) | opencode face launches wrappers directly, bypassing mcp-launch.sh | Any PIT-090-family recurrence on the opencode face | gate-mcp card |

Register seed count: 16 (9 from the 11-17 distillation net of 2 absorbed by
RA-1818-1/-2, 6 from the 11-04 plan, 1 new). Rows are the authority — this
line is history, not a check.
| Observability system discipline (RED metrics/spans/alerts, donor 106 lines) | RT-C G2-1 (donor skill, MS media-stack specific) | No metrics/traces plane exists yet to hang it on | Observability system initiative (monitoring/logging/metrics plane built) | proposal card |
| Shipping checklist (gates/version/changelog/artifact pin/staged rollout/rollback, donor 89 lines) | RT-C G2-4 (donor skill, generic mechanism) | No external consumers yet — deploy plane exists but nothing ships to users | First external delivery (release to users) | deploy-ops role |
| Doc-link gate (machine-checkable relative-link validation, donor check_docs_links.py) | RT-C G3 tool sweep (DONOR-PARITY) | Domain-5 links check was manual-only | repo-audit Full #2 tooling batch (first Full run adopts ≥1 donor tool) | repo-audit 2D |
| Doc-promise gate (plan says X vs landed Y, donor check_promises.py) | RT-C G3 tool sweep | Gate-the-gates audit flagged promise-vs-reality as a family (C-3/C-2) | Same tooling batch as above | repo-audit 2D |
| Parent-reference prohibition (`../` cross-boundary links, donor check_no_parent.py + allowlist) | RT-C G3 tool sweep | No parent-ref incidents yet; donor proved the pattern | Same tooling batch as above | repo-audit domain 5 |
| Memory-ownership machine check (host-private vs project facts, donor check_memory_ownership.py) | RT-C G3 tool sweep | Advisory line exists in agents check; machine check is stricter | Memory-bridging trigger fires (ADJ-7i) | memory-aggregate evolution |
| Guard-health checker (every gate site has a live run signal, donor check_guards.py) | RT-C G3 tool sweep | Census canary + full-roster canary cover the dispatcher; per-site liveness not yet | A gate found unrun >2 weeks (duty-roster trigger) | gate-the-gates recheck |
| 2D inventory generator (machine-produced eight-asset table, donor report_2d.sh) | RT-C G3 tool sweep | repo-audit 2D is hand-written today | First Full audit adopts the generator form | repo-audit 3D |
