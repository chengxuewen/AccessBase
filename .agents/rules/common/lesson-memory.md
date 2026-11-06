# Lesson Memory & Self-Correction Rule

> AI 遇到失误、新问题、新经验时，**主动**将教训写入项目记忆和规则文件。

## 触发条件（满足任一即触发）

| 触发场景                 | 动作                                                    |
| ------------------------ | ------------------------------------------------------- |
| 编辑代码后编译/构建失败  | 记录到 `pitfalls.md` + 更新 `edit-safety.md`            |
| 同一类错误第 2 次出现    | **立即**添加规则到 `edit-safety.md` 或新建规则文件      |
| 发现社区已有解决方案     | 记录到 `pitfalls.md`（含社区链接）+ 更新 `decisions.md` |
| 测试通过但功能不工作     | 记录到 `pitfalls.md` + 更新 `testing.md` 添加 E2E 要求  |
| 依赖版本冲突             | 记录到 `pitfalls.md` + 更新 `edit-safety.md`            |
| 补丁/脚本破坏构建产物    | 记录到 `pitfalls.md` + 更新 `edit-safety.md`            |
| 用户指出 AI 未发现的问题 | 记录到 `pitfalls.md` + 分析根因 + 添加预防规则          |
| >1 次失败尝试才定位根因  | 记录到 `pitfalls.md`（含失败尝试 + 正确路径）           |
| 用户纠正做法/偏好        | 记录到 `conventions.md` 或 `decisions.md`               |

## 写入目标

| 文件                                  | 写入内容                         | 格式                                  |
| ------------------------------------- | -------------------------------- | ------------------------------------- |
| `.agents/memorys/pitfalls.md`         | 问题 + 原因 + 方案 + 验证 + 禁止 | 五段式 (PIT-{n})                      |
| `.agents/memorys/decisions.md`        | 架构/技术决策 + 理由 + 参考      | `## D{N}: 标题`                       |
| `.agents/memorys/conventions.md`      | 开发约束/用户偏好                | 「约束」+ 检查命令                    |
| `.agents/rules/common/edit-safety.md` | 可执行检查规则                   | `### N. 规则名` + 检查命令 + 阻塞条件 |
| `.agents/rules/common/testing.md`     | 测试覆盖要求                     | 测试类型 + 执行命令 + 通过标准        |

## 写入时机

1. **即时写入**：发现问题当下就写入，不等到会话结束
2. **修复后验证**：写入后验证规则是否可执行（有具体命令，不是空话）
3. **去重检查**：写入前 `grep` 目标文件，确认不重复

## 规则质量标准

| 标准       | 说明                                          |
| ---------- | --------------------------------------------- |
| **可执行** | 包含具体 shell 命令或检查步骤，不是"注意 XXX" |
| **可验证** | 有明确的通过/失败标准                         |
| **有阻塞** | 明确说明不通过时怎么办                        |
| **有先例** | 引用实际发生的错误                            |

## 反模式（禁止）

| 反模式           | 正确做法                                  |
| ---------------- | ----------------------------------------- |
| "以后注意"       | 写入具体检查命令到规则文件                |
| 只记录不预防     | 每条 pitfall 必须对应一条可执行规则       |
| 规则写"小心编辑" | 写 `grep -c '{' file && grep -c '}' file` |
| 等用户提醒才记录 | 发现即记录，不等用户指出                  |

## 捕获清单（每次触发自问）

1. **什么错了？**（现象）
2. **为什么错？**（根因）
3. **正确做法？**（方案）
4. **如何预防？**（检查命令 / 约束）
5. **存到哪里？**（按写入目标表）

## 平凡修复逃生舱

1 行修复 / 无分支 / 无副作用 → 1 行捕获，不用完整模板。

## pitfall 模板（写入 pitfalls.md 必须包含）

```markdown
## PIT-{n}: 标题 (日期)

- **症状**: [现象描述]
- **根因**: [根因分析]
- **解法**: [正确做法]
- **验证**: [检查命令]
```

## 预防升级（高成本/高频教训）

## Escalation ladder (2026-11-04, governance plan Batch 1 — MS lesson-memory graduation rule)

Recording a pitfall is the FIRST step, not the last. Every pitfall must map to
an executable check; "be careful next time" is not an artifact.

| Repetition / cost signal                                         | Required graduation                                                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Low frequency, low cost                                          | pitfalls.md entry only                                                                                                            |
| Same pitfall class ≥ 2 times, or > 3 failed attempts to localize | add a rule to the matching rules file (edit-safety / testing / patterns)                                                          |
| A rule that keeps being missed in review                         | promote to a machine check: lint / gate / pre-commit hook                                                                         |
| A machine check exists but was bypassed                          | escalation incident: record as PIT + tighten the gate — never weaken the assertion (CONSTRAINTS.md "Fix the cause, not the gate") |

## Numbering discipline (RCH:C10 / RCH:PIT-241 lesson)

- Before taking a new number (D / PIT / C), read the CURRENT maximum in the
  target file — never "max I remember + 1". Parallel sessions taking numbers
  blindly have collided before.
- The same number defined twice is a hard error; `pixi run check-refs`
  (rule-ref-lint) flags duplicates.
- Explanatory mentions in prose ("two numbers were skipped") must NOT use the
  bare citation shape (kind letter + number) — bare numbers are reserved for
  real citations that resolve (lint boundary, discovered live 2026-11-04).
- Cross-repo lesson citations always carry the `MS:` / `VE:` / `RCH:` prefix
  (ADJ-1b ruling A); bare cross-repo numbers read as dangling on purpose.

## Anti-patterns

| Anti-pattern                                      | Correct behavior                                          |
| ------------------------------------------------- | --------------------------------------------------------- |
| "Noted, will be careful" with no written artifact | Write the PIT / rule / check in the same turn             |
| Pitfall recorded with no prevention hook          | Map it to an executable check, or name why none exists    |
| Fixing a red gate by weakening the check          | Fix the cause; the gate is right until proven otherwise   |
| Numbering from memory instead of reading the file | Read the current maximum first (see Numbering discipline) |
