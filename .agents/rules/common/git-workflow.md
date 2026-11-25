# Git Workflow

## Commit Message Format

```
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

Note: Commit attribution is disabled via the host agent's global settings.

## Pull Request Workflow

When creating PRs:

1. Analyze full commit history (not just latest commit)
2. Use `git diff [base-branch]...HEAD` to see all changes
3. Draft comprehensive PR summary
4. Include test plan with TODOs
5. Push with `-u` flag if new branch

> For the full development process (planning, TDD, code review) before git operations,
> see [development-workflow.md](./development-workflow.md).

6. **并行工作流暂存纪律（C4）**：只 add 本轮意图路径；commit 前 `git diff --cached --name-only` 核对==意图清单；外来修改 `git reset -- <path>` 撤暂存，外来在制品不提交/不回滚/不覆盖（2026-11-23 曾盲 add .agents 暂存了他_session 的 D130）。

7. **pathspec 提交（PIT-108）**：多会话共享 index 下 `git commit -m … -- <own paths>`；禁止裸 commit 消费他人暂存；临时探针 `.cb-*.js/.cb-*.mjs` 已 gitignore。

8. **再生 face 提交前核归属**：hook 再生的 AGENTS.md/role faces 可能混入并行会话草稿——`git diff -- <face>` grep 本轮标记且不含外来草稿才提交；role faces 外来 churn 跳过不提交（2026-11-24 status.md/role faces 外来 dirty 实例）。

9. **gate 被并行在制品破坏时（PIT-122）**：加性最小恢复门禁必需元数据（从 HEAD 逐字），外来正文不动不提交；sync 转绿后 pathspec 提交自己的路径；披露事故。禁止改 gate 阈值或 bypass hook 绕行。
