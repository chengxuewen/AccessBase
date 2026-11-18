# Team Routing — which team for which situation

> Adapted from donor routing.md (RT-B1). Teams are orchestration intents
> (`.agents/teams/<team>.md`); the main session is the lead; members must be
> EXISTING roles from `.agents/agents/`. Discipline follows
> `skill:expert-panel-review` (lineup gated by complexity, independent
> conclusions, disagreements preserved, lead merges but does not review).

| Situation | Team | Lineup core | Scenario mounts (pick per surface) |
|---|---|---|---|
| Delivery review (ready / not-ready before merge) | `delivery-review` | code-reviewer + evidence-critic | api-server / web-frontend / db-migrations / identity-security / build-ci / deploy-ops (per changed surface) |
| Interface design & contracts | `interface` | api-server + evidence-critic | web-frontend (contract consumer), db-migrations (schema producer) |
| Design-system / UI quality | `design-system` | web-frontend | ui-ux-review is the review method (skill), not a member |
| Governance / .agents changes | `agent-infrastructure` | governance-steward + evidence-critic | test-strategist (gate impact) |

## Rules

- Members MUST exist in `.agents/agents/` (agent-lint enforces).
- Scenario mounts are lenses on the core review — never new roles.
- Security and performance stay lenses on code-reviewer (no standalone
  roles — roster rule).
- One complexity gate before spawning: single-file reversible change →
  NO team (`rule:team-execution` small-fix-no-ceremony).
