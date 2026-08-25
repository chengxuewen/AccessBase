---
name: openspec-apply
description: >-
  Implement tasks from an AccessBase change proposal. Use when the user wants to
  start implementing, continue implementation, or work through tasks in the
  TypeScript / Fastify / React / Ant Design codebase.
license: MIT
compatibility: Designed for Claude Code, GitHub Copilot, and similar agents.
disable-model-invocation: false
metadata:
  author: openspec
  version: '1.0'
  category: workflow
  project: AccessBase
---

# OpenSpec Apply - AccessBase

Implement tasks from an AccessBase change proposal. Work through design-specified tasks in the AccessBase codebase (TypeScript / Fastify / React 19 / Ant Design 5 / Drizzle ORM / pnpm workspace / pixi).

---

**Input**: Optionally specify a change name (kebab-case). If omitted, check if it can be inferred from conversation context. If vague or ambiguous, list available proposals under `.sisyphus/plans/`.

---

## Steps

### 1. Select the change

If a name is provided, use it. Otherwise:

- Infer from conversation context if the user mentioned a change
- Auto-select if only one active proposal exists
- If ambiguous, list `.sisyphus/plans/` directories and ask the user to select

Always announce: "Using change: `<name>`".

### 2. Read the proposal artifacts

Read these files in order to understand the full scope:

- `.sisyphus/plans/<change-name>/proposal.md` - What & why
- `.sisyphus/plans/<change-name>/design.md` - How
- `.sisyphus/plans/<change-name>/tasks.md` - Tasks

Also read relevant AccessBase source files and SDD docs referenced in the design for context.

### 3. Show current progress

Display:

- Change name and description
- Progress: "N/M tasks complete"
- Remaining tasks overview

### 4. Implement tasks (loop until done or blocked)

For each pending task:

- **Show** which task is being worked on
- **Read** any source files that need modification
- **Edit** files following the design and SDD specifications
- **Build** the affected packages to verify:
  ```bash
  pnpm --filter <package-name> build
  ```
- **Run tests** if applicable:
  ```bash
  pnpm --filter <package-name> test
  ```
- **Check LSP** diagnostics on changed files
- **Mark** task complete in the tasks file: `- [ ]` to `- [x]`
- **Continue** to next task

**Pause if:**

- Task is unclear - ask for clarification
- Implementation reveals a design issue - suggest updating design.md
- Build error or blocker encountered - report and wait for guidance
- User interrupts

### 5. On completion or pause, show status

```
## Implementing: <change-name>

Working on task 3/7: <task description>
  [...] implementation happening ...
  [build] pnpm --filter <package-name> build
  [lsp] diagnostics clean
  [test] pnpm --filter <package-name> test
  Task complete

Working on task 4/7: <task description>
  [...] implementation happening ...
  Task complete
```

---

## AccessBase Build & Verification Commands

For use during implementation:

```bash
# Build specific package
pnpm --filter @audebase/<package-name> build

# Type-check without emitting
pnpm --filter @audebase/<package-name> tsc --noEmit

# Run tests for a package
pnpm --filter @audebase/<package-name> test

# Run all tests
pnpm test

# Lint
pnpm lint

# Enter pixi environment
pixi shell
```

### TypeScript Implementation Reminders

- Follow TypeScript strict mode with explicit public API type annotations
- Use `interface` for object shapes, `type` for unions/intersections
- Use `unknown` over `any` - never use `as any` or `@ts-ignore`
- Use Zod for boundary layer validation (API inputs, plugin communication)
- Follow immutability patterns - use spread operators, never mutate
- Use Drizzle ORM for all database operations (parameterized queries)
- Follow SDD specifications as contracts - interfaces/APIs must match
- Error handling: use `UserError`/`SystemError` with `ErrorCode` enum
- Frontend: Ant Design 5 components only, no other UI libraries
- Frontend: use `useTranslation(pluginPkgName)` for i18n
- Plugin manifest: `runtime.mode` (inline|process|container) + `runtime.partition` (SYSTEM|oa|erp|...)

---

## Guardrails

- Keep going through tasks until done or blocked
- Always read context files (proposal, design, SDD) before starting
- If task is ambiguous, pause and ask before implementing
- If implementation reveals issues, pause and suggest artifact updates
- Keep code changes minimal and scoped to each task
- Update task checkbox immediately after completing each task
- Pause on errors, blockers, or unclear requirements - don't guess
- After each task, verify with lsp_diagnostics + build + tests
- Do NOT modify `pixi.toml` version field - versioning is user-managed
- Do NOT bypass Core data API proxy (D12) - plugins must not direct-connect to DB
- Follow TDD: write tests first (RED), implement (GREEN), refactor (IMPROVE)
