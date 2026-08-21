---
name: doc-audit
description: "AccessBase 项目文档与架构审计。并行检查 AGENTS.md、记忆文件、决策记录、规则体系之间的自洽性、完整性、缺口和优化机会。以交互式问答与用户逐项确认每项发现，列出详情、方案与优劣、来源、影响、推荐。支持团队模式(大型审计)和背景代理模式(轻量检查)。"
---

# 文档架构审计 (Document & Architecture Audit)

对 AccessBase 企业应用开发平台文档体系进行全面审计。

**哲学**: 审计不是找茬，是清债务。文档债务和代码债务一样危险。每次审计解决一批，文档体系往前一步。

---

## 入口：审计类型

### `/doc-audit`（无参数）
弹出审计类型菜单：

```
[1] 完整审计 - 全部 6 维度（默认）
[2] 决策验证 - decisions.md D1-D24 + G1-G5 落实情况
[3] 文档一致性 - AGENTS.md ↔ memorys ↔ rules 交叉检查
[4] 参考验证 - docs/ 竞品调研 ↔ 当前架构
[5] 缺口优化 - 运维/安全/可靠性/测试覆盖扫描
[6] 阶段审计 - SDD / TDD / 实施计划
[7] 踩坑验证 - pitfalls.md 记录是否仍然有效
```

### `/doc-audit full`
直接启动全量审计，跳过菜单。等效于 `[1] 完整审计`。

### `/doc-audit <维度名>`
启动指定维度。如 `decisions` / `consistency` / `references` / `gaps` / `phase` / `pitfalls`。

### `/doc-audit quick-fix`
仅检查 LOW/MEDIUM 级别问题并自动修复，不进入交互审核。

### `/doc-audit custom`
进入自定义模式：选择维度 + 文件范围 + 是否包含规则文件。

---

## 审计维度

### 1. 决策验证 (Decision-Validator)
核查 `.agents/memorys/decisions.md` D1-D24 (+ D1.1-D1.14 子决策 + G1-G5 通用决策) 在 AGENTS.md / conventions.md / status.md / pitfalls.md 中的落实。

**核心问题**：
- D 系列决策结论是否正确反映在文档中？
- 是否存在「决策说了A，文档写了B」的矛盾？
- D 系列中的陈旧引用是否需要更新？（如已被后续决策替代）
- **决策新鲜度**：某条决策是否已过时？（技术变迁、被后续决策替代、理由不再成立）
- 决策引用的文件路径/符号是否仍然存在？（文档重构后路径漂移）
- **废弃决策追踪**：D6(旧 shadcn/ui)、D6.1(旧 registry fork) 等已废弃决策是否在相关文档中清除残留引用？

**检查范围**：
- `.agents/memorys/decisions.md` (D1-D24, D1.1-D1.14, G1-G5)
- `AGENTS.md` (项目知识库)
- `.agents/memorys/status.md` (项目状态)
- `.agents/memorys/conventions.md` (编码约定)
- `.agents/memorys/pitfalls.md` (踩坑记录)

### 2. 文档一致性 (Consistency-Checker)
核查 AGENTS.md ↔ memorys/ ↔ rules/ ↔ skills/ 交叉一致性。

**核心问题**：
- 技术栈描述是否一致？（AGENTS.md 的 Tech Stack vs conventions.md vs agent-guide.md vs docs/modules/tech-stack.md）
- 路径引用是否一致？（文件位置在 AGENTS.md STRUCTURE vs 实际目录树）
- 命名规则是否一致？（npm scope `@audebase/`、插件包名 `@audebase/plugin-{name}`、路由 dot 命名、Slot dot 命名）
- 文档放置规则是否被遵守？（`docs/` 下用户文档 vs `.agents/` 下 AI 指令）
- 规则文件与项目实际规范是否匹配？（rules/typescript/ vs conventions.md TypeScript 规范）
- 重复内容：AGENTS.md vs agent-guide.md 是否有大段重复需折叠为引用？
- 构建命令一致性：AGENTS.md vs pixi.toml tasks vs scripts/
- 模型层级一致性：agent-model-tiers.md vs oh-my-openagent.jsonc 实际配置
- **MCP 配置一致性**：opencode.json MCP 服务器列表 vs status.md MCP 工具链表 vs init-mcp-*.mjs 实际脚本
- **SDD/TDD 索引一致性**：AGENTS.md CODE MAP 表 vs status.md SDD/TDD 表 vs docs/modules/ 实际文件
- **Phase 划分一致性**：phase-planning.md vs status.md 模块状态表 vs architecture.md 路线图

**检查范围**：
- `AGENTS.md`
- `.agents/memorys/*.md`
- `.agents/rules/**/*.md`
- `.opencode/agent-guide.md`
- `.opencode/agent-model-tiers.md`
- `.opencode/oh-my-openagent.jsonc`
- `.opencode/opencode.json`
- `docs/architecture.md`
- `docs/phase-planning.md`
- `docs/modules/tech-stack.md`

### 3. 参考验证 (Reference-Crosschecker)
核查 `docs/` 中竞品调研、插件架构分析等参考文档对 AccessBase 设计的吸收情况。

**核心问题**：
- `competitive-landscape.md` 39+ 产品调研中的关键发现是否反映在架构决策中？
- `plugin-architecture-analysis.md` 四层信任分组分析中的发现是否与当前 D1.1 决策一致？
- `docs/reference/` 15 份竞品画像中的安全 CVE 教训是否落实在 pitfalls.md 行业安全教训表中？
- NocoBase/Odoo/Directus/Strapi 等参考项目的模式映射是否反映在当前架构设计中？
- 已验证的模式可映射到 AccessBase 架构？

**检查范围**：
- `docs/competitive-landscape.md`
- `docs/plugin-architecture-analysis.md`
- `docs/reference/*.md` (15 份竞品画像)
- `docs/architecture.md` (架构决策落地)
- `.agents/memorys/decisions.md` (D 系列决策引用)

### 4. 缺口优化 (Gap-Optimizer)
扫描缺失的关键设计章节和未实现功能。

**核心问题**：
- **运维/可观测性**：健康检查端点 (D1.13)、结构化日志 (logging-infra-sdd)、Core 日志聚合、Redis 连接监控、Drizzle 连接池监控 (D9.1)
- **安全架构**：JWT 密钥管理 (D8.1)、Zod 边界验证 (D8)、Core 数据 API 代理防绕过 (D12)、Record Rules 自动注入 (D10)、RBAC 权限引擎、审计日志 (D1.12)
- **错误模型**：Fastify 请求错误处理、插件加载失败恢复 (migration_failed 状态)、Saga 补偿事务 (D13)、前端 Error Boundary (D20)
- **多租户隔离**：tenant_id 字段隔离 (D4)、文件存储隔离 (D4.1)、前端 URL 路径前缀 (D24)、租户切换缓存清理
- **资源限制**：每插件 CPU/内存预算（Phase 2 process 模式）、Redis 连接数、DB 连接池大小 (pg-pool 默认 10)
- **升级策略**：npm 依赖升级 (Renovate)、Drizzle ORM 版本锁定 (0.45.x LTS)、Ant Design 版本锁定 + CVE 监控 (D6.1)、pixi 环境更新
- **测试覆盖**：status.md 列出测试框架未安装，哪些 SDD/TDD 文档已就绪但缺少测试基础设施？
- **未实现功能**：packages/ 目录未创建（Phase 1a Week 0）、shared-types 未初始化、无 build scripts、无 CI/CD 配置

**检查范围**：
- `AGENTS.md` 项目状态概览（CODE MAP 表）
- `.agents/memorys/status.md` 已知缺失 + 模块状态
- `docs/architecture.md` MVP 验收标准
- `docs/phase-planning.md` Phase 1a/1b 路线图

### 5. 阶段审计 (Phase Audit)

#### 5a. SDD 文档审计
核查 `docs/modules/*-sdd.md` 是否覆盖 AGENTS.md 架构描述的所有功能点。

**核心问题**：
- SDD 文档是否覆盖所有 Phase 1a 模块的接口定义？（shared-types, plugin-framework, plugin-core, manifest-engine, migration-engine, rbac, audit, health-check, i18n, admin-ui, logging-infra）
- SDD 接口定义与 architecture.md 中的 API 规范是否一致？
- 边界条件是否枚举完整？
- Mock 约束是否满足 5 项要求？（async Promise、JSON 序列化、30s 超时、延迟注入、ProcessPluginHost 保真度）
- SDD 文档中的生命周期钩子是否与 D1.4（7 钩子）一致？

**检查范围**：
- `docs/modules/*-sdd.md` (11 份 SDD 文档)
- `docs/modules/api-specification.md` (19 端点)
- `docs/modules/database-schema.md` (11 张表 DDL)
- `docs/architecture.md` (架构描述)

#### 5b. TDD 测试审计
核查测试计划是否覆盖关键功能点。

**核心问题**：
- TDD 测试用例是否覆盖 SDD 定义的接口契约？
- 测试用例是否遵循 AAA 结构（Arrange-Act-Assert）？
- 种子工厂策略是否与 test-seed-strategy.md 一致？
- Mock 约束是否与 redis-mock-guide.md 一致？（ioredis-mock + BullMQ testMode）
- E2E 测试流程是否覆盖 5 核心流程？（e2e-test-flows.md）
- 测试覆盖率目标 80% 是否在所有 TDD 文档中声明？
- 测试文件命名是否遵循 `{module}.test.ts` / `{module}.spec.ts` / `{module}.contract.test.ts` 约定？

**检查范围**：
- `docs/modules/*-tdd.md` (11 份 TDD 文档)
- `docs/modules/test-seed-strategy.md`
- `docs/modules/redis-mock-guide.md`
- `docs/modules/e2e-test-flows.md`
- `docs/modules/dev-workflow.md` (测试策略)

#### 5c. 实施计划审计
核查实施计划是否与架构文档对齐。

**核心问题**：
- `docs/plans/*.md` 实施步骤是否按依赖顺序编排？
- 并行 Wave 划分是否合理？（无文件重叠、无依赖缺失）
- 计划中的文件路径是否与实际项目结构匹配？（packages/ 目录规划）
- Phase 1a Week 0 任务是否覆盖基础设施初始化？（shared-types、vitest、tsconfig、turbo.json）
- 验收标准是否与 phase1a-acceptance-checklist.md 一致？

**检查范围**：
- `docs/plans/phase1a-master-plan.md`
- `docs/plans/phase1a-week0.md`
- `docs/plans/phase1a-execution-guide.md`
- `docs/plans/phase1a-acceptance-checklist.md`
- `docs/phase-planning.md` (Phase 划分单一真实来源)

### 6. 踩坑验证 (Pitfall-Validator)
核查 `.agents/memorys/pitfalls.md` 中的踩坑记录是否仍然有效。

**核心问题**：
- 踩坑记录引用的文件路径/行号是否仍然准确？（文档重构后路径漂移）
- 踩坑记录的解决方案是否已被后续变更覆盖或替代？
- 是否有新的踩坑未记录？（git log 中有 fix 但 pitfalls.md 无对应条目）
- D 系列决策与 pitfalls 是否交叉引用？（如 D8.1 JWT ↔ pitfalls NocoBase CVE-2025-13877）
- **MCP 集成坑点**：drizzle-mcp 包名陷阱、npmmirror 镜像缺失、pixi run 连接断开等是否仍然有效？
- **Bootstrap 脚本坑点**：pixi platforms 锁文件、batch setlocal、macOS realpath 等是否仍然适用？
- **前端架构坑点**：ProLayout findDOMNode、ProTable antd v6 兼容性、动态 import() 签名、CWE-524 信息泄露等是否仍然有效？

**检查范围**：
- `.agents/memorys/pitfalls.md`
- `.agents/memorys/decisions.md` (交叉引用)
- `git log` (近期 fix 提交)

### 7. 代码→规范追溯 (Phase 1a+ 预留)
当源代码存在时：核查 TypeScript 代码实现是否与设计文档一致。

**核心问题**：
- 实现是否匹配 AGENTS.md 中描述的插件框架架构？（微内核 + 四层信任分组 + 7 生命周期钩子）
- TypeScript 类型定义是否与 SDD 接口定义一致？
- 测试是否覆盖 SDD 中定义的边界条件？
- 是否存在 SDD 未覆盖的实现细节？
- shared-types 包中的类型是否与 api-specification.md / api-conventions.md 一致？
- RBAC 实现是否满足 D10 Record Rules 自动注入？
- 插件 manifest.yaml 解析是否满足 D1.5 字段规范？

**检查范围**：
- `packages/shared-types/` (Phase 1a Week 0)
- `packages/plugin-framework/`
- `plugins/plugin-core/`
- `packages/manifest-engine/`
- `packages/migration/`
- `packages/rbac/`
- `packages/audit/`
- `packages/health-check/`
- `packages/i18n/`
- `packages/logging-infra/`
- 对应 SDD/TDD 文档

---

## 审计模式

### A. 团队模式（推荐 - 大型审计）
3+ 份大型文档 -> `team_create` 4-6 个 `ultrabrain` 成员并行。

```
team_create(inline_spec={
  name: "doc-audit",
  members: [
    { name: "decision-validator", category: "ultrabrain", prompt: "<维度核心问题 + 文件列表 + 输出格式>" },
    { name: "consistency-checker", category: "ultrabrain", prompt: "..." },
    { name: "reference-crosschecker", category: "ultrabrain", prompt: "..." },
    { name: "gap-optimizer", category: "ultrabrain", prompt: "..." }
  ]
})
```

**Conductor 规范**（调度者行为）：
- 启动后立即向用户报告：「启动 N 路并行审计，预计 3-5 分钟」
- 等待全部完成前只做「非重叠工作」（如预读文档）
- 全部完成后：**去重合并**（同问题被 2+ 维度发现 -> 合并为 1 项，标注多来源）
- 按严重性排序：CRITICAL -> HIGH -> MEDIUM -> LOW
- 超时处理：任一路超过 10 分钟未产出 -> 标注为「超时，部分结果」继续
- 冲突处理：维度 A 说 X、维度 B 说 Y -> 标记为人类审核

### B. 背景代理模式（轻量审计）
少量文档 -> `task(category="deep", run_in_background=true)` × N 并行。

### C. 单线程模式
极小范围 -> 直接用 Read/Grep 检查，不启动子代理。

---

## 交互审核：发现项格式

**逐项审核**，每项使用 `question()` 工具展示。

```markdown
## 🔴/🟠/🟡/🔵 [编号]: [标题]

### 详情
| 来源1 | 位置 | 内容 |
|--------|------|------|
| 文档A | 行X | ... |
| 文档B | 行Y | ... |

### 来源
- 审计维度：[维度名]
- 原始发现：[报告] 第N项

### 可选方案
| 方案 | 优势 | 劣势 |
|------|------|------|
| A. [方案名] | ... | ... |
| B. [方案名] | ... | ... |

### 影响
- 选A：[连锁修改清单]

### 推荐
[方案X]。[理由]
```

选项：
- 采纳推荐方案 / 选择其他方案 / 不处理 / 自定义

进度：`[第N/共M项]`

---

## 工作流

### Phase 1: 启动
1. 确认审计范围和类型
2. 选择模式（团队/背景/单线程）
3. 报告：「启动 N 路并行审计，预计 3-5 分钟」

### Phase 2: 合并
1. 去重：同问题多来源 -> 合并标注
2. 排序：CRITICAL -> HIGH -> MEDIUM -> LOW
3. 交叉印证：2+ 维度同意的提升优先级

### Phase 3: 交互审核
逐项审核，question() 交互确认。

### Phase 4: 修复
1. 创建 todo list
2. 按依赖顺序：先改 decisions.md -> 再改 AGENTS.md -> 再改 memorys -> 最后改 rules
3. 每次编辑后验证（grep 残留引用、MODACS 残留检查）

### Phase 5: 报告
```
审计完成 - [日期]
审计类型: [全量/决策/一致性/参考/缺口/阶段/踩坑]
发现总数: N | 已修复: M | 不处理: K
下次建议: [问题密集区域]
```

---

## 快速参考

### 审计命令
```
/doc-audit              -> 选择类型
/doc-audit full         -> 全量审计
/doc-audit quick-fix    -> 自动修复 LOW/MEDIUM
/doc-audit phase sdd    -> SDD 文档审计
/doc-audit phase tdd    -> TDD 测试审计
/doc-audit phase plan   -> 实施计划审计
/doc-audit pitfalls     -> 踩坑验证
```

### 严重性标准
| 严重性 | 触发条件 | 阻断当前迭代? |
|--------|---------|:---:|
| 🔴 CRITICAL | 文档矛盾导致实现路径错误 / 决策被推翻 / 核心接口缺失 | ✅ |
| 🟠 HIGH | 陈旧引用 / 路径不一致 / 构建命令矛盾 / 重复文档 | ⚠️ |
| 🟡 MEDIUM | 表述差异 / 示例冲突 / 缺失不阻断当前迭代 | ❌ |
| 🔵 LOW | 格式不一致 / 引用缺失 / 待确认标记 | ❌ |

### AccessBase 文档体系总览

| 文档 | 路径 | 受众 | 审计维度 |
|------|------|------|----------|
| 项目知识库 | `AGENTS.md` | AI/Agent | 一致性、缺口 |
| 项目状态 | `.agents/memorys/status.md` | AI/Agent | 决策、缺口 |
| 编码约定 | `.agents/memorys/conventions.md` | AI/Agent | 决策、一致性 |
| 架构决策 | `.agents/memorys/decisions.md` | AI/Agent | 决策验证 |
| 踩坑记录 | `.agents/memorys/pitfalls.md` | AI/Agent | 踩坑验证 |
| 编码规则 | `.agents/rules/**/*.md` | AI/Agent | 一致性 |
| 技能定义 | `.agents/skills/*/SKILL.md` | AI/Agent | 一致性 |
| 架构文档 | `docs/architecture.md` | AI/Agent + 人类 | 一致性、缺口 |
| Phase 划分 | `docs/phase-planning.md` | AI/Agent + 人类 | 一致性、阶段 |
| 插件架构分析 | `docs/plugin-architecture-analysis.md` | AI/Agent | 参考验证 |
| 竞品调研 | `docs/competitive-landscape.md` | AI/Agent + 人类 | 参考验证 |
| 竞品画像 | `docs/reference/*.md` | AI/Agent + 人类 | 参考验证 |
| SDD 文档 | `docs/modules/*-sdd.md` | AI/Agent | SDD 审计 |
| TDD 文档 | `docs/modules/*-tdd.md` | AI/Agent | TDD 审计 |
| 测试策略 | `docs/modules/test-seed-strategy.md`, `redis-mock-guide.md`, `e2e-test-flows.md` | AI/Agent | TDD 审计 |
| API 规范 | `docs/modules/api-specification.md`, `api-conventions.md` | AI/Agent | SDD 审计 |
| 数据库 Schema | `docs/modules/database-schema.md` | AI/Agent | SDD 审计 |
| 前端规范 | `docs/modules/frontend-spec.md` | AI/Agent | 一致性 |
| 开发工作流 | `docs/modules/dev-workflow.md` | AI/Agent | 一致性 |
| 实施计划 | `docs/plans/*.md` | AI/Agent | 阶段审计 |
| OpenCode 配置 | `.opencode/opencode.json` | AI/Agent | 一致性 |
| Agent 指南 | `.opencode/agent-guide.md` | AI/Agent | 一致性 |
| 模型层级 | `.opencode/agent-model-tiers.md` | AI/Agent | 一致性 |
| Agent 配置 | `.opencode/oh-my-openagent.jsonc` | AI/Agent | 一致性 |

### 审计建议频率
- 每次新决策后：`/doc-audit decisions`
- Phase 阶段转换前：`/doc-audit full`
- 每周开发期间：`/doc-audit full`
- 每次文档大改后：`/doc-audit consistency`
- 每次踩坑解决后：`/doc-audit pitfalls`
- 测试基础设施变更后：`/doc-audit phase tdd`
- SDD/TDD 文档新增/更新后：`/doc-audit phase sdd`
