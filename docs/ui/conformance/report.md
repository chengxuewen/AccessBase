# UI Conformance Report — 首份基线（2026-11-25）

**采集**：`e2e/conformance.spec.ts`（1440×900，原型 file:// zh/默认 Broadsheet；实现侧 mock/zh/明色/**Ant 包**）。
**重要口径**：应用默认 Ant 包是裁决 A-1=B（零冲击）——色彩差属**既定分歧**；本报告只把**包无关的版面/结构/组件形态**差距计入账本。切到 Broadsheet 包后色彩面另行复核。
**AI 已复核**：users（全矩阵）。其余 11 页已采集（`prototype/` + `app/` 双图），AI 逐页复核排期下一轮——本报告不假装覆盖它们。

## 跨页全局面（每页都可见——消账最优先）

| # | 维度 | 原型 | 实现 | 级别 | 修复指引 |
|---|------|------|------|------|---------|
| G1 | **侧边栏分组** | OVERVIEW/IDENTITY/ACCESS/OPERATIONS/SYSTEM 五组带组标签 | 平铺 13 项无分组 | **CRITICAL** | S3' 壳重构：menu 分组渲染（ProLayout menuData type=group） |
| G2 | **品牌块** | 左上角 AB 徽标 + AccessBase + Identity & Access 副标 | 纯文字 AccessBase | **CRITICAL** | 壳：logo + 副标组合 |
| G3 | **顶栏构成** | 面包屑（Admin / Users）+ 右侧中文/Broadsheet 选择/主题/租户标签/头像 | 面包屑缺失；**包切换/主题/语言落在左下页脚**；租户标签在头像内 | **CRITICAL** | 壳：actionsRender 上移回顶栏右侧 + breadcrumbRender |
| G4 | **页头** | 页标题 + 副标说明 + 右上 Import/Create 实心按钮 | 无页头块；按钮在 ProTable 工具栏 | **CRITICAL** | S4-S9 各页页头组件（新 PageHead 契约件） |
| G5 | **表格工具栏** | meta 行（刷新/计数/视图切换/密度）+ 搜索框/筛选 chips 独立行 | ProTable 查询表单（重置/查询）+ 卡片工具栏图标组 | **CRITICAL** | S4-S9 表格重构（search form → 行内搜索+chips） |
| G6 | **行操作** | 图标三件套（眼睛/铅笔/…）带 hover 提示 | 文字按钮（编辑/删除） | MAJOR | 页面族：icon actions + overflow 菜单 |

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
