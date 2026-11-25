# Skill Trigger Boundaries — intent → owning skill → hand-off

> Boundary map, NOT a router (routing still lives in each SKILL.md's
> `description`). This file answers "who owns this intent" and "where it goes
> when it is not yours". New skills MUST register a row here before landing
> (skill-lint check 10). Row syntax: `` `skill:<name>` `` (must exist in
> `.agents/skills/`) or `` `rule:<name>` `` (must exist in `.agents/rules/`).
> Hand-off cells may name either, or "user" for adjudication.

| Intent (sample trigger words) | Owning skill | Hand-off |
|---|---|---|
| One-at-a-time rulings, multi-option decisions, 一个个来 | `skill:adjudication-walkthrough` | `skill:expert-panel-review` (conflict source) |
| Turn a book/doc/PDF into a reusable skill | `skill:book-to-skill` | `skill:skill-creator` |
| Review a code change, 审查/复审这份代码 | `skill:code-review-and-quality` | `skill:expert-panel-review` (contested findings) |
| Reduce TS complexity, refactor, 简化代码 | `skill:code-simplification` | `skill:code-review-and-quality` |
| Admin-UI consistency, design tokens, AntD usage | `skill:design-system` | `skill:code-review-and-quality` (UI code) |
| Document/architecture consistency audit, 文档审计 | `skill:doc-audit` | `skill:adjudication-walkthrough` (findings) |
| Scan external ecosystem for skills/MCP/rules to adopt | `skill:repo-audit` | `skill:adjudication-walkthrough` (adoption rulings) |
| Whole-repo audit, 审计/全仓审计, governance inventory | `skill:repo-audit` | `skill:doc-audit` (doc-only scope) |
| (tombstone) ecosystem scan duty — DO NOT route here | `skill:ecosystem-scan` | superseded: routes to `skill:repo-audit` 2B/2C |
| Panel review of a plan/decision, 专家团/复审这份方案 | `skill:expert-panel-review` | `skill:adjudication-walkthrough` |
| Codebase graph, architecture relationships, call chains | `skill:graphify` | `skill:code-review-and-quality` |
| Batch session review, lessons into memory, 总结经验/回顾会话 | `skill:lesson-review` | `rule:lesson-memory` |
| Execute an already-ruled external mechanism port, 移植/采纳这个机制 | `skill:mechanism-porting` | `rule:evolution-protocol` (ruling citation) |
| Before building — prove nothing usable exists, 先找现成的/别重复造 | `skill:reuse-first` | `skill:repo-audit` (gap discovery) |
| UI quality / accessibility / three-states review, 界面质量审查 | `skill:ui-ux-review` | `skill:design-system` (token mechanics) |
| Prototype-vs-implementation conformance, 原型对齐/双图证据/UI 完成声明 | `skill:ui-conformance` | `skill:design-system` (token mechanics), `skill:ui-ux-review` (quality) |
| Security audit, OWASP/JWT/RBAC/secret handling | `skill:security-hardening` | `skill:code-review-and-quality` |
| Create a new skill from SDD/interfaces/manifest | `skill:skill-creator` | `skill:skill-router` (routing check) |
| "How do I / which skill?", ambiguous intent | `skill:skill-router` | owning skill from this table |
| Generate test plans/skeletons from SDD, coverage gaps | `skill:test-harness` | `skill:code-review-and-quality` |
| Before any non-trivial action, 先查再动手 | `skill:think-before-act` | `skill:expert-panel-review` → `skill:adjudication-walkthrough` |
| Agent governance config — skills/rules/MCP/memory | `rule:agents` | `skill:doc-audit` (self-consistency) |
| Delegated execution / team task delegation | `rule:team-execution` | `skill:think-before-act` (plan quality) |

## Non-goals

- No row means "never route": unlisted intents use the description surface
  and this file is consulted first when two descriptions overlap.
- `'复审'` is a deliberate shared word (code vs panel) — the object decides:
  "这份代码" → code-review; "这份方案/计划" → expert-panel.
- Team-execution delegation rules (future) register as a `rule:` row here;
  they are always-on in the instruction face but self-limiting in scope.
