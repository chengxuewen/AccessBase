# Tool Routing — division of labor, NOT priority

> This rule defines DIVISION BOUNDARIES, not priorities. Host built-in directives
> (e.g. CodeBuddy's native code search) always outrank project rules — a priority
> rule that fights the host silently loses (RCH:D23 evidence). A matrix
> coexists with the host; a priority ladder does not.
>
> Latch-pair: this file exists ⇔ `local-codegraph` is declared in
> `.agents/mcp.json` (enforced by `gate-mcp`; removing either requires removing
> both in the same change).

## The matrix

| Task shape | Route | Why |
|---|---|---|
| Exact text / known symbol / filename | Native grep + file read | Fastest, explainable, always correct |
| Definition / references / type shape | Host LSP (or `lsp` tool) | Semantic but native; no extra runtime |
| Semantic exploration / call chains / impact analysis | `codegraph_explore` (MCP) | Returns verbatim source + call paths in one shot; treat results as already-Read |
| Ant Design live prop/API questions | `local-antd` MCP | Authoritative component semantics at query time |
| Ant Design usage patterns / UI consistency | `design-system` skill | Repo conventions beat live docs for consistency decisions |
| Drizzle schema facts (tables/columns) | `local-drizzle` MCP | Introspects the real schema |
| Migration flow (push/generate/migrate) | `bash accessbase.sh db:*` | Schema introspection ≠ migration execution |
| Browser automation from agent sessions | Host built-in browser tool first; `local-playwright` MCP when the host has none | Do not double-route |
| Fuzzy middle ground | Pick EXACTLY ONE route | Dual-path retrieval is banned — zero-gain duplication |

## Multi-host reality (ADJ-4c ruling A, corrected by ADJ-7g)

Three hosts consume this declaration set — opencode (opencode.json face),
CodeBuddy (.mcp.json face), and Qoder (the same root .mcp.json) — each spawning
its own processes. That triple-instance cost was accepted by ruling. Discipline
that follows from it:

- Do not enable a server "just in case" — enablement is a user ruling (RCH:C12
  spirit: reclaiming resources needs explicit sanction too).
- Before adding any root-level declarative file, answer the three questions
  (RCH:PIT-244): who reads it, what do they do on read, how many hosts on this
  machine read it. Matrix rows are written BY CAPABILITY, never by host, so the
  table does not fork per reader (ADJ-7g).
