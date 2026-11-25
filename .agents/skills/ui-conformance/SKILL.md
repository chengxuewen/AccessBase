---
name: ui-conformance
description: '原型 vs 实现的设计符合度闭环：双截图采集（原型+实现）、像素级差距矩阵、CRITICAL 门槛。任何 UI 交付声明必须附视觉证据，无图=未完成。MCP 优先，报错即停并提示用户。Use for any UI slice delivery, prototype-alignment verification, or when claiming UI work is done.'
compatibility: >-
  Designed for Claude Code, GitHub Copilot, 和类似 AI 编码代理。
disable-model-invocation: false
metadata:
  author: AccessBase-team
---

# ui-conformance — 原型 vs 实现 的设计符合度闭环

> 诞生于 2026-11-25 的教训：S1-S3 期间 MCP Playwright 仅用过一次（遇错即弃），
> 视觉基线只对比“应用 vs 自身”，从未对比原型；“UI 完成”的声明从未携带视觉证据。
> 本技能是纠正：**没有双图证据，UI 就没有“完成”可言。**

## 使命

任何 UI 交付声明必须附**三件证据**：原型截图 + 实现截图 + 差距清单。
差距清单是逐项可消的账本；消账顺序按视觉权重（全局面 > 页面族 > 控件细节）。

## 硬约束（C1/C2/C3，用户批准 2026-11-25）

- **C1 完成重定义**：UI 任务“完成” = conformance 报告附在交付物里。无图 = 未完成。
  不得用“测试全绿/门禁全绿/已落地”替代视觉证据。
- **C2 本技能即验证环**：每片 UI 工作跑 `conformance` 采集（原型侧 + 实现侧双截图），
  差距清单分级 CRITICAL（版面性）/ MAJOR（组件形态）/ MINOR（间距/色彩细节）。
- **C3 门槛强制**：CRITICAL 必须修完才可声明“完成”；MINOR 记账。
  阈值与分级写死在采集脚本输出里，不靠自觉。

## MCP 纪律（用户规则，2026-11-25）

**交互验证优先使用本项目的 Playwright MCP Server。**
**MCP 报错/不可用 → 立即停止并向用户报告【提示用户检查修复】，禁止静默降级**
（curl/查库/只跑 spec 绕过——这正是 S1-S3 的失守路径）。
注意：MCP 与仓库 @playwright/test 是两套浏览器版本；spec 化的截图采集
（conformance capture）属于可重复测试资产，用仓库 runner 不算“绕过”。

## 采集流程（conformance capture）

1. **原型侧**：`admin-console.html` 是 file:// 单页（顶栏切页）——
   逐页导航（users/roles/tenants/clients/apikeys/webhooks/audit/events/settings/profile/dashboard）
   后截全页图，存 `docs/ui/conformance/prototype/`。
2. **实现侧**：同一视口（1440×900，zh，明色，默认 Ant 包）+ mock 数据，
   对应路由截全页图，存 `docs/ui/conformance/app/`。
3. **差距报告**：`docs/ui/conformance/report.md`——由 AI（多模态读图）逐页
   对照书写差距矩阵，分级入账。**报告 = 交付物**。
4. 原型是活文档：每次 conformance run 重新截原型侧（天然跟随原型演进，
   与 A-3 令牌 diff 门互补：那个锁令牌值，这个锁版面）。

## 报告格式（每页）

```
## users
| 维度 | 原型 | 实现 | 级别 | 修复指引 |
| 布局 | 左右分栏：列表+详情双栏 | 单表+抽屉 | CRITICAL | S4 页面族重构 |
```

## 检查清单（执行 UI 切片时逐条过）

- [ ] conformance 采集已跑，本片涉及页的双图已生成
- [ ] 差距矩阵已更新，CRITICAL 清零或显式挂账+用户知情
- [ ] MCP 交互验证：逐页点过（登录流/切包/折叠）——MCP 报错时已报告用户
- [ ] 交付汇报含双图证据链接，禁用“全绿即完成”话术
