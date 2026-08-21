# @accessbase/i18n 软件设计文档 (SDD)

> 本文档基于 [`core-packages.md`](./core-packages.md) §10.5 和 [`frontend.md`](./frontend.md) §35 生成。

---

## 1. 包概述

`@accessbase/i18n` 是 AccessBase 的国际化包，基于 i18next + react-i18next 构建，提供双命名空间设计、语言检测和动态加载功能。

### 1.1 核心职责

- 提供统一的国际化解决方案
- 支持双命名空间（包名命名空间 + client 命名空间）
- 实现语言自动检测和切换
- 支持按需加载语言包
- 提供类型安全的翻译键

### 1.2 技术选型

| 技术 | 选择 | 理由 |
|------|------|------|
| i18n 框架 | i18next | 最流行、插件丰富、TypeScript 支持 |
| React 集成 | react-i18next | useTranslation Hook、性能优化 |
| 语言检测 | i18next-browser-languagedetector | 自动检测浏览器语言 |
| 语言包加载 | i18next-http-backend | 按需加载语言包 |

---

## 2. 核心接口

### 2.1 i18n 配置接口

```typescript
/**
 * i18n 配置接口
 */
export interface I18nConfig {
  /** 默认语言 */
  defaultLanguage: string
  /** 回退语言 */
  fallbackLanguage: string
  /** 命名空间列表 */
  namespaces: string[]
  /** 默认命名空间 */
  defaultNamespace: string
  /** 语言检测配置 */
  detection: LanguageDetectionConfig
  /** 语言包加载配置 */
  backend: BackendConfig
  /** 插值配置 */
  interpolation: InterpolationConfig
}

/**
 * 语言检测配置
 */
export interface LanguageDetectionConfig {
  /** 检测顺序 */
  order: ('querystring' | 'cookie' | 'localStorage' | 'navigator' | 'path' | 'header')[]
  /** 查询参数名 */
  querystringParam?: string
  /** Cookie 名 */
  cookieName?: string
  /** 缓存位置 */
  caches?: ('localStorage' | 'cookie')[]
}

/**
 * 语言包加载配置
 */
export interface BackendConfig {
  /** 语言包路径 */
  loadPath: string
  /** 请求选项 */
  requestOptions?: RequestInit
}

/**
 * 插值配置
 */
export interface InterpolationConfig {
  /** 是否转义 HTML */
  escapeValue: boolean
  /** 前缀 */
  prefix?: string
  /** 后缀 */
  suffix?: string
}
```

### 2.2 翻译服务接口

```typescript
/**
 * 翻译服务接口
 */
export interface TranslationService {
  /** 翻译函数 */
  t(key: string, options?: TranslationOptions): string
  /** 切换语言 */
  changeLanguage(lng: string): Promise<void>
  /** 获取当前语言 */
  getLanguage(): string
  /** 获取支持的语言列表 */
  getSupportedLanguages(): Language[]
  /** 加载命名空间 */
  loadNamespaces(ns: string | string[]): Promise<void>
  /** 检查翻译键是否存在 */
  hasKey(key: string, ns?: string): boolean
  /** 获取命名空间资源 */
  getResourceBundle(lng: string, ns: string): Record<string, unknown>
}

/**
 * 翻译选项
 */
export interface TranslationOptions {
  /** 默认值 */
  defaultValue?: string
  /** 插值变量 */
  [key: string]: unknown
}

/**
 * 语言信息
 */
export interface Language {
  /** 语言代码 */
  code: string
  /** 语言名称 */
  name: string
  /** 本地名称 */
  nativeName: string
  /** 是否为 RTL 语言 */
  rtl?: boolean
}
```

### 2.3 React Hook 接口

```typescript
/**
 * useTranslation Hook 返回值
 */
export interface UseTranslationReturn {
  /** 翻译函数 */
  t: (key: string, options?: TranslationOptions) => string
  /** i18n 实例 */
  i18n: I18n
  /** 是否已加载 */
  ready: boolean
}

/**
 * I18n 实例接口
 */
export interface I18n {
  /** 当前语言 */
  language: string
  /** 切换语言 */
  changeLanguage(lng: string): Promise<void>
  /** 是否已初始化 */
  isInitialized: boolean
  /** 事件监听 */
  on(event: string, callback: Function): void
  /** 移除事件监听 */
  off(event: string, callback: Function): void
}
```

---

## 3. 生命周期钩子

### 3.1 i18n 初始化生命周期

```typescript
/**
 * i18n 生命周期钩子
 */
export interface I18nLifecycle {
  /** i18n 初始化前 */
  onBeforeInit?: (config: I18nConfig) => Promise<I18nConfig>
  /** i18n 初始化后 */
  onAfterInit?: (i18n: I18n) => Promise<void>
  /** 语言切换前 */
  onBeforeLanguageChange?: (lng: string) => Promise<string | void>
  /** 语言切换后 */
  onAfterLanguageChange?: (lng: string) => Promise<void>
  /** 语言包加载前 */
  onBeforeLoadNamespaces?: (ns: string[]) => Promise<void>
  /** 语言包加载后 */
  onAfterLoadNamespaces?: (ns: string[]) => Promise<void>
  /** 翻译缺失时 */
  onMissingKey?: (lng: string, ns: string, key: string) => void
}
```

### 3.2 初始化流程

```
1. 配置合并
   ├── 默认配置
   ├── 用户配置
   └── 环境配置

2. 插件注册
   ├── LanguageDetector
   ├── Backend
   └── React i18next

3. 初始化
   ├── 设置回退语言
   ├── 加载默认命名空间
   ├── 检测用户语言
   └── 应用语言

4. 就绪
   ├── 触发 initialized 事件
   └── 渲染应用
```

---

## 4. 依赖关系

### 4.1 外部依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| i18next | ^23.7.0 | i18n 核心框架 |
| react-i18next | ^14.0.0 | React 集成 |
| i18next-browser-languagedetector | ^7.2.0 | 浏览器语言检测 |
| i18next-http-backend | ^2.4.0 | HTTP 语言包加载 |
| i18next-resources-to-backend | ^1.2.0 | 资源转后端 |

### 4.2 内部依赖

| 包 | 用途 |
|------|------|
| @accessbase/shared-types | 共享类型定义 |
| @accessbase/logging | 日志记录 |

### 4.3 依赖图

```
@accessbase/i18n
├── @accessbase/shared-types
├── @accessbase/logging
├── i18next
├── react-i18next
├── i18next-browser-languagedetector
├── i18next-http-backend
└── i18next-resources-to-backend
```

---

## 5. 错误码

### 5.1 i18n 错误码

| 错误码 | 说明 | HTTP 状态码 |
|--------|------|------------|
| I18N_001 | 语言包加载失败 | 500 |
| I18N_002 | 翻译键不存在 | 404 |
| I18N_003 | 语言切换失败 | 500 |
| I18N_004 | 命名空间加载失败 | 500 |
| I18N_005 | 配置验证失败 | 400 |
| I18N_006 | 不支持的语言 | 400 |
| I18N_007 | 语言检测失败 | 500 |
| I18N_008 | 资源解析失败 | 500 |
| I18N_009 | 初始化超时 | 408 |
| I18N_010 | 插件加载失败 | 500 |

### 5.2 错误响应格式

```typescript
interface I18nError {
  code: string
  message: string
  details?: {
    language?: string
    namespace?: string
    key?: string
    stack?: string
  }
}
```

---

## 6. 配置项

### 6.1 环境变量

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| I18N_DEFAULT_LANGUAGE | 否 | zh-CN | 默认语言 |
| I18N_FALLBACK_LANGUAGE | 否 | en-US | 回退语言 |
| I18N_NAMESPACES | 否 | common,identity,admin,audit | 命名空间列表 |
| I18N_DEFAULT_NAMESPACE | 否 | common | 默认命名空间 |
| I18N_DETECTION_ORDER | 否 | querystring,cookie,localStorage,navigator | 检测顺序 |
| I18N_BACKEND_LOAD_PATH | 否 | /locales/{{lng}}/{{ns}}.json | 语言包路径 |
| I18N_LOG_LEVEL | 否 | warn | 日志级别 |

### 6.2 配置文件

```typescript
// i18n.config.ts
export interface I18nConfigFile {
  /** 支持的语言 */
  supportedLanguages: Language[]
  /** 命名空间配置 */
  namespaces: {
    [key: string]: {
      /** 命名空间名称 */
      name: string
      /** 是否默认加载 */
      default: boolean
      /** 加载优先级 */
      priority: number
    }
  }
  /** 语言包配置 */
  resources: {
    /** 语言包路径 */
    path: string
    /** 是否按需加载 */
    lazy: boolean
    /** 缓存策略 */
    cache: 'memory' | 'localStorage' | 'none'
  }
  /** 翻译键配置 */
  keys: {
    /** 分隔符 */
    separator: string
    /** 前缀 */
    prefix?: string
    /** 后缀 */
    suffix?: string
  }
}
```

### 6.3 React 组件配置

```tsx
// App.tsx
import { I18nextProvider } from 'react-i18next'
import i18n from './i18n'

function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <YourApp />
    </I18nextProvider>
  )
}

// 语言切换组件
function LanguageSwitcher() {
  const { i18n } = useTranslation()
  
  const languages = [
    { code: 'zh-CN', label: '中文' },
    { code: 'en-US', label: 'English' }
  ]
  
  return (
    <Select
      value={i18n.language}
      onChange={(lng) => i18n.changeLanguage(lng)}
      options={languages.map(l => ({ value: l.code, label: l.label }))}
    />
  )
}
```

---

## 附录

### A. 语言包结构

```
locales/
├── zh-CN/
│   ├── common.json      # 通用翻译
│   ├── identity.json    # 认证相关
│   ├── admin.json       # 后台管理
│   └── audit.json       # 审计日志
├── en-US/
│   ├── common.json
│   ├── identity.json
│   ├── admin.json
│   └── audit.json
└── ja-JP/
    ├── common.json
    ├── identity.json
    ├── admin.json
    └── audit.json
```

### B. 翻译键使用示例

```typescript
// 使用包名命名空间
const { t } = useTranslation('identity')
t('login.email')  // "邮箱"
t('login.password')  // "密码"

// 使用 client 命名空间
const { t } = useTranslation('client')
t('welcome')  // "欢迎"

// 带插值的翻译
t('greeting', { name: '张三' })  // "你好，张三"

// 复数形式
t('items', { count: 5 })  // "5 个项目"

// 嵌套翻译键
t('user.profile.title')  // "个人资料"
```

### C. 语言检测配置示例

```typescript
// 语言检测配置
const detectionConfig = {
  // 检测顺序
  order: ['querystring', 'cookie', 'localStorage', 'navigator'],
  
  // 查询参数配置
  lookupQuerystring: 'lng',
  lookupCookie: 'i18n_lng',
  lookupLocalStorage: 'i18n_lng',
  
  // 缓存配置
  caches: ['localStorage', 'cookie'],
  
  // Cookie 配置
  cookieMinutes: 60 * 24 * 30, // 30 天
  cookieDomain: window.location.hostname,
  cookieSecure: true,
  
  // 排除路径
  excludeCacheFor: ['cimode'],
}
```

### D. 按需加载配置

```typescript
// 按需加载语言包
const backendConfig = {
  // 语言包路径
  loadPath: '/locales/{{lng}}/{{ns}}.json',
  
  // 请求选项
  requestOptions: {
    cache: 'default',
    credentials: 'same-origin',
  },
  
  // 自定义加载器
  request: (options, url, payload, callback) => {
    fetch(url)
      .then(response => response.json())
      .then(data => callback(null, { status: 200, data }))
      .catch(error => callback(error, null))
  },
}
```
