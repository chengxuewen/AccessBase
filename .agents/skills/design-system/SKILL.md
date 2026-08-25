---
name: design-system
description: '为 AccessBase 企业应用平台生成一致的 UI。引导 AI 代理创建符合 AccessBase 设计系统的前端界面。'
compatibility: >-
  Designed for Claude Code, GitHub Copilot, 和类似 AI 编码代理。
disable-model-invocation: false
metadata:
  author: AccessBase-team
  version: '2.0'
  category: design-system
  changelog: 'v2.0 — 重写为企业 SaaS 风格，删除工业控制残留，对齐 antd 5 token 体系'
---

# AccessBase 设计系统技能

## 1. 使命

引导 AI 代理在前端开发中遵循 AccessBase 企业 SaaS 设计系统，确保所有 UI 输出在色彩、组件、间距和国际化上与平台规范一致。

**适用范围**：`packages/admin-ui/src/` 和 `plugins/*/src/pages/` 中所有前端工作。

---

## 2. 技术栈

| 层       | 技术                                           | 用途                              |
| -------- | ---------------------------------------------- | --------------------------------- |
| UI 框架  | React 19                                       | 组件化                            |
| 组件库   | **Ant Design 5**                               | 唯一 UI 库，不使用其他组件库      |
| 布局     | @ant-design/pro-layout + @refinedev/antd       | 管理后台骨架 + 数据层             |
| 数据组件 | ProTable / ProForm / antd Table / antd Form    | 列表 / 表单                       |
| 状态管理 | TanStack Query + useContext                    | 服务端状态 + 客户端状态           |
| 国际化   | react-i18next                                  | 双命名空间（插件包名 + `client`） |
| 样式方案 | antd 5 CSS-in-JS（ConfigProvider.theme.token） | 不使用 Tailwind CSS               |

**约束**：禁止 Tailwind CSS 语法、禁止 `styled-components`、禁止自写 CSS 模块（除非 antd 无法覆盖的极端场景）。

---

## 3. 主题体系

### 3.1 权威来源

所有主题令牌以 `packages/admin-ui/src/theme/tokens.ts` 为唯一权威。禁止在组件中硬编码色值。

```typescript
// tokens.ts — 复制此引用路径，不要编造
import { themeTokens, componentTokens } from './theme/tokens.js';
```

### 3.2 种子令牌（algorithm 无关）

| 令牌           | 值                                                                                                                | 说明                |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------- |
| `colorPrimary` | `#1677ff`                                                                                                         | 品牌蓝，antd 默认蓝 |
| `borderRadius` | `6`                                                                                                               | 全局圆角            |
| `fontFamily`   | `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'SF Pro Text', 'PingFang SC', 'Noto Sans SC', Roboto, sans-serif` | 跨平台栈            |
| `fontSize`     | `14`                                                                                                              | 基础字号            |

### 3.3 组件令牌

| 组件  | 令牌                | 值   | 说明               |
| ----- | ------------------- | ---- | ------------------ |
| Menu  | `itemHeight`        | `42` | 侧边栏菜单行高     |
| Table | `cellPaddingBlock`  | `12` | 表格单元格上下内距 |
| Table | `cellPaddingInline` | `16` | 表格单元格左右内距 |

### 3.4 亮色/暗色切换

- **亮色默认**：`antdTheme.defaultAlgorithm`（应用启动默认）
- **暗色可选**：`antdTheme.darkAlgorithm`（用户通过 Header 切换按钮触发）
- 持久化 key：`aude-theme`（localStorage）
- **禁止**硬编码 `colorBgLayout`、`colorTextSecondary` 等色板衍生值——交给 algorithm 自动计算

```tsx
// ThemeContext.tsx 中的标准用法
const config = {
  algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
  token: themeTokens, // 来自 tokens.ts
  components: componentTokens,
};
return <ConfigProvider theme={config}>{children}</ConfigProvider>;
```

---

## 4. 布局规范

### 4.1 布局层级

```
ThemeProvider（ConfigProvider）
  └─ BrowserRouter
     └─ QueryClientProvider
        └─ RefineProvider
           └─ ACLProvider
              └─ AdminLayout（Sider + Header + Content）
```

AdminLayout 由 `packages/admin-ui/src/layout/AdminLayout.tsx` 提供，包含：

- **Sider**：左侧导航菜单（Menu component, mode="inline"）
- **Header**：右侧操作区（租户切换、主题切换、语言切换、登出）
- **Content**：主内容区（`padding: 24px`）

### 4.2 面板间距

- 主内容区内距：`24px`（AdminLayout Content 已设置）
- 卡片间距：`16px`（antd Space/gutter 默认）
- 表格与上方操作栏间距：`16px`

---

## 5. 组件使用规范

### 5.1 数据列表 — 使用 `<ProTable>` 或 `<Table>`

```tsx
import { ProTable } from '@ant-design/pro-components';

<ProTable
  columns={columns}
  request={async (params) => fetchData(params)}
  rowKey="id"
  search={{ labelWidth: 'auto' }}
  pagination={{ pageSize: 10 }}
/>;
```

- 分页默认 `pageSize: 10`
- 搜索表单使用 `search={{ labelWidth: 'auto' }}`
- 操作列使用 `render` + `<Space>` 排列按钮
- 行选择使用 `rowSelection`

### 5.2 表单 — 使用 `<ProForm>` 或 `<Form>`

```tsx
import { ProForm, ProFormText, ProFormSelect } from '@ant-design/pro-components';

<ProForm onFinish={async (values) => await submit(values)}>
  <ProFormText name="name" label={t('users.username')} rules={[{ required: true }]} />
  <ProFormSelect name="role" label={t('roles.name')} options={roleOptions} />
</ProForm>;
```

- 校验规则使用 antd `rules`，复杂场景用 Zod schema → antd `validator`
- 提交按钮使用 `submitter={{ searchConfig: { submitText: t('common.save') } }}`

### 5.3 菜单 — 使用 antd `<Menu>`

- `theme` 属性跟随 `useTheme().mode`：暗色模式用 `theme="light"`，亮色模式用 `theme="dark"`（反色以保持侧边栏视觉对比）
- `mode="inline"`
- 菜单项的 `label` 使用 `t()` 国际化
- ACL 过滤在渲染前完成（`canRoute(snippet)` → 过滤菜单项）

### 5.4 按钮与操作

- 主要操作：`type="primary"`（品牌蓝）
- 次要操作：`type="default"`
- 文本操作：`type="text"`（Header 中的图标按钮）
- 危险操作：`danger` + `Popconfirm` 二次确认（删除/禁用）
- 禁止渲染无 `onClick` 的 `<Button>`（死代码）

### 5.5 错误处理

- API 错误使用 `message.error(t('...'))` 提示用户
- 页面级错误使用 `<AppErrorBoundary>` 捕获（来自 `components/AppErrorBoundary.js`）
- 组件级错误使用 `react-error-boundary` 包裹

---

## 6. i18n 规范

### 6.1 双命名空间

| 命名空间                    | 用途               | 示例                                  |
| --------------------------- | ------------------ | ------------------------------------- |
| `'client'`（默认）          | 全局共享 UI 字符串 | `t('common.save')`, `t('menu.users')` |
| `'@audebase/plugin-{name}'` | 插件专属翻译       | `t('printJobs.title')`                |

### 6.2 组件内使用

```tsx
import { useTranslation } from 'react-i18next';

function MyComponent(): ReactNode {
  const { t } = useTranslation('client'); // 全局字符串
  return <Button>{t('common.save')}</Button>;
}
```

### 6.3 键命名约定

```json
// locales/zh-CN.json — 扁平二级结构
{
  "common": { "save": "保存", "cancel": "取消" },
  "menu": { "users": "用户管理", "roles": "角色管理" },
  "users": { "title": "用户管理", "username": "用户名" }
}
```

- 第一级：功能域（`common` / `menu` / `users` / `roles` / `plugins` / `audit` / `header`）
- 第二级：具体键（`camelCase`）
- 引用：`t('功能域.键名')` — 如 `t('users.username')`

### 6.4 翻译文件位置

- `packages/admin-ui/src/i18n/locales/zh-CN.json` — 中文
- `packages/admin-ui/src/i18n/locales/en-US.json` — 英文

**新增翻译时必须同时更新两个文件。**

### 6.5 支持的语言

```typescript
export const SUPPORTED_LANGS = ['zh-CN', 'en-US'] as const;
```

---

## 7. data-testid 约定

所有可交互元素必须有 `data-testid` 属性，用于 E2E 测试定位：

| 元素       | data-testid                 | 说明                           |
| ---------- | --------------------------- | ------------------------------ |
| 登录按钮   | `login-button`              | LoginPage                      |
| 租户切换器 | `tenant-switcher`           | AdminLayout Header             |
| 主题切换   | `theme-toggle`              | HeaderActions                  |
| 语言切换   | `lang-toggle`               | HeaderActions                  |
| 登出按钮   | `logout-button`             | AdminLayout Header             |
| 菜单项     | `{功能}-{动作}-{目标}-menu` | 如 `data-data-management-menu` |

---

## 8. 无障碍

- 所有按钮使用 `aria-label`
- 颜色对比度：正文 ≥ 4.5:1，大文字 ≥ 3:1（antd 默认 token 已满足）
- 键盘导航：antd 原生支持 Tab 键导航，无需额外处理
- 色彩非依赖：语义状态（成功/警告/错误）使用 antd `message` / `notification`（自带图标），不依赖纯色

---

## 9. 编写 UI 检查清单（可执行）

### 编码前

- [ ] 确认使用 antd 5 组件，不引入其他 UI 库
- [ ] 确认主题 token 来自 `tokens.ts`，不硬编码色值
- [ ] 确认所有文本使用 `t()` 国际化
- [ ] 确认目标组件需要 `data-testid`

### 编码中

- [ ] `<Button>` 都有 `onClick` 事件处理器
- [ ] 表单使用 `<ProForm>` 或 `<Form>` + `rules` 校验
- [ ] 列表使用 `<ProTable>` 或 `<Table>` + 分页
- [ ] 危险操作（删除/禁用）使用 `Popconfirm` 二次确认
- [ ] 错误状态使用 `message.error()` 提示，不静默吞异常
- [ ] 菜单 `label` 使用 `t()` 函数
- [ ] 新增翻译同步更新 zh-CN.json 和 en-US.json

### 编码后

- [ ] `pixi run npx tsc --noEmit -p packages/admin-ui/tsconfig.json` 编译通过
- [ ] 浏览器控制台 0 应用 error（过滤 `findDOMNode` / `chrome-extension` / `moz-extension` / `ResizeObserver`）
- [ ] 新路由 `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/{路由}` 返回 200

---

## 10. 禁止项

| 禁止                                | 原因                                     |
| ----------------------------------- | ---------------------------------------- |
| 使用 Tailwind CSS 语法              | 项目使用 antd 5 主题定制                 |
| 硬编码色值（如 `color: '#1677ff'`） | 从 tokens.ts 获取，算法自动适配暗色      |
| 硬编码 `colorBgLayout` 等色板衍生值 | 暗色模式下对比度 bug                     |
| 渲染无 `onClick` 的 `<Button>`      | 死代码                                   |
| 跳过 `t()` 的硬编码中文字符串       | 违反 i18n 规范                           |
| 使用 `as any` / `@ts-ignore`        | 违反 TypeScript 规范                     |
| 引入 skeleton / 装饰性动画          | antd 默认交互已足够，不增加复杂度        |
| 在组件中直接使用 `<Route>`          | 通过 `router.add()` API 注册（插件场景） |
