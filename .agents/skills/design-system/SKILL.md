---
name: design-system
description: '为 AccessBase 企业应用平台生成一致的 UI。引导 AI 代理创建符合 AccessBase 设计系统的前端界面。Use when creating or reviewing admin-UI pages and components.'
compatibility: >-
  Designed for Claude Code, GitHub Copilot, 和类似 AI 编码代理。
disable-model-invocation: false
metadata:
  author: AccessBase-team
  version: '2.0'
  category: design-system
  changelog: 'v2.0 — 重写为企业 SaaS 风格，删除工业控制残留，对齐 antd 5 token 体系'
---
# AccessBase 设计系统技能（v2 — UI alignment refactor W0.4 重造，2026-11-24）

> **v2 变更**：v1 引用的路径/文件/键名全部失实（令牌文件、主题存储键、locale 文件名、包目录结构均与仓库现实不符），本版按仓库现实重写，并与 UI 对齐重构计划（`docs/superpowers/plans/2026-11-24-ui-alignment-refactor.md` rev.5）同步。所有路径经门禁校验（见 §9）。

## 1. 使命

约束 `apps/admin-ui/src/` 的所有前端工作：设计令牌、风格包、组件规则、三态、无障碍、国际化与 UI 对齐重构（原型契约 `docs/ui/prototypes/`）的落地边界。

## 2. 技术栈（现实）

| 层 | 技术 | 现实锚点 |
|---|------|---------|
| UI 框架 | React 19 | `apps/admin-ui/package.json` |
| 组件库 | **Ant Design 5**（实装 5.29.3） | 唯一 UI 库 |
| 布局 | @ant-design/pro-components **ProLayout 7.22.7** | `src/layouts/AdminLayout.tsx`（目录是 `layouts/`） |
| 主题装配 | `src/components/LocaleGate.tsx` — 全局唯一 ConfigProvider | algorithm + locale；包令牌自 S1 起在此合并 |
| 状态 | Zustand 5（`src/stores/ui.ts`，持久化键 `ui-storage`） | theme + pack（S1） |
| 国际化 | react-i18next **单命名空间**，`src/i18n/locales/{zh,en}.json` | 键平价锁 + ≥702 地板 |
| E2E | Playwright（根 `playwright.config.ts`，37+ 规格，mock-first） | `e2e/fixtures/mocks.ts` 共享件 |

**约束**：禁止 Tailwind、禁止 styled-components；**手写 CSS 仅允许**：`src/index.css`（现存 `.sr-only`）与 `src/theme/pack-vars.css`（P-5 豁免文件，边界测试强制）。

## 3. 风格包体系（S1 落地）

- **两套落地**：`ant`（默认，存量零冲击）+ `broadsheet`（原型设计意图，opt-in）——`src/theme/packs/{ant,broadsheet}.ts`，各导出 `{themes:{light,dark}, cssVars}`。
- **五套挂账**：Material/Fluent/Carbon/Cupertino/Geist——纯增量，加之前零维护税。
- **顶栏切换器**：带可见标签的选择器（`data-testid="pack-select"`），非图标切换。
- **暗色**：darkAlgorithm 打底 + 包的暗色板**显式钉死次要态**（原型的暗色是手写的，不是反演）。
- **对比度**：所有 `*-text` 对 ≥4.5:1（单测程序化 + axe DOM 抽查）。

## 4. 控件规则（来自原型契约，逐条绑定）

| 规则 | 内容 |
|------|------|
| **布尔两域** | `Switch` = 即时生效（webhooks 行开关、用户状态）；`Checkbox` = 表单提交标记（groups isDepartment、users isActive）与多选/确认门。表单域禁 `role=switch` |
| **控件高度两档** | 32（表单/工具栏/按钮）/ 24（表格行内、密集工具条）——按容器族单档，静态锁（`control-tier.test.ts`）强制 |
| **危险两色** | 文本/浅底版（`--danger`）vs 实底按钮版（`--danger-solid`，跨主题不变） |
| **三态** | skeleton/empty/error——加载用骨架（S8 起引入），空/错沿用现有 Alert 族 |
| **复制反馈** | copyable 单元：toast + 绿勾 1.2s + execCommand 回退 + 双失败报错 |
| **焦点环** | 2px `--focus` 描边（`pack-vars.css` 豁免规则；不与 antd 焦点阴影叠双环） |
| **标签圆角族** | Tag/Select chip 用 `--r-tag`（按包不同；broadsheet=4px 系） |

## 5. 布局

- 骨架 ProLayout：`fixSiderbar`、折叠持久化 `admin-layout-collapsed`、断点 `breakpoint="md"`（≤768 自动收起）。
- **A-2 语义**：响应式收起是**临时态**——只有点击折叠按钮（`collapsedButtonRender` 意图标记）才写持久化。
- **已知分歧**（P-6=A 接受并记录）：触发器可见性语义、组标签 aria 化与契约的细节差异 ≤760px 存在；完整对齐=换骨架（L 级，挂账）。
- branding（站点名/logo/主色）**不进入**管理控制台主题（公网品牌色 ≠ 控制台主题；7 个认证页局部 brandTheme 仅 colorPrimary）。

## 6. i18n

- 单命名空间；键：第一级功能域 + 第二级 camelCase；**zh/en 必须同改**（parity 锁 + ≥702 地板）。
- 存储键 `lng`；AntD locale 经 LocaleGate 映射。

## 7. data-testid

全部可交互元素必须带；e2e 无收缩锁（名字集合 + 载荷账本）强制**只增不减**——删除需账本条目。高频约定：`{域}-{对象}-{动作}`（如 `groups-kind-checkbox`、`pack-select`）。

## 8. 编写检查清单

- [ ] antd 5 组件；令牌来自 pack 模块（S1 后），无硬编码色值
- [ ] 手写 CSS 仅限 `pack-vars.css` / `index.css`（边界测试）
- [ ] 所有文本 `t()`；zh/en 同步
- [ ] 表单 rules 校验；危险操作 Popconfirm；错误 message.error（经 `api/feedback` 桥）
- [ ] 三态齐备；布尔域用对控件；控件高度按容器族
- [ ] `pnpm --filter @accessbase/admin-ui exec tsc --noEmit` 过；控制台零应用 error

## 9. 路径门禁

本技能引用的每个路径必须真实存在——静态测试校验（W0.4 交付物之一，`__tests__/skill-paths.test.ts`，路径清单内联）。
