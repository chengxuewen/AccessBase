---
name: openspec-verify
description: >-
  Verify that an AccessBase change proposal was implemented correctly. Use after
  implementation tasks are complete to ensure code compiles, tests pass, and
  the change meets design requirements.
license: MIT
compatibility: Designed for Claude Code, GitHub Copilot, and similar agents.
disable-model-invocation: false
metadata:
  author: openspec
  version: '1.0'
  category: workflow
  project: AccessBase
---

# OpenSpec Verify - AccessBase

Verify that an AccessBase change proposal was implemented correctly. This is the quality gate before archiving.

---

**Input**: Optionally specify a change name (kebab-case). If omitted, check if it can be inferred from conversation context.

---

## Steps

### 1. Select and prepare

If a name is provided, use it. Otherwise infer from context or list `.sisyphus/plans/` directories.

Read the proposal artifacts:

- `.sisyphus/plans/<change-name>/proposal.md` - original goals and success criteria
- `.sisyphus/plans/<change-name>/design.md` - design decisions to verify
- `.sisyphus/plans/<change-name>/tasks.md` - task completion status

### 2. Verify task completion

Check the tasks file: all tasks should be marked `[x]` (complete).

If incomplete tasks exist:

- Display warning listing incomplete tasks
- Ask the user if they want to proceed anyway or complete remaining tasks

### 3. LSP diagnostics check

Run LSP diagnostics on all changed files:

```bash
# Check all modified files via git
git diff --name-only HEAD
```

For each modified `.ts`, `.tsx`, `.js`, `.jsx` file, verify LSP diagnostics are clean (no errors, warnings are acceptable).

### 4. Build verification

Build the affected packages:

```bash
pnpm --filter @audebase/<package-name> build
```

The build MUST pass without errors. Document any pre-existing warnings that are not related to the change.

### 5. Test verification

Run tests for the affected packages:

```bash
pnpm --filter @audebase/<package-name> test
```

All tests MUST pass. Verify coverage meets 80% minimum threshold.

### 6. Design validation

Compare the implementation against `design.md`:

| Criterion                   | Check                                            |
| --------------------------- | ------------------------------------------------ |
| Architecture matches design | All new classes/functions exist as specified     |
| Interfaces match SDD spec   | SDD-defined APIs match implementation signatures |
| API endpoints correct       | Fastify routes match api-specification.md        |
| Database schema correct     | Drizzle schema matches database-schema.md DDL    |
| No scope creep              | No unrelated modifications                       |

### 7. Regression check

Ensure no existing functionality is broken:

- Check that existing tests still pass
- Verify that removed/modified code has proper migration
- Check for any accidental changes to unrelated files via `git diff`

### 8. Report results

```
## Verification: <change-name>

### Results

- Tasks: 7/7 complete
- LSP diagnostics: PASS (0 errors)
- Build: PASS (<package-name>)
- Tests: PASS (coverage: 85%)
- Design match: PASS

### Summary

All verification criteria met. Ready for archiving.

OR

Issues found:
1. [Issue description]
2. [Issue description]

Action needed before archive.
```

---

## Additional Checks

### For TypeScript changes

- `lsp_diagnostics` on all `.ts`/`.tsx` files
- Build succeeds with `pnpm build`
- No new TypeScript compiler warnings added
- No `as any` or `@ts-ignore` introduced
- Zod schemas used for boundary validation
- Error handling uses `UserError`/`SystemError` with `ErrorCode` enum

### For Database changes

- Drizzle schema matches `docs/modules/database-schema.md`
- Migrations follow D1.7 three-phase pattern (preload/postsync/postload)
- `tenant_id` column present where required by D4
- Indexes follow D9.1 (tenant_id as first column)

### For Frontend changes

- Ant Design 5 components used (no other UI libraries)
- `useTranslation(pluginPkgName)` for i18n
- ErrorBoundary wrapping plugin routes (D20)
- ACLGuard for permission-protected components (D19)
- ProLayout menu registration via `this.app.router.add()` (D16)

### For Plugin changes

- manifest.yaml follows D1.5 spec
- Plugin lifecycle hooks match D1.4 (7 hooks)
- No direct DB access (D12 Core data API proxy)
- Exports declared in manifest.exports

---

## Guardrails

- Do NOT skip build verification - build MUST pass
- Check ALL changed files, not just the ones you remember editing
- If a pre-existing issue is blocking verification, document it separately
- Do NOT force-pass if build fails - fix the issue or revert
- LSP diagnostics takes priority over subjective code review
- If tests exist, run them: `pnpm --filter <package-name> test`
- Coverage threshold: 80% minimum (per conventions.md)
- Report clearly what passed and what failed
