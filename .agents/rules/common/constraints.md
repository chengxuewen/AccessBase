# Development Constraints

> 硬约束。按主题拆分：Docker/网络见 [docker.md](docker.md)，平台见 [platform.md](platform.md)。

## Git Commit Rules

### Lockfile 必须随依赖变更提交

**ALWAYS** 提交 lockfile 与依赖变更一起。这保证 CI 和其他开发者复现相同依赖树。

- pnpm workspace → `pnpm-lock.yaml`（根目录）
- `.opencode/` 独立 npm 包（插件系统）→ `package-lock.json`
- `pixi.toml` 变更后 → 运行 `pixi lock` 并提交 `pixi.lock`；未重新生成锁文件会导致 install 不可用（见 pitfalls 跨平台锁文件陷阱）

**提交前 checklist:**

- [ ] package.json / pixi.toml 变更已提交
- [ ] 对应 lockfile 变更已提交（依赖有变动时）
- [ ] `git status` 工作区干净（除有意忽略项）

### 禁止事项

- 禁止 `--no-verify` 跳过 git pre-commit hook（已启用 `tsc --noEmit` 校验）
- 禁止使用 `sed` 修改代码（见 edit-safety.md）
- 禁止全局 MODACS→AccessBase 替换 — 使用手术式精确编辑
