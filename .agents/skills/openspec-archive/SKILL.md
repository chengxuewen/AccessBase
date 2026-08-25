---
name: openspec-archive
description: >-
  Archive a completed AccessBase change proposal after implementation and verification.
  Use when the user wants to finalize a change - record decisions, update memory,
  clean up artifacts.
license: MIT
compatibility: Designed for Claude Code, GitHub Copilot, and similar agents.
disable-model-invocation: false
metadata:
  author: openspec
  version: '1.0'
  category: workflow
  project: AccessBase
---

# OpenSpec Archive - AccessBase

Archive a completed AccessBase change proposal. Record what was done, update project memory, and clean up working artifacts.

---

**Input**: Optionally specify a change name (kebab-case). If omitted, check if it can be inferred from conversation context. If vague or ambiguous, list available proposals under `.sisyphus/plans/`.

---

## Steps

### 1. Select the change

If a name is provided, use it. Otherwise:

- Infer from conversation context
- If ambiguous, list `.sisyphus/plans/` directories and ask the user to select

**IMPORTANT**: Do NOT guess or auto-select a change. Always let the user choose.

### 2. Verify completion status

Check that all tasks are complete:

- Read `.sisyphus/plans/<change-name>/tasks.md`
- Confirm all tasks are marked `[x]`
- If incomplete tasks exist: display warning, ask user if they want to proceed

Also check that `openspec-verify` was run:

- If not, suggest running verification first
- User can override and archive anyway

### 3. Update project memory

Record what was done in the project's memory files:

#### a. Update `status.md`

Add the completed change to the status file under "近期工作":

```
- 2026-07-15: [description of what was implemented]
```

File: `.agents/memorys/status.md`

#### b. Update `decisions.md` (if applicable)

If the change involved architectural decisions, add a decision entry:

```
### DXX: [Title]

- **决策**: [what was decided]
- **理由**: [rationale]
- **参考**: [references]
- **状态**: 已决策
```

File: `.agents/memorys/decisions.md`

#### c. Update `pitfalls.md` (if applicable)

If the change uncovered technical pitfalls, add an entry:

```
### [Pitfall title]

- **问题**: [what happened]
- **正确做法**: [how to fix/avoid]
- **详见**: [relevant file/decision]
```

File: `.agents/memorys/pitfalls.md`

### 4. Update changelog

Add an entry to git commit history (AccessBase uses git log, not separate changelog files):

```bash
git log --oneline -5  # Show recent commits for context
```

Do NOT modify `pixi.toml` version field - only the user may update it.

### 5. Archive the proposal directory (optional)

If the user wants to clean up:

```bash
mkdir -p .sisyphus/plans/archive
mv .sisyphus/plans/<change-name> .sisyphus/plans/archive/<change-name>
```

Or keep it for reference - the user decides.

### 6. Display summary

```
## Archive Complete

**Change:** <change-name>
**Location:** .sisyphus/plans/archive/<change-name>/

### Recorded
- [x] Project status updated (status.md)
- [x] Decisions recorded (decisions.md) - [if applicable]
- [x] Pitfalls recorded (pitfalls.md) - [if applicable]

### Next Steps
- User may update pixi.toml version
- Consider cleanup of any temporary/test files
```

---

## AccessBase-Specific Archival Context

### Memory files to update

| File                             | Purpose                                | Update When            |
| -------------------------------- | -------------------------------------- | ---------------------- |
| `.agents/memorys/status.md`      | Project status, recent changes         | Always                 |
| `.agents/memorys/decisions.md`   | Architecture decisions (D1-D24, G1-G5) | Design decision made   |
| `.agents/memorys/pitfalls.md`    | Technical pitfalls                     | New issue encountered  |
| `.agents/memorys/conventions.md` | Coding conventions                     | Convention established |

### When to record a decision (decisions.md)

Any of these during the change:

- New plugin architecture pattern established
- Database schema change (new table, new column, index strategy)
- API design decision (new endpoint, response format change)
- Security decision (auth flow, permission model)
- Frontend architecture decision (component pattern, state management)
- Build/tooling change (new dependency, config change)

### When to record a pitfall (pitfalls.md)

Any of these during the change:

- Build error that required non-obvious fix
- TypeScript type system issue (generic inference, conditional types)
- Drizzle ORM migration issue
- Fastify plugin registration order issue
- React/Ant Design rendering issue
- Plugin lifecycle hook timing issue
- Multi-tenant data isolation edge case

---

## Guardrails

- Always prompt for change selection if not provided
- Do NOT block archive on warnings - just inform and confirm
- Do NOT modify `pixi.toml` version field - only the user may update it
- Memory file updates should be concise, not verbose
- If the change involves no new pitfalls or decisions, skip those files
- Offer to clean up the proposal directory but do not force it
- Update AGENTS.md if new modules/packages were added
