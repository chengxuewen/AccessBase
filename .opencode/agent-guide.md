# AUDEBase OpenCode AI 配置使用指南

> 最后更新: 2026-07-15

## 一、架构总览

AUDEBase 是一个面向企业的应用开发平台，对标 Odoo、NocoBase、云表。采用微内核 + 插件热插拔架构，支持 OA、ERP、MES、PLM、WMS 等企业应用的快速开发与部署。项目当前处于 Phase 2 完成阶段 — 28 包全部实现，工作流引擎 (Phase 4) 已完成。

本指南说明 AI agent 如何与 AUDEBase 开发环境交互，以及 OpenCode 工具链的配置使用方法。

```
┌─────────────────────────────────────────────────────────┐
│                    OpenCode TUI                         │
├─────────────────────────────────────────────────────────┤
│  插件层                                                 │
│  ┌──────────┬─────────────┐                  │
│  │superpowers│ context-mode│                  │
│  └──────────┴─────────────┘                  │
├─────────────────────────────────────────────────────────┤
│  编排层: OMO (oh-my-opencode)                           │
│  ┌─────────┬──────────┬────────┬───────┬─────────────┐  │
│  │Sisyphus │Prometheus│ Oracle │ Metis │   Momus     │  │
│  │ (执行)  │  (规划)  │ (咨询) │(评审)  │  (批判)     │  │
│  ├─────────┼──────────┼────────┼───────┼─────────────┤  │
│  │ Atlas   │Librarian │Explore │Hephaestus│Junior    │  │
│  │ (导航)  │  (搜索)  │(探索)  │ (构建)  │ (轻量执行) │  │
│  └─────────┴──────────┴────────┴───────┴─────────────┘  │
├─────────────────────────────────────────────────────────┤
│  工具层: MCP (codegraph/antd/drizzle/playwright/openspace) + LSP (typescript-language-server) + Skills│
├─────────────────────────────────────────────────────────┤
│  上下文层: 4 memory files + context-mode    │
└─────────────────────────────────────────────────────────┘
```

### 配置层次

| 层次 | 文件 | 内容 |
|---|---|---|
| 系统级 | `~/.config/opencode/opencode.jsonc` | API Key、Provider 定义、模型别名 |
| 项目级 | `.opencode/opencode.json` | 插件、MCP、instructions、主模型 |
| 项目级 | `.opencode/oh-my-openagent.jsonc` | Agent 模型分配、fallback、team mode |
| 项目级 | `.agents/memorys/` | 项目记忆 (status/conventions/decisions/pitfalls) |
| 项目级 | `.agents/rules/` | 编码规则 (security/coding-style) |
| 项目级 | `.agents/skills/` | 技能定义（openspec-*, design-system, doc-audit, test-harness, book-to-skill, skill-creator） |

### 5 层模型体系

| 层级 | 别名 | 主模型 | 降级 1 | 降级 2 | 上下文 |
|---|---|---|---|---|---|
| **premium-max** | 极致推理 | deepseek-v4-pro-max | kimi-k2.6 | minimax-m3 | 1M |
| **premium** | 主力推理 | deepseek-v4-pro | qwen3.7-max | glm-5.1 | 1M |
| **fast** | 极速执行 | deepseek-v4-flash | qwen3.6-flash | doubao-seed-2.0-lite | 128K |
| **vision** | 视觉专家 | doubao-seed-2.0-pro | qwen3.6-plus | gemini-3.5-flash | 128K |
| **lite** | 轻量兜底 | qwen3-32b | qwen3-8b | — | 40K |

> **注意**: 所有模型通过 New API 网关 (192.168.100.47:3000) 统一接入。别名映射在网关侧配置，项目配置文件引用别名而非具体模型名。

---

## 二、插件系统

本项目使用 6 个 OpenCode 插件，按职责分层协作：

```
Layer 0 │ model-fallback    │ 模型降级安全网（自动）
Layer 1 │ superpowers       │ 质量门禁（brainstorming, TDD, debug, verification, code-review, finish-branch）
Layer 2 │ oh-my-opencode    │ Agent 编排（sisyphus, prometheus, oracle, momus, atlas, explore/librarian, categories）
Layer 2 │ ponytail          │ 懒情开发（YAGNI/stdlib/最短路径，强制简化）
Layer 3 │ openspec          │ Spec 文档编辑（openspec-plan agent，代码只读）
Layer 3 │ context-mode      │ 上下文管理（BM25 知识库，sandbox 代码执行）
```

### 2.1 superpowers — 工作流纪律层

提供结构化开发技能，确保 AI 遵循工程纪律。

**核心技能**:

| 技能 | 用途 | 触发场景 |
|---|---|---|
| `brainstorming` | 创意工作前必须使用 | 新功能、组件、行为变更 |
| `test-driven-development` | TDD 红-绿-重构循环 | 任何功能实现或 bug 修复 |
| `systematic-debugging` | 系统化调试流程 | 任何 bug、测试失败、异常行为 |
| `requesting-code-review` | 代码审查请求 | 完成任务、实现主要功能、合并前 |
| `verification-before-completion` | 完成前验证 | 声称工作完成/修复/通过时 |
| `dispatching-parallel-agents` | 并行 agent 分派 | 2+ 独立任务可并行时 |

> **重要**: `writing-plans`、`executing-plans`、`subagent-driven-development` 技能由 OMO 原生支持，请勿手动调用这些技能。


### 2.3 context-mode — 会话连续性

compact/重启后自动恢复工作状态，防止上下文丢失。

**可用命令**:

| 命令 | 功能 |
|---|---|
| `/ctx:stats` | 查看上下文统计 |
| `/ctx:search` | 搜索已索引内容 |
| `/ctx:doctor` | 诊断 context-mode |
| `/ctx:upgrade` | 升级 context-mode |
| `/ctx:purge` | 清除知识库（不可逆） |

### 2.4 oh-my-opencode (OMO) — Agent 编排核心

整个系统的中枢：模型路由、agent 分发、fallback 链、team mode。

通过 `task()` API 和 category 分发系统，自动将任务路由到合适的 agent 和模型层级。

---

## 三、Agent 体系

### 3.1 Agent 角色表

| Agent | 层级 | 角色 | 使用场景 |
|---|---|---|---|
| **Oracle** | premium-max | 只读咨询专家 | 架构设计、调试难题、复杂逻辑 |
| **Sisyphus** | premium | 主力执行器 | 多步骤任务、计划执行 |
| **Prometheus** | premium | 战略规划顾问 | 需求分析、工作规划、访谈 |
| **Hephaestus** | premium | 构建专家 | TypeScript/Node.js 代码实现、构建任务 |
| **Atlas** | premium | 代码导航 | 代码库探索、结构分析 |
| **Librarian** | fast | 信息检索 | 外部文档搜索、库文档查询 |
| **Explore** | fast | 代码探索 | 代码库内搜索、模式发现 |
| **Metis** | fast | 规划评审 | Prometheus 规划前的 gap 分析 |
| **Momus** | fast | 严格批判 | 工作计划的严格审查 |
| **Sisyphus-Junior** | fast | 轻量执行 | 简单任务、单文件修改 |
| **Multimodal-Looker** | vision | 视觉分析 | 图片、PDF、截图分析 |

### 3.2 Category 分发

通过 `task()` 按 category 自动匹配 agent 和模型：

| Category | 模型层 | 适用场景 |
|---|---|---|
| `ultrabrain` | premium-max | 高难度逻辑推理、复杂算法 |
| `artistry` | fast | 创造性问题解决 |
| `deep` | premium | 深度自主问题解决 |
| `visual-engineering` | premium | 前端、UI/UX、设计、样式、动画 |
| `quick` | fast | 简单修改、单文件变更 |
| `unspecified-high` | premium | 高难度通用任务 |
| `unspecified-low` | fast | 低难度通用任务 |
| `writing` | fast | 文档、技术写作 |

### 3.3 Fallback 机制

每个 agent/category 配置 3 级降级链，模型不可用时自动切换：

```
premium → premium-1 (qwen3.7-max) → premium-2 (glm-5.1)
fast    → fast-1 (qwen3.6-flash)  → fast-2 (doubao-seed-2.0-lite)
```

`runtime_fallback` 全局配置：
- 重试错误码: 402, 429, 500, 502, 503, 504
- 最多 2 次重试
- 冷却 60 秒
- 超时 60 秒

> **重要**: 本指南使用 agent 级别的 `fallback_models` 配置（在 `oh-my-openagent.jsonc` 中逐 agent 指定），同时启用 `runtime_fallback` 作为全局兜底。

---

## 四、团队模式

### 4.1 概述

团队模式通过 `team_*` 工具集实现多 agent 并行协作。Lead 协调任务分配，Members 并行执行独立子任务。

团队规格文件参考 `docs/team-mode.md`（如果存在）。

### 4.2 配置

```jsonc
// oh-my-openagent.jsonc
"team_mode": {
  "enabled": true,
  "tmux_visualization": false,
  "max_parallel_members": 4
}
```

### 4.3 使用方式

**创建团队**:
```
"用团队模式分析 X"  → AI 自动创建团队并分派任务
```

**手动创建**:
```
team_create → team_task_create → team_send_message → team_status
```

**团队结构**:
- **Lead**: 协调者（Sisyphus），分配任务、汇总结果
- **Members**: 并行执行独立子任务（按 category 自动匹配 agent）
- 最多 4 个并行成员

### 4.4 完整命令参考

| 命令 | 功能 |
|---|---|
| `team_create` | 创建团队运行 |
| `team_task_create` | 创建团队任务 |
| `team_task_update` | 更新任务状态/所有者 |
| `team_send_message` | 向成员发送消息 |
| `team_status` | 查看团队运行状态 |
| `team_delete` | 删除已完成团队 |
| `team_list` | 列出所有团队 |
| `team_shutdown_request` | 请求关闭成员 |
| `team_approve_shutdown` | 批准关闭请求 |
| `team_reject_shutdown` | 拒绝关闭请求 |

### 4.5 适用场景

| 场景 | 团队配置 |
|---|---|
| 多模块代码调研 | 2-3 个 explore + 1 个 oracle |
| 多文件重构 | 按模块分派 member |
| 对比分析 | 每个 member 负责一个方案 |
| 代码审查 | reviewer + security-reviewer + QA |
| 并行搜索 | 多个 librarian/explore 并行搜索 |

### 4.6 注意事项

- 团队任务必须**相互独立**（无共享状态）
- Lead 负责最终汇总，不参与并行执行
- 每个 member 使用自己的 agent session
- tmux 可视化需 tmux 已安装
- 团队完成后用 `team_delete` 清理

---

## 五、命令参考

### 5.1 Superpowers 命令

| 命令 | 功能 |
|---|---|
| `/start-work` | 从 Prometheus 计划启动 Sisyphus 执行 |
| `/review-work` | 启动 5 路并行审查（Oracle×2 + QA + Context Mining） |
| `/refactor` | 智能重构（LSP + AST-grep + 架构分析） |
| `/ralph-loop` | 启动自引用开发循环 |
| `/hyperplan` | 对抗性多 agent 规划（5 个敌对 reviewer） |
| `/handoff` | 创建详细上下文摘要供新会话继续 |

### 5.2 OMO 命令

| 命令 | 功能 | 使用场景 |
|---|---|---|
| `/fallback-status` | 查看模型 fallback 状态 | 排查模型不可用问题 |
| `task(category="...")` | 按 category 分派子 agent | 隔离上下文执行子任务 |
| `task(subagent_type="...")` | 按 agent 类型分派 | 直接指定 explore/librarian |
| `task(run_in_background=true)` | 后台并行执行 | 5+ 独立查询并行 |
| `task(task_id="...")` | 继续已有任务 | 多轮对话同一 agent |

**Category 速查**:

| Category | 模型层 | 用途 |
|---|---|---|
| `quick` | fast | 简单修改、单文件变更 |
| `deep` | premium | 深度自主问题解决 |
| `ultrabrain` | premium-max | 高难度逻辑推理 |
| `visual-engineering` | premium | 前端、UI/UX、设计 |
| `unspecified-high` | premium | 高难度通用任务 |
| `unspecified-low` | fast | 低难度通用任务 |
| `writing` | fast | 文档写作 |
| `artistry` | fast | 创造性问题解决 |

### 5.3 context-mode 命令
### 5.4 context-mode 命令

| 命令 | 功能 |
|---|---|
| `/ctx:stats` | 查看上下文统计 |
| `/ctx:search` | 搜索已索引内容 |
| `/ctx:doctor` | 诊断 context-mode |
| `/ctx:upgrade` | 升级 context-mode |
| `/ctx:purge` | 清除知识库（不可逆） |

### 5.5 内建命令

| 命令 | 功能 |
|---|---|
| `/playwright` | 浏览器自动化 |
| `/frontend-ui-ux` | 前端 UI/UX 设计 |
| `/git-master` | Git 操作专家 |
| `/debugging` | 系统化调试 |
| `/security-review` | 安全审查 |
| `/remove-ai-slops` | 移除 AI 代码异味 |
| `/visual-qa` | 视觉质量检查 |
| `/team-mode` | 团队模式文档 |

### 5.6 MCP 工具

AUDEBase 配置的 MCP 服务器：

| MCP | 阶段 | 功能 | 启用 |
|---|---|---|---|
| `codegraph` | 全部阶段 | AI 代码图谱 + 调用链分析（@colbymchenry/codegraph） | ✅ |
| `antd` | Phase 1（现在） | Ant Design 5 组件文档查询（@jzone-mcp/antd-components-mcp） | ✅ |
| `drizzle` | Phase 1（现在） | Drizzle ORM Schema 内省/迁移/查询（@iflow-mcp/defrex-drizzle-mcp） | ✅ |
| `playwright` | Phase 1（现在） | 浏览器自动化 E2E 测试（@playwright/mcp） | ✅ |
| `openspace` | Phase 1（现在） | OpenSpace MCP | ✅ |
| `postgres` | Phase 2（DB 就绪） | PostgreSQL schema/query/monitor | ❌ |

#### 阶段说明

- **Phase 1（现在）**: 开发活跃阶段 - codegraph（代码图谱）、antd（UI 组件）、drizzle（ORM）、playwright（浏览器测试）、openspace
- **Phase 2（DB 就绪）**: PostgreSQL 搭建后启用 - postgres（数据库管理），当前为 ❌

#### 排除的 MCP

以下 MCP 服务器经评估后不引入：

| MCP | 排除原因 |
|---|---|
| `process-mcp` | 与现有进程管理工具功能重叠 |
| `docker-mcp` | 未配置 Docker 环境 |
| `mcap-mcp` | GPL-3.0 许可证风险 |
> **注**: 所有 MCP 使用 MIT 许可证。初始化脚本位于 `.opencode/init-mcp-*.mjs`。MCP 启动使用 `.opencode/run-node.sh` 包装器解决 pixi 环境 node PATH 问题。

---


### 6.1 开发工作流概述

AUDEBase 项目当前处于 Phase 2 完成阶段 — 28 包全部实现，102 测试文件覆盖。工作流引擎 (Phase 4) 已完成。以下为 OpenCode 通用开发流程参考：

| # | 阶段 | 关键组件 | 说明 |
|---|------|----------|------|
| 1 | **Explore** | brainstorming + explore + librarian | 需求理解、代码调研 |
| 2 | **Specify** | openspec-plan agent | 编写 spec 文档 |
| 3 | **Plan** | prometheus → metis → momus | 制定实现计划 |
| 4 | **Build** | sisyphus + categories（并行） | 代码实现 |
| 5 | **Verify** | lsp + build + test + code-review | 质量门禁 |
| 6 | **Archive** | 更新 memorys/ 和 decisions.md | 变更记录 |
| 7 | **Finish** | finishing-a-development-branch → 用户确认 | 提交/合并 |
---

## 七、记忆系统

### 7.1 文件结构

项目记忆存放在 `.agents/memorys/`，按职责拆分 4 个文件。

OpenCode 已配置自动加载全部 4 个文件（通过 `opencode.json` 的 `instructions` 字段）。

| 文件 | 用途 | 更新时机 |
|---|---|---|
| `status.md` | 项目状态、迭代目标、阻塞项 | 状态变更 |
| `conventions.md` | 编码约定、命名规范、工具链 | 约定变更 |
| `decisions.md` | 关键架构决策 (ADR) | 重大决策后 |
| `pitfalls.md` | 踩坑记录及解决方案 | 遇到并解决问题后 |

### 7.2 更新规则

重要变更后必须更新对应记忆文件：

```
完成阶段 6 (Archive) 时:
  └─ decisions.md                    ← 新 ADR
  └─ decisions.md                    ← 新 ADR
  └─ pitfalls.md                     ← 新踩坑
  └─ status.md                       ← 状态更新
  └─ conventions.md                   ← 约定变更（如有）
```

### 7.3 文档放置规则

| 文档类型 | 位置 | 受众 |
|---|---|---|
| 项目知识库、工作流指令 | `AGENTS.md` | AI/Agent |
| 项目记忆 | `.agents/memorys/` | AI/Agent |
| 编码规则 | `.agents/rules/` | AI/Agent |
| 技能定义 | `.agents/skills/` | AI/Agent |
| 架构与设计文档 | `docs/` | AI/Agent + 人类用户 |
| 用户参考文档 | `docs/helps/` | 人类用户 |
| 变更日志 | git log + `.agents/memorys/status.md` | 人类用户 + AI/Agent |

> **`docs/` 目录**: 存放项目架构与设计文档。当前项目处于早期阶段，文档将随开发逐步完善。

> **禁令**: 不得在 `docs/helps/` 中创建工作流、AI 指令、Agent 协作类文档。此类文档放 `AGENTS.md` 或 `.agents/`。

---

## 八、最佳实践

### 8.1 模型选择策略

| 任务类型 | 推荐模型层 | Agent/Category |
|---|---|---|
| 架构设计、复杂调试 | premium-max | Oracle |
| 多步骤实现、计划执行 | premium | Sisyphus, deep |
| 代码搜索、文档查询 | fast | Librarian, Explore, quick |
| 图片/PDF 分析 | vision | Multimodal-Looker |
| 简单修改、单文件 | fast | Sisyphus-Junior, quick |

### 8.2 上下文管理

1. **使用 context-mode 管理上下文** — 自动索引重要内容
2. **compact 后自动恢复** — context-mode 自动重建状态
3. **用 explore/librarian 代替直接 grep** — 分派后台 agent 并行搜索
4. **分派独立子任务** — 用 `task(run_in_background=true)` 隔离上下文，子 agent 完成后自动清理
5. **手动修剪** — 使用 `/ctx:search` 检查上下文状态

### 8.3 并行执行

1. **独立任务用 `task(run_in_background=true)`** — 最多 8 个并行后台任务
2. **团队模式用于多角度分析** — 每个 member 独立研究
3. **Prometheus 计划中标记并行 wave** — 最大化吞吐
4. **硬件要求** — 12 核 CPU 以上可承载高并发

### 8.4 通用开发最佳实践

AUDEBase 技术栈已全栈决策（TypeScript + Node.js + Fastify + React 19 + Ant Design 5 + PostgreSQL + Drizzle ORM + Valkey）。以下为通用开发原则：

1. **不可变性优先**: 始终使用不可变数据结构，禁止原地修改
2. **结构化日志**: 使用结构化日志库，避免 `console.log`
3. **配置与代码分离**: 环境相关配置通过环境变量注入
4. **错误处理**: 显式处理所有错误路径，不静默吞掉异常
5. **输入验证**: 对所有外部输入进行验证
6. **测试先行**: 新功能先写测试，目标覆盖率 ≥ 80%

### 8.5 Git 约定

1. **分支命名**: `feat/`, `fix/`, `chore/` 前缀
2. **提交信息**: Conventional Commits 格式（`feat:` `fix:` `chore:` `docs:`）
3. **归属**: 通过 `~/.claude/settings.json` 全局禁用 AI 归属
4. **禁止**: AI 自动 git commit 或修改 `pixi.toml`
5. **提交前**: 须征得用户同意

> **项目状态**: Phase 2 完成, Phase 3 (OpenTelemetry + 插件市场 + Database-per-tenant) 待定, 工作流引擎 (Phase 4) 已完成。

### 8.6 文档编写风格

- 代码交互问答倾向使用中文
- 禁止 AI 自动 git commit
- 提交前须征得用户同意
- 变更记录格式: git commit message（Conventional Commits 格式）

---

## 九、配置文件速查

| 文件 | 路径 | 用途 |
|---|---|---|
| 项目配置 | `.opencode/opencode.json` | 插件、MCP、instructions、主模型、LSP |
| OMO 配置 | `.opencode/oh-my-openagent.jsonc` | Agent 模型、fallback、team mode |
| 系统配置 | `~/.config/opencode/opencode.jsonc` | API Key、Provider、模型别名 |
| TUI 配置 | `~/.config/opencode/tui.json` | 桌面通知（attention.enabled） |
| 模型层级 | `.opencode/agent-model-tiers.md` | 5 层模型映射参考（已创建） |
| 记忆文件 | `.agents/memorys/*.md` | status/conventions/decisions/pitfalls |
| 规则文件 | `.agents/rules/*.md` | 编码风格、安全规则 |
| 项目知识库 | `AGENTS.md` | 项目结构、工作流、命令 |
| 变更日志 | git log | 版本变更记录 |
| 版本文件 | `pixi.toml` [project.version] | pixi 项目版本（SemVer） |
| 工具链配置 | `pixi.toml` | pixi 多语言工具链（Node.js/conda） |

---

## 十、故障排除

### 10.1 常见问题

| 问题 | 解决方案 |
|---|---|
| 模型返回 503 | 自动 fallback 到下一级，无需手动干预 |
| 上下文过长 | 手动修剪上下文 |
| compact 后丢失状态 | context-mode 自动恢复，检查 `/ctx:stats` |
| 团队模式 member 失败 | Lead 自动重试或降级为直接执行 |
| pnpm 严格模式传递依赖不可见 | 未显式声明 react/react-dom，添加到 `dependencies` |

### 10.2 Fallback 状态检查

```bash
# 检查模型 fallback 状态
/fallback-status

# 查看当前使用的模型
/ctx:stats
```

### 10.3 LSP 诊断

```bash
# 检查 LSP 是否工作
# 观察 OpenCode TUI 错误面板

# 运行类型检查（待项目搭建后确定具体命令）
```

---

## 十一、快速上手

```bash
# 1. 启动 OpenCode
opencode

# 2. 日常开发
"帮我实现 X 功能"                              # → Prometheus 规划 → Sisyphus 执行
/start-work                                    # 从计划开始执行
/review-work                                   # 审查已完成工作

# 3. 上下文管理
/ctx:stats                                     # 查看上下文统计

# 4. 团队模式
"用团队模式分析 A、B、C 三个方案"               # 自动创建团队并行分析

# 5. 查看项目记忆
"查看项目当前状态"                              # → .agents/memorys/status.md
"项目有哪些踩坑记录"                            # → .agents/memorys/pitfalls.md
"查看架构决策"                                 # → .agents/memorys/decisions.md
```
