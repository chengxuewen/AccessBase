# Donor Ledger — provenance of adopted external mechanisms

> Every mechanism adopted from an external repo/community source gets a row
> here (ruling 2026-11-17 #9). Rule: mechanism transplanting is allowed when
> the JUDGMENT PATH is restated in our own vocabulary; text/template-level
> overlap must be declared, not hidden. `mode` values: `mechanism-only`
> (judgment path only, our own expression) / `adapted` (structure borrowed,
> rewritten for our surfaces) / `verbatim-copy` (text-level — avoid, requires
> explicit ruling + license compliance).

| Donor | Destination | Mode | Ruling | License / duty |
|---|---|---|---|---|
| MediaServo (`.refinfo/MediaServo`) — single-source generation, 3 generators + 3 lints pattern | `scripts/agents/{rules-links,skills-index,memory-aggregate,agent-links}.mts` | adapted | 2026-11-04 plan ADJ-1..3 | private reference repo; mechanism-only, our own TS implementation |
| MediaServo — constraint never-list + verification discipline shape | root `CONSTRAINTS.md` | mechanism-only WITH text overlap | 2026-11-04 plan Batch 1/2 | private repo; 3 of 6 Never lines are near-verbatim slogans — short phrases, low risk; declared here per ruling #9 H-3 |
| VisiaEngine (`.refinfo/VisiaEngine`) — MCP single-source + pin + latch-pair | `.agents/mcp.json`, `scripts/agents/{mcp-links,gate-mcp,mcp-cli}.mts` | adapted | ADJ-4a/4b/4c | private reference repo; mechanism-only |
| RCH (`.refinfo/remote_control_host_computer`) — expert-panel-review (D22) | `.agents/skills/expert-panel-review/SKILL.md` | adapted with content residue | ADJ-5b | RCH root has no LICENSE; 2 core roles + community token figures carried from RCH text, attributed in the skill header — declared here |
| MediaServo — `sync-official-refs.sh` template | `scripts/sync-official-refs.sh` | adapted with text overlap | pre-plan (existing) | same template instantiated twice (69 vs 82 lines) with translated comments; carries a bare `PIT-14` citation that violates ADJ-1b → FIX IN G3: change to `MS:PIT-14` |

## Notes

- The `PIT-14` prefix fix is a G3 landing item (not yet done at time of writing
  this row) — the ledger records the debt honestly rather than claiming it
  clean. On completion, append "fixed 2026-11-17, commit TBD" to that row.
- MS root LICENSE is Apache-2.0 WITH a NOTICE (4(d) attribution duty on
  derivative distribution). Our adoption is mechanism-level with private-repo
  slogans; no external distribution is planned. If this repo is ever
  published, revisit every row above with the license column first.
- Donor scans after 2026-11-04 (unslop CC BY 4.0, shadcn/improve,
  open-code-review, agency-agents MIT) were NOT ported as skills — their
  mechanisms are candidates for the evolution protocol, not yet adopted here.
| MediaServo repo-audit (evolved from VisiaEngine 158565a, 311→411 lines) | `.agents/skills/repo-audit/SKILL.md` | adapted WITH declared overlap | RA-1818-1 (2026-11-18) | private repos; mechanism rewrite in our vocabulary; domain-table TEMPLATE reused and the "owner green ⇒ proven" reading rule kept verbatim as a slogan (deliberate, declared here per panel M-2); donor quarterly-quota cells stripped per evolution-protocol |
| MediaServo reuse-first (charter C60, PIT-246/238 scars) | `.agents/skills/reuse-first/SKILL.md` + `docs/reference/reuse-first-charter.md` | mechanism-only | RA-1818-2 (2026-11-18) | private repo; four-step evidence chain restated, no scar-table content carried |
