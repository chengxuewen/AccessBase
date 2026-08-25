# Skills Router — 主动技能推荐 + 决策树

> Agent 在合适时机**自动提示**可用技能。决策树结构让 Agent 按 if-then 逻辑匹配，不靠记忆。

## 触发格式

```
💡 建议使用 /{skill-name} — [一句话理由]
   (回复 'ok' 执行，或忽略继续)
```

## 决策树（Agent 每次响应前检查）

```
IF 用户开始新任务:
  ├─ 多步实现 → 💡 /test-driven-development + /think-before-act
  ├─ Bug 修复 → 💡 /systematic-debugging
  ├─ 架构变更 → 💡 /think-before-act + /openspec-propose
  ├─ UI/前端 → 💡 /design-system + /think-before-act
  ├─ 安全相关(auth/rbac/权限) → 💡 /security-review
  ├─ 外部库不熟 → 💡 librarian agent
  ├─ 代码库理解问题（关系/调用链/架构） → 💡 /graphify query + graphify path/explain
  └─ 意图模糊 → 💡 /brainstorming
  └─ 意图模糊 → 💡 /brainstorming

IF 正在编辑代码:
  ├─ 连续 2 次 edit 无 tsc → ⚠️ edit-safety 规则
  ├─ 3+ 文件交叉变更 → 💡 subagent-driven-development
  ├─ 发现 as any / 重复代码 → 💡 /remove-ai-slops
  └─ 同一错误第 2 次 → ⚠️ 需记录到 pitfalls.md

IF 测试相关:
  ├─ 连续 2+ 次测试失败 → 💡 /systematic-debugging
  ├─ 无测试直接写实现 → 💡 /test-driven-development
  ├─ UI 变更后 → 💡 /playwright + /visual-qa
  └─ 准备合并/PR → 💡 /requesting-code-review + /verification-before-completion

IF 体系维护:
  ├─ 修改 AGENTS.md/memorys/ → 💡 /doc-audit
  ├─ 新增技能/规则/MCP → 💡 /ecosystem-scan
  ├─ 大规模重构 (>10 文件) → 💡 /ecosystem-scan quick
  ├─ 重复犯同类错误 ≥2 次 → 💡 /ecosystem-scan quick
  └─ 新建 package/module → 💡 /test-harness

IF 会话状态:
  ├─ 完成 >5 个任务 → 💡 /lesson-review（会话结束总结）
  └─ 准备合并分支 → 💡 /finishing-a-development-branch
```

## 技能优先级（多技能竞争时）

当多个技能同时适用时，按此顺序推荐（最多 2 个）：

| 优先级 | 技能                       | 理由                    |
| :----: | -------------------------- | ----------------------- |
|   1    | `/think-before-act`        | 预防 > 修复，元约束优先 |
|   2    | `/test-driven-development` | 测试先行 > 事后补测试   |
|   3    | `/systematic-debugging`    | 有 bug 先诊断，不要瞎试 |
|   4    | `/security-review`         | 安全问题不能拖          |
|   5    | `/design-system`           | UI 一致性               |
|   6    | `/doc-audit`               | 文档同步                |
|   7    | `/requesting-code-review`  | 完成后审查              |
|   8    | `/ecosystem-scan`          | 体系健康                |

## 防骚扰规则

- 每次会话同一推荐最多 2 次
- 用户拒绝后该推荐 24h 内不再出现
- 用户正在调试/修复时不打断
- 最多列 2 个最相关推荐

## 合并推荐示例

```
💡 建议使用 /think-before-act（非平凡操作）+ /test-driven-development（先写测试）
```
