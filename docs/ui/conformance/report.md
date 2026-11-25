# UI Conformance Report — 首份基线（2026-11-25）

**采集**：`e2e/conformance.spec.ts`（1440×900，原型 file:// zh/默认 Broadsheet；实现侧 mock/zh/明色/**Ant 包**）。
**重要口径**：应用默认 Ant 包是裁决 A-1=B（零冲击）——色彩差属**既定分歧**；本报告只把**包无关的版面/结构/组件形态**差距计入账本。切到 Broadsheet 包后色彩面另行复核。
**AI 已复核**：users（全矩阵）。其余 11 页已采集（`prototype/` + `app/` 双图），AI 逐页复核排期下一轮——本报告不假装覆盖它们。

## 跨页全局面（每页都可见——消账最优先）

| # | 维度 | 原型 | 实现 | 级别 | 状态 |
|---|------|------|------|------|------|
| G1 | **侧边栏分组** | OVERVIEW/IDENTITY/ACCESS/OPERATIONS/SYSTEM 五组带组标签 | ✅ 五组分组标签（`menu={{type:'group'}}` + menuDataRender；组标题 11px/tertiary/大写/.08em） | CRITICAL | **CLOSED S3'** (2e067e6→本轮) |
| G2 | **品牌块** | 左上角 AB 徽标 + AccessBase + Identity & Access 副标 | ✅ `ConsoleBrand`：26px 方标(缩写/logo) + 名 + 副标，折叠只剩方标 | CRITICAL | **CLOSED S3'** |
| G3 | **顶栏构成** | 面包屑（Admin / Users）+ 右侧中文/Broadsheet 选择/主题/租户标签/头像 | ✅ `ConsoleHeader`：左面包屑 Admin / 页名；右：语言·风格·主题·租户标签·头像（ProLayout side 布局不渲染 header——自渲染进内容列顶部） | CRITICAL | **CLOSED S3'** |
| G4 | **页头** | 页标题 + 副标说明 + 右上 Import/Create 实心按钮 | ✅ `PageHead`（h1 fs20/600 + 副标 tx3/fs12 + 右动作区） | CRITICAL | **CLOSED S4** |
| G5 | **表格工具栏** | meta 行（刷新/计数/…）+ 搜索框/筛选独立行 | ✅ `TableToolbar`（过滤卡：内联搜索+状态；元行：mono 计数+图标动作）；ProTable 查询表单/内置工具栏关闭；关键字 300ms 防抖 | CRITICAL | **CLOSED S4** |
| G6 | **行操作** | 图标三件套（眼睛/铅笔/…）带 hover 提示 | ✅ `IconActions`：28px ghost 图标 + 悬浮提示 + 破坏性动作保留 Popconfirm | MAJOR | **CLOSED S3.5** |

## S3.5 cells (adjudication 2=B) — 双图证据

**证据**：`app/users.png`（mock 三行，重拍 2026-11-25）+ **MCP 真栈实录** `out/local-playwright/mcp/s35-users-live.png`（真登录→真库→users 页）。

| # | 维度 | 契约 | 实现 | 状态 |
|---|------|------|------|------|
| U1 | 实体格 | 26px 缩写块 + 主名 + mono 副标（`.u-cell`） | ✅ `EntityCell`（姓名列合一，email 列合并） | **CLOSED** |
| U2 | 状态 | 5px 圆点 + tinted 胶囊（`.tag.ok/.danger/.warn`） | ✅ `StatusPill`（ok/danger/warn/info/neutral 五档，色走 cssVars） | **CLOSED** |
| U3 | 角色 | 灰芯片（`tags()`） | ⚠️ `Chip` 组件就绪、有则渲染；**列表 payload 无 roles**（服务端缺口：`/users` 列表不 join 角色，仅详情返回） | 组件 CLOSED / **数据缺口记账** |
| G6 | 行操作 | `.row-actions` 28px 图标 | ✅ `IconActions` | **CLOSED** |

**e2e 迁移**（组件形态变化 → 定位器跟随，断言强度不降）：users-crud ×3 与 import-export ×1 由 `button:has-text()` 改 `button[aria-label=]`；ui-quality AC-1 改为 aria-label Tab 可达 ≥3。users 族 24/24 绿。
**S4 消账（证据 `app/users.png` 重拍 2026-11-25）**：U4 表头语法（太阳ken 底/11px tx3/大写+.06em，令牌+豁免文件）· U5 分页 info（"1-3 / 3" showTotal）· U6 筛选条（内联搜索+状态选择，租户筛选挂账）· U7 空态沿用 EmptyState。users 族 e2e 24/24（搜索测试迁移为内联输入；查询表单已移除）。

**S3' 证据**：`app/users.png`（重拍 2026-11-25）——分组标签 概览/身份/访问/运营/系统 + 品牌块 + 顶栏 "Admin / 用户管理" + 右侧动作区 + 底部收起钮；`prototype/users.png` 对照。**MCP 交互验证：MCP 不可用（chromium-1200 vs 1234），已按规则报告用户**——本轮用 conformance spec 双图 + layout.spec 语义矩阵替代。

## users 页矩阵（AI 双图复核）

| # | 维度 | 原型 | 实现 | 级别 |
|---|------|------|------|------|
| U1 | 实体单元格 | 头像缩写 + 姓名粗体 + 邮箱灰字（复合单元） | 姓名/邮箱两列分离 | **CRITICAL** |
| U2 | 状态呈现 | 圆点+彩底胶囊（Active 绿/Suspended 红/Pending 黄） | 纯文本 | **CRITICAL** |
| U3 | 角色呈现 | editor/viewer 等灰色小芯片 | 无角色列 | MAJOR |
| U4 | 行密度 | 紧凑（~53px 行，双行复合） | antd 默认（~55px 单行）+ 空态大插画 | MAJOR |
| U5 | 分页 | "1-8 of 12" + 页码方块 | antd 默认分页 | MINOR |
| U6 | 筛选 | All tenants / All status 下拉 chips + 搜索框 | 姓名/邮箱输入框 + 状态下拉（在工具栏） | MAJOR |
| U7 | 空态 | （原型满数据；契约三态：skeleton/empty/error） | antd 空态插画 | MAJOR |

## 结论与消账路线

- **CRITICAL 共 6 项全局 + 2 项 users**——全部是**结构/构成**差距，不是令牌差距。这正是 P-1=A 换皮路线的天花板被实证量化。
- 消账顺序（待用户重裁路线后落计划）：G1-G3（壳）→ G4-G5（页头/工具栏契约件）→ U1-U2（实体/状态契约件）→ 其余页面族。
- 每项消账后**同状态重拍双图**，本报告更新为消账账本（差距只减不增由无收缩锁思路守护）。

## 已采集待 AI 复核（9 页 + 布局壳特写）

dashboard / roles / groups / tenants / clients / apikeys / webhooks / audit / events / settings / profile —— 双图在 `prototype/`、`app/`，下一轮逐页出矩阵。


## S10 收尾（2026-11-25）

- **视觉基线全量翻新**：24 张（12 页 × 明暗）在 S1-S4.5 最终形态上重拍，幂等复跑 24/24（双向证明：翻新 + 稳定）。
- **真栈车道（S10 强制）2/2**：重构后的 users 列表/细胞/图标操作/工具栏在**真 API + 真库**上完成向导→登录→登出→完整 CRUD。
- **错误整页**（403/404/500）：antd `Result` 形态，属原型无契约面（P-7 挂账，等扩展）——本次仅核对，不改。
- **全量回归**：dev 库栈下 settings/mfa/conformance 家族 12/12（此前 196/204 的 8 败 = 真栈车道把栈留在 scratch 库导致设置页未 mock 调用吃到真实后端状态——**环境伪影，非回归**；恢复 dev 库后复绿）。
- **仍未消账（明示）**：U3 角色列数据缺口（列表接口不 join roles，服务端项）· 租户筛选（需租户 options API）· 响应式表格（9 页横滚 vs 契约优先级列+卡片模式，唯一 DIVERGENT 特性，**S10 检查点待裁**）。
