---
name: doc-audit
description: 'AccessBase 项目文档与架构审计。并行检查 AGENTS.md、记忆文件、决策记录、规则体系之间的自洽性、完整性、缺口和优化机会。以交互式问答与用户逐项确认每项发现，列出详情、方案与优劣、来源、影响、推荐。支持团队模式(大型审计)和背景代理模式(轻量检查)。Use when the user asks for documentation/architecture consistency checks or says 文档审计.'
---

# 文档架构审计 (Document & Architecture Audit)

对 AccessBase 企业应用开发平台文档体系进行全面审计。

**哲学**: 审计不是找茬，是清债务。文档债务和代码债务一样危险。每次审计解决一批，文档体系往前一步。

---

## 入口：审计类型

### `/doc-audit`（无参数）

弹出审计类型菜单：

```
[1] 完整审计 - 全部维度（默认）
[2] 决策验证 - decisions.md 决策落实情况
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

核查 `.agents/memorys/decisions.md` 的决策（编号范围以文件自身为准，勿假设上界）在 AGENTS.md / conventions.md / status.md / pitfalls.md 中的落实。

**核心问题**：

- D 系列决策结论是否正确反映在文档中？
- 是否存在「决策说了A，文档写了B」的矛盾？
- D 系列中的陈旧引用是否需要更新？（如已被后续决策替代）
- **决策新鲜度**：某条决策是否已过时？（技术变迁、被后续决策替代、理由不再成立）
- 决策引用的文件路径/符号是否仍然存在？（文档重构后路径漂移）
- **废弃决策追踪**：decisions.md 中已标记废弃的决策，是否在相关文档中清除残留引用？（以 decisions.md 自身的标注为准，不要引用记忆中的编号语义）

**检查范围**：

- `.agents/memorys/decisions.md`
- `AGENTS.md` (项目知识库)
- `.agents/memorys/status.md` (项目状态)
- `.agents/memorys/conventions.md` (编码约定)
- `.agents/memorys/pitfalls.md` (踩坑记录)

### 2. 文档一致性 (Consistency-Checker)

核查 AGENTS.md ↔ memorys/ ↔ rules/ ↔ skills/ 交叉一致性。

**核心问题**：

- 技术栈描述是否一致？（AGENTS.md 的 Tech Stack vs conventions.md vs agent-guide.md vs docs/modules/tech-stack.md）
- 路径引用是否一致？（文件位置在 AGENTS.md STRUCTURE vs 实际目录树）
- 命名规则是否一致？（npm scope `@accessbase/*`、pnpm workspace 包名与 packages/ 实际目录）
- 文档放置规则是否被遵守？（`docs/` 下用户文档 vs `.agents/` 下 AI 指令）
- 规则文件与项目实际规范是否匹配？（rules/typescript/ vs conventions.md TypeScript 规范）
- 重复内容：AGENTS.md vs agent-guide.md 是否有大段重复需折叠为引用？
- 构建命令一致性：AGENTS.md vs pixi.toml tasks vs scripts/
- 模型层级一致性：.opencode/agent-model-tiers.md vs .opencode/opencode.json 实际配置（oh-my-openagent.jsonc 不存在，勿引用）
- **MCP 配置一致性**：opencode.json MCP 服务器列表 vs status.md MCP 工具链表 vs init-mcp-*.mjs 实际脚本
- **SDD/TDD 索引一致性**：AGENTS.md WHERE TO LOOK 表 vs status.md vs docs/modules/ 实际文件（AGENTS.md 无 CODE MAP 表）
- **计划一致性**：docs/implementation-plan.md vs status.md vs docs/modules/ 各状态头

**检查范围**：

- `AGENTS.md`
- `.agents/memorys/*.md`
- `.agents/rules/**/*.md`
- `.opencode/agent-guide.md`
- `.opencode/agent-model-tiers.md`
- `.opencode/opencode.json`
- `docs/architecture.md`
- `docs/implementation-plan.md`

### 3. 参考验证 (Reference-Crosschecker)

核查 `docs/` 中竞品调研、插件架构分析等参考文档对 AccessBase 设计的吸收情况。

**核心问题**：

- `docs/reference/` 竞品画像（20 份，以 glob 为准）中的关键发现是否反映在架构决策中？
- `.refinfo/` 各参考实现的模式是否与当前架构一致？（READ ONLY，仅作模式参照）
- 竞品画像中的安全 CVE 教训是否落实在 pitfalls.md 中？
- NocoBase/Odoo/Directus/Strapi 等参考项目的模式映射是否反映在当前架构设计中？
- 已验证的模式可映射到 AccessBase 架构？

**检查范围**：

- `.refinfo/*`（READ ONLY 参考实现）
- `docs/reference/*.md`
- `docs/architecture.md` (架构决策落地)
- `.agents/memorys/decisions.md` (D 系列决策引用)

### 4. 缺口优化 (Gap-Optimizer)

扫描缺失的关键设计章节和未实现功能。

**核心问题**：

- **缺口清单来源**：`docs/implementation-plan.md` 是唯一权威——L2（工程健康 E1-E10）+ L3b（deferred 账本）。**不要凭目录外观发明缺口**：Tier-3 项是 signal-gated 的设计意图，不是待办。
- **已知未闭合（快照 asOf 2026-11-05，以账本为准）**：coverage ratchet 停滞（E1/E2，admin-ui 2.51%）；API deprecation 政策缺失（T18）；e2e mock 失败归因悬置（E10）；alerting 集成为 operator posture 决策（P3-A）

**检查范围**：

- `docs/implementation-plan.md`（L2 + L3b 账本）
- `AGENTS.md` OVERVIEW / Status 行
- `.agents/memorys/status.md` 模块状态
- `docs/modules/overview.md` 模块索引

### 5. 阶段审计 (Phase Audit)

#### 5a. SDD 文档审计

核查 `docs/modules/*-sdd.md` 是否覆盖 AGENTS.md 架构描述的所有功能点。

**核心问题**：

- SDD 文档（8 份，以 glob 为准）是否覆盖其对应模块的接口定义？（以 docs/architecture.md 的模块索引为准）
- SDD 接口定义与 architecture.md 中的 API 规范是否一致？
- 边界条件是否枚举完整？
- E2E mock 约束是否符合既定策略？（D106：mock 默认，setup/init 用真后端；D104：不覆盖跨 session 状态）

**检查范围**：

- `docs/modules/*-sdd.md`（8 份，以 glob 为准）
- `docs/modules/api.md` + `docs/openapi.json`
- `docs/modules/database.md`
- `docs/architecture.md` (架构描述)

#### 5b. TDD 测试审计

核查测试计划是否覆盖关键功能点。

**核心问题**：

- TDD 测试用例是否覆盖 SDD 定义的接口契约？
- 测试用例是否遵循 AAA 结构（Arrange-Act-Assert）？
- 测试数据是否独立、不跨 session 共享？（D104/e2e 约定）
- 测试覆盖率目标 80% 是否在所有 TDD 文档中声明？
- 测试文件命名是否遵循 `{module}.test.ts` / `{module}.spec.ts` / `{module}.contract.test.ts` 约定？

**检查范围**：

- `docs/modules/*-tdd.md`（当前为 0 份——测试计划由 test-harness skill 生成，测试落在 vitest/e2e；此约定改变前保持 0）
- `e2e/*.spec.ts` + `e2e/helpers/`
- `vitest.config.ts` / `playwright.config.ts`
- `apps/*/src/__tests__/`、`packages/*/src/*.test.ts`

#### 5c. 实施计划审计

核查实施计划是否与架构文档对齐。

**核心问题**：

- `docs/implementation-plan.md` 的阶段（S0-S7）是否按依赖顺序编排？
- 并行 Wave 划分是否合理？（无文件重叠、无依赖缺失）
- 计划中的文件路径是否与实际项目结构匹配？
- 每阶段的 Acceptance 列是否可机器验证或可复现？

**检查范围**：

- `docs/implementation-plan.md`（活计划，单一权威）
- `docs/superpowers/plans/`（批次计划，快照）

### 6. 踩坑验证 (Pitfall-Validator)

核查 `.agents/memorys/pitfalls.md` 中的踩坑记录是否仍然有效。

**核心问题**：

- 踩坑记录引用的文件路径/行号是否仍然准确？（文档重构后路径漂移）
- 踩坑记录的解决方案是否已被后续变更覆盖或替代？
- 是否有新的踩坑未记录？（git log 中有 fix 但 pitfalls.md 无对应条目）
- D 系列决策与 pitfalls 是否交叉引用？（决策 ↔ 踩坑互链，以两文件自身内容为准）
- **MCP 集成坑点**：drizzle-mcp 包名陷阱、npmmirror 镜像缺失、pixi run 连接断开等是否仍然有效？
- **Bootstrap 脚本坑点**：pixi platforms 锁文件、batch setlocal、macOS realpath 等是否仍然适用？
- **前端架构坑点**：ProLayout findDOMNode、ProTable antd v6 兼容性、动态 import() 签名、CWE-524 信息泄露等是否仍然有效？

**检查范围**：

- `.agents/memorys/pitfalls.md`
- `.agents/memorys/decisions.md` (交叉引用)
- `git log` (近期 fix 提交)

### 7. 代码→规范追溯

当源代码存在时：核查 TypeScript 代码实现是否与设计文档一致。

**核心问题**：

- 实现是否匹配 docs/modules/ 各 SDD 的接口定义？
- TypeScript 类型定义是否与 SDD 接口定义一致？
- 测试是否覆盖 SDD 中定义的边界条件？
- 是否存在 SDD 未覆盖的实现细节？
- RBAC 强制是否走 requirePermission preHandler？（D115）
- 路由/服务行为与 api.md §23 约定及 docs/openapi.json 是否一致？

**检查范围**：

- `packages/`（8 包：admin, audit, health, i18n, identity, logging, migration, types）
- `apps/server/src/`、`apps/admin-ui/src/`
- 对应 SDD 文档（docs/modules/*-sdd.md）

---

## 审计模式

### A. 团队模式（opt-in - 大型审计；宿主有 team 能力时）

3+ 份大型文档且宿主具备 team 能力 -> 3-5 个只读成员并行（对齐
`skill:expert-panel-review` 的 dual-track 形态：sequential 是 DEFAULT，parallel 需 opt-in；
隔离纪律——每个成员只拿审计对象 + 自己的 brief + 共享验收标准，绝不投喂前一成员的结论）。

> 下面的示例是 OpenCode `team_create` 语法（`subagent_type: "oracle"` 亦为该宿主专有），仅作
> 参考形态保留；宿主没有 team API 时按 sequential track 顺序执行同一 brief。

```
team_create(inline_spec={
  name: "doc-audit",
  members: [
    { name: "decision-validator", kind: "subagent_type", subagent_type: "oracle", prompt: "<维度核心问题 + 文件列表 + 输出格式>" },
    { name: "consistency-checker", kind: "subagent_type", subagent_type: "oracle", prompt: "..." },
    { name: "reference-crosschecker", kind: "subagent_type", subagent_type: "oracle", prompt: "..." }
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

**逐项审核**，每项以纯文本展示（`question()` 工具的 JSON 转义会破坏选项格式——adjudication-walkthrough 已有三次记录在案的事故，禁用）。

```markdown
## 🔴/🟠/🟡/🔵 [编号]: [标题]

### 详情

| 来源1 | 位置 | 内容 |
| ----- | ---- | ---- |
| 文档A | 行X  | ...  |
| 文档B | 行Y  | ...  |

### 来源

- 审计维度：[维度名]
- 原始发现：[报告] 第N项

### 可选方案

| 方案        | 优势 | 劣势 |
| ----------- | ---- | ---- |
| A. [方案名] | ...  | ...  |
| B. [方案名] | ...  | ...  |

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

逐项审核，纯文本逐项确认（禁 question() 工具）。

### Phase 4: 修复

1. 创建 todo list
2. 按依赖顺序：先改 decisions.md -> 再改 AGENTS.md -> 再改 memorys -> 最后改 rules
3. 每次编辑后验证（grep 残留引用、残留矛盾检查）

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

| 严重性      | 触发条件                                             | 阻断当前迭代? |
| ----------- | ---------------------------------------------------- | :-----------: |
| 🔴 CRITICAL | 文档矛盾导致实现路径错误 / 决策被推翻 / 核心接口缺失 |      ✅       |
| 🟠 HIGH     | 陈旧引用 / 路径不一致 / 构建命令矛盾 / 重复文档      |      ⚠️       |
| 🟡 MEDIUM   | 表述差异 / 示例冲突 / 缺失不阻断当前迭代             |      ❌       |
| 🔵 LOW      | 格式不一致 / 引用缺失 / 待确认标记                   |      ❌       |

### AccessBase 文档体系总览

| 文档          | 路径                                                 | 受众            | 审计维度     |
| ------------- | ---------------------------------------------------- | --------------- | ------------ |
| 项目知识库    | `AGENTS.md`                                          | AI/Agent        | 一致性、缺口 |
| 活计划        | `docs/implementation-plan.md`                        | AI/Agent        | 一致性、缺口 |
| 项目状态      | `.agents/memorys/status.md`                          | AI/Agent        | 决策、缺口   |
| 编码约定      | `.agents/memorys/conventions.md`                     | AI/Agent        | 决策、一致性 |
| 架构决策      | `.agents/memorys/decisions.md`                       | AI/Agent        | 决策验证     |
| 踩坑记录      | `.agents/memorys/pitfalls.md`                        | AI/Agent        | 踩坑验证     |
| 编码规则      | `.agents/rules/**/*.md`                              | AI/Agent        | 一致性       |
| 技能定义      | `.agents/skills/*/SKILL.md`                          | AI/Agent        | 一致性       |
| 架构索引      | `docs/architecture.md` → `docs/modules/`             | AI/Agent + 人类 | 一致性、缺口 |
| 模块文档      | `docs/modules/*.md`（含 *-sdd.md，数量以 glob 为准） | AI/Agent + 人类 | 一致性、阶段 |
| 参考画像      | `docs/reference/*.md`                                | AI/Agent + 人类 | 参考验证     |
| 参考实现      | `.refinfo/*`（READ ONLY）                            | AI/Agent        | 参考验证     |
| API 契约      | `docs/modules/api.md` + `docs/openapi.json`          | AI/Agent        | 一致性       |
| 数据库 Schema | `docs/modules/database.md`                           | AI/Agent        | 一致性       |
| Runbook       | `docs/runbooks/*.md`                                 | AI/Agent + 人类 | 一致性       |
| 批次计划/报告 | `docs/superpowers/{plans,reports}/`                  | AI/Agent        | 阶段审计     |
| OpenCode 配置 | `.opencode/opencode.json`                            | AI/Agent        | 一致性       |
| Agent 指南    | `.opencode/agent-guide.md`                           | AI/Agent        | 一致性       |
| 模型层级      | `.opencode/agent-model-tiers.md`                     | AI/Agent        | 一致性       |

### 审计建议频率

- 每次新决策后：`/doc-audit decisions`
- Phase 阶段转换前：`/doc-audit full`
- 每周开发期间：`/doc-audit full`
- 每次文档大改后：`/doc-audit consistency`
- 每次踩坑解决后：`/doc-audit pitfalls`
- 测试基础设施变更后：`/doc-audit phase tdd`
- SDD/TDD 文档新增/更新后：`/doc-audit phase sdd`
