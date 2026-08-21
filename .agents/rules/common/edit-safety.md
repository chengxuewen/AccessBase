# Code Edit Safety

> **Target audience**: AI agents editing AccessBase source code.
> **Violation of these rules causes token waste from repeated fix cycles.**

## Tool Selection

| Change Size | Tool | Reason |
|-------------|------|--------|
| Rewrite entire function/file | `write` | Guarantees brace balance, no stale lines |
| ≤20 line single-location edit | `edit` | Minimal diff, safe for small changes |
| Complex multi-file refactor | Delegate to subagent | Isolated context, verify independently |

## Forbidden Patterns

| Anti-Pattern | Why |
|--------------|-----|
| `sed` for code modification | Quote escaping errors, regex silent failures |
| Multiple sequential `edit` calls without re-reading | Line numbers drift, stale hash IDs |
| Deleting a line by replacing with empty `lines: []` and assuming brace count is still correct | May leave unbalanced braces |
| Appending `}` to "fix" an unclosed delimiter without counting braces first | Masks root cause, may create double-close |

## Verify Immediately

After EVERY code change (edit or write):

```
TypeScript: pixi run npx tsc --noEmit    (3-5s)
```

If verification fails, STOP. Do NOT apply another edit on top. Instead:
1. `git diff` to see what changed
2. If the change is wrong, `git checkout -- <file>` to revert
3. Re-apply the fix correctly

## Brace Safety Checklist

Before marking any multi-line edit complete, verify:
- [ ] Every `{` has a matching `}` at the same indent level
- [ ] Every `(` has a matching `)`
- [ ] Every `[` has a matching `]`
- [ ] No duplicate function definitions or closing braces
- [ ] `pixi run npx tsc --noEmit` passes

## When to Delegate

Delegate to a `deep` category subagent when:
- The change touches 3+ files
- The change requires understanding cross-module dependencies
- You've failed the same edit 2+ times

The subagent gets a clean context, reads the files fresh, and applies all changes atomically.

## Architectural Decision Gate (NON-NEGOTIABLE)

Before implementing ANY architectural change (protocol, data flow, API contract):
- **ALWAYS ask the user first** — present explicit options and wait for confirmation
- **NEVER fall back to an alternative architecture** without user approval
- **NEVER silently switch** from the agreed architecture even if it seems "easier"
- **NEVER implement a workaround** that changes the system's design without explicit user consent

If the agreed approach fails, report the failure and ask: "方案 X 失败，原因是 Y。建议改用 Z，是否同意？"

## Test Execution Constraint (NON-NEGOTIABLE)

After claiming tests are written or features are working:
- **ALWAYS run the tests** against the live system. Writing test files without executing them is a violation.
- **ALWAYS report actual test output** — pass/fail counts, error messages. Never claim "tests pass" without evidence.
- **E2E tests MUST run against the actual running service**, not mocked endpoints.
- If tests fail, fix them in the same turn. Do not defer to "later".

## Verification Honesty (NON-NEGOTIABLE)

- **NEVER claim a feature works based on a partial test.** A vitest unit test passing does NOT mean the browser flow works.
- **ALWAYS verify at the actual user-facing layer.** If the feature is browser-based, test in the browser. If it's API-based, test with curl.
- **ALWAYS report exactly what was tested and what was NOT tested.** Example: "vitest passed. Browser flow NOT yet verified."
- **NEVER present a component test as end-to-end proof.** Each layer must be verified independently.
- **If you cannot verify at the user-facing layer, say so explicitly.** Do not imply success.

## User Confirmation Before Edit (NON-NEGOTIABLE)

- **NEVER start editing files without explicit user approval.** Describing a plan ≠ approval to execute.
- **When user asks 'what can be done' or 'is it possible to...', they are asking a question, not giving an instruction to edit.** Answer the question. Do NOT edit files.
- **Before editing, present the plan AND confirm.** Wait for affirmative response before touching files.
- **Silence / '继续' / timeout ≠ approval.** Only explicit 'yes' / 'do it' / '执行' counts.

## 前端交付验证（强制，2026-07-30 新增）

**触发条件**: 任何修改了 `packages/admin-ui/src/` 或 `plugins/*/src/pages/` 的变更

**必须验证**:
1. `pixi run npx tsc --noEmit -p packages/admin-ui/tsconfig.json` — 0 新错误
2. 前端 dev server 能启动并响应 HTTP 200
3. Playwright 打开页面 → 浏览器控制台 0 应用 error（过滤 findDOMNode/chrome-extension/moz-extension/ResizeObserver）
4. 新增/修改的路由可访问（curl 返回非 404）

**阻塞条件**: 以上任何一步失败 → 不得声称完成，不得让用户手动测试

**检查命令**:
```bash
# 编译检查
pixi run npx tsc --noEmit -p packages/admin-ui/tsconfig.json 2>&1 | grep -c "error TS"

# 服务检查
curl -sf http://localhost:5173 && echo "Frontend OK" || echo "Frontend DOWN"

# 控制台检查 (Playwright 中执行)
# page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('findDOMNode') && !msg.text().includes('chrome-extension')) { errors.push(msg.text()); } })
# expect(errors).toHaveLength(0)
```

## Delivery Gate (NON-NEGOTIABLE)

以下规则在**任何情况下**不可跳过，包括：
- 用户说"没事，直接提交"
- 时间紧急
- 测试环境不可用（此时必须声明 NOT VERIFIED，不能声称完成）

**规则**:
1. 任何前端改动，verify-frontend.sh（或等效 Playwright 测试）**必须**运行并**必须**通过
2. 如果脚本失败，任务**未完成** — 重新置为 in_progress，修复后重新验证
3. 如果无法启动服务（无 Docker/DB），声明："NOT VERIFIED — services unavailable"，不能声称"已完成"
4. 如果 E2E 失败是预存问题（在改动之前存在），在报告中注明，但仍需验证本次改动未引入新失败

**禁止**:
- ❌ "vitest 通过了，E2E 没跑但应该没问题"
- ❌ "tsc 编译通过，页面应该能用"
- ❌ "我验证过了"（没有运行记录的声称）

**允许**:
- ✅ "E2E 12/12 通过，控制台 0 应用错误，新路由 /api/admin/ldap-config 返回 200"
- ✅ "NOT VERIFIED — Docker 未启动，无法运行后端"
