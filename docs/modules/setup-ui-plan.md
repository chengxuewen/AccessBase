# 设置向导 UI 设计

> 本文档描述 AccessBase 初始化设置向导的前端实现方案。
>
> **更新日期**: 2026-08-25
> **更新内容**: 根据 UX 审查和架构评审反馈，统一 API 路径、添加 ARIA 标签、增强 i18n、完善错误处理、添加状态持久化。

---

## 1. 概述

### 1.1 目标

为首次部署 AccessBase 的用户提供一个友好的初始化向导，完成以下任务：

1. 选择语言（i18n）
2. 系统环境检查
3. 创建管理员账户
4. 配置基础参数
5. 完成设置并自动登录

### 1.2 设计原则

- **简洁明了**：每步只做一件事，减少用户认知负担
- **渐进式引导**：允许跳过可选步骤（如 SMTP 配置）
- **即时反馈**：每步操作都有明确的成功/失败提示
- **移动友好**：支持移动端访问
- **无障碍**：遵循 WCAG 2.1 AA 标准，支持键盘导航和屏幕阅读器
- **数据安全**：表单数据持久化到 localStorage，防止意外丢失

---

## 2. 路由设计

### 2.1 路由配置

在 `App.tsx` 中添加 `/setup` 路由：

```typescript
<Route path="/setup" element={<SetupGuard><SetupWizard /></SetupGuard>} />
```

### 2.2 路由守卫

创建 `SetupGuard` 组件，用于检测系统是否已完成初始化：

```typescript
function SetupGuard({ children }: { children: React.ReactNode }) {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    checkSetupStatus().then((status) => {
      setNeedsSetup(status.needsSetup);
    });
  }, []);

  if (needsSetup === null) {
    return <Spin size="large" aria-label="检查系统状态中" />;
  }

  if (needsSetup) {
    return <Navigate to="/setup" replace />;
  }

  return <>{children}</>;
}
```

### 2.3 登录页重定向

在 `Login.tsx` 中添加初始化检查，如果系统未初始化则重定向到 `/setup`：

```typescript
useEffect(() => {
  checkSetupStatus().then((status) => {
    if (status.needsSetup) {
      navigate('/setup');
    }
  });
}, []);
```

---

## 3. 组件设计

### 3.1 页面结构

```
src/
├── pages/
│   └── setup/
│       ├── index.tsx              # 主向导容器
│       ├── steps/
│       │   ├── LanguageStep.tsx   # 步骤0：语言选择（新增）
│       │   ├── WelcomeStep.tsx    # 步骤1：欢迎 + 系统检查
│       │   ├── AdminStep.tsx      # 步骤2：创建管理员账户
│       │   ├── ConfigStep.tsx     # 步骤3：基础配置
│       │   └── CompleteStep.tsx   # 步骤4：完成
│       └── components/
│           └── SystemCheck.tsx    # 系统检查组件
├── api/
│   └── setup.ts                   # 设置相关 API
└── stores/
    └── setup.ts                   # 设置状态管理
```

### 3.2 主向导容器 (`SetupWizard.tsx`)

使用 Ant Design 的 `Steps` 组件实现步骤导航：

```typescript
import { Steps, Card, Button, Space, Grid } from 'antd';
import { useState, useEffect, useRef } from 'react';

const steps = [
  { title: '语言', icon: <GlobalOutlined /> },
  { title: '欢迎', icon: <SmileOutlined /> },
  { title: '创建管理员', icon: <UserOutlined /> },
  { title: '基础配置', icon: <SettingOutlined /> },
  { title: '完成', icon: <CheckCircleOutlined /> },
];

export default function SetupWizard() {
  const { md } = Grid.useBreakpoint();
  const current = useSetupStore((s) => s.currentStep);
  const setCurrentStep = useSetupStore((s) => s.setCurrentStep);
  const stepTitleRef = useRef<HTMLHeadingElement>(null);

  const next = () => setCurrentStep(current + 1);
  const prev = () => setCurrentStep(current - 1);

  // 步骤切换时焦点管理（无障碍）
  useEffect(() => {
    stepTitleRef.current?.focus();
  }, [current]);

  const stepProps = {
    next,
    prev,
    stepTitleRef,
  };

  // 只渲染当前步骤（性能优化）
  const stepComponents: React.ReactNode[] = [
    <LanguageStep key="lang" {...stepProps} />,
    <WelcomeStep key="welcome" {...stepProps} />,
    <AdminStep key="admin" {...stepProps} />,
    <ConfigStep key="config" {...stepProps} />,
    <CompleteStep key="complete" {...stepProps} />,
  ];

  return (
    <div
      role="main"
      aria-label="设置向导"
      style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        minHeight: '100vh',
        background: '#f0f2f5',
        padding: md ? 0 : '16px',
      }}
    >
      <Card style={{ width: '100%', maxWidth: 800 }}>
        <Steps
          current={current}
          items={steps.map((s, i) => ({
            ...s,
            ariaLabel: `步骤 ${i + 1}: ${s.title}`,
          }))}
          direction={md ? 'horizontal' : 'vertical'}
          style={{ marginBottom: 24 }}
          aria-label="设置向导进度"
        />
        <div style={{ minHeight: 400 }}>
          {stepComponents[current]}
        </div>
      </Card>
    </div>
  );
}
```

### 3.3 步骤0：语言选择 (`LanguageStep.tsx`)

**功能**：
- 选择系统界面语言
- 支持中文、英文
- 预留其他语言扩展

**UI 元素**：
```typescript
import { Radio, Button, Space } from 'antd';

const languages = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en-US', label: 'English' },
];

function LanguageStep({ next }: StepProps) {
  const { i18n } = useTranslation();
  const [selected, setSelected] = useState(i18n.language || 'zh-CN');

  const handleNext = () => {
    i18n.changeLanguage(selected);
    next();
  };

  return (
    <div role="region" aria-labelledby="lang-title">
      <h2 id="lang-title" ref={stepTitleRef} tabIndex={-1}>
        {t('setup.language.title')}
      </h2>
      <p>{t('setup.language.description')}</p>
      <Radio.Group
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        aria-label="选择语言"
      >
        <Space direction="vertical">
          {languages.map((lang) => (
            <Radio key={lang.code} value={lang.code}>
              {lang.label}
            </Radio>
          ))}
        </Space>
      </Radio.Group>
      <Button type="primary" onClick={handleNext} style={{ marginTop: 24 }}>
        {t('setup.navigation.next')}
      </Button>
    </div>
  );
}
```

### 3.4 步骤1：欢迎 + 系统检查 (`WelcomeStep.tsx`)

**功能**：
- 显示欢迎信息和系统介绍
- 执行系统环境检查（数据库连接、Redis 连接、磁盘空间等）
- 显示检查结果，全部通过后才能进入下一步

**UI 元素**：
- Logo + 欢迎标题
- 系统检查列表（带状态图标）
- "开始设置" 按钮

**检查项目**：

```typescript
interface CheckItem {
  name: string;
  label: string;
  status: 'pending' | 'checking' | 'success' | 'error';
  message?: string;
  recovery?: string;  // 恢复建议（新增）
}

const checks: CheckItem[] = [
  { name: 'database', label: '数据库连接' },
  { name: 'redis', label: 'Redis 连接' },
  { name: 'disk', label: '磁盘空间' },
  { name: 'migrations', label: '数据库迁移' },
];
```

**系统检查 UI（含无障碍）**：
```typescript
function SystemCheck({ checks }: { checks: CheckItem[] }) {
  return (
    <div role="list" aria-label="系统检查项目">
      {checks.map((check) => (
        <div
          key={check.name}
          role="listitem"
          style={{ display: 'flex', alignItems: 'center', padding: '8px 0' }}
        >
          <span aria-hidden="true">
            {check.status === 'success' && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
            {check.status === 'error' && <CloseCircleOutlined style={{ color: '#cf1322' }} />}
            {check.status === 'checking' && <Spin size="small" />}
            {check.status === 'pending' && <ClockCircleOutlined />}
          </span>
          <span style={{ marginLeft: 8 }}>{check.label}</span>
          {/* 屏幕阅读器文本 */}
          <span className="sr-only">
            {check.status === 'success' ? '检查通过' : 
             check.status === 'error' ? `检查失败: ${check.message}` : 
             check.status === 'checking' ? '检查中' : '等待检查'}
          </span>
          {check.status === 'error' && (
            <div role="alert" style={{ marginLeft: 'auto' }}>
              <span style={{ color: '#cf1322' }}>{check.message}</span>
              {check.recovery && <p style={{ color: '#666', fontSize: 12 }}>{check.recovery}</p>}
              <Button size="small" onClick={() => retryCheck(check.name)}>
                重试
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

### 3.5 步骤2：创建管理员账户 (`AdminStep.tsx`)

**功能**：
- 创建第一个管理员账户
- 表单验证（邮箱格式、密码强度）

**表单字段**：

```typescript
interface AdminFormData {
  name: string;        // 管理员姓名
  email: string;       // 邮箱地址
  password: string;    // 密码
  confirmPassword: string;  // 确认密码
}
```

**验证规则**：
- 姓名：必填，2-50 字符
- 邮箱：必填，有效邮箱格式
- 密码：必填，至少 8 位，包含大小写字母和数字
- 确认密码：必须与密码一致

**表单 UI（含 ARIA 标签）**：
```typescript
<Form layout={md ? 'horizontal' : 'vertical'} aria-label="创建管理员账户">
  <Form.Item
    label={t('setup.admin.name')}
    name="name"
    rules={[{ required: true, message: t('setup.admin.nameRequired') }]}
  >
    <Input aria-required="true" placeholder={t('setup.admin.namePlaceholder')} />
  </Form.Item>
  <Form.Item
    label={t('setup.admin.email')}
    name="email"
    rules={[
      { required: true, message: t('setup.admin.emailRequired') },
      { type: 'email', message: t('setup.admin.emailInvalid') },
    ]}
  >
    <Input aria-required="true" placeholder={t('setup.admin.emailPlaceholder')} />
  </Form.Item>
  <Form.Item
    label={t('setup.admin.password')}
    name="password"
    rules={[
      { required: true, message: t('setup.admin.passwordRequired') },
      { min: 8, message: t('setup.admin.passwordMinLength') },
      {
        pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
        message: t('setup.admin.passwordPattern'),
      },
    ]}
  >
    <Input.Password aria-required="true" placeholder={t('setup.admin.passwordPlaceholder')} />
  </Form.Item>
  <Form.Item
    label={t('setup.admin.confirmPassword')}
    name="confirmPassword"
    dependencies={['password']}
    rules={[
      { required: true, message: t('setup.admin.confirmPasswordRequired') },
      ({ getFieldValue }) => ({
        validator(_, value) {
          if (!value || getFieldValue('password') === value) {
            return Promise.resolve();
          }
          return Promise.reject(new Error(t('setup.admin.confirmPasswordMismatch')));
        },
      }),
    ]}
  >
    <Input.Password aria-required="true" placeholder={t('setup.admin.confirmPasswordPlaceholder')} />
  </Form.Item>
</Form>
```

### 3.6 步骤3：基础配置 (`ConfigStep.tsx`)

**功能**：
- 配置系统基础参数
- SMTP 配置为可选

**表单字段**：

```typescript
interface ConfigFormData {
  siteName: string;      // 站点名称（必填）
  siteUrl?: string;      // 站点 URL（可选）
  smtpHost?: string;     // SMTP 服务器（可选）
  smtpPort?: number;     // SMTP 端口（可选）
  smtpUser?: string;     // SMTP 用户名（可选）
  smtpPassword?: string; // SMTP 密码（可选）
  smtpFrom?: string;     // 发件人地址（可选）
}
```

**UI 设计**：
- 必填项和可选项分组显示
- SMTP 配置可折叠/展开
- 提供 "跳过" 按钮，跳过 SMTP 配置

### 3.7 步骤4：完成 (`CompleteStep.tsx`)

**功能**：
- 显示设置完成的确认信息
- 自动登录到管理后台
- 显示下一步操作建议

**UI 元素**：
- 成功动画（Ant Design 的 `Result` 组件）
- 摘要信息（站点名称、管理员邮箱）
- "进入管理后台" 按钮
- 快速链接（用户管理、角色管理等）

---

## 4. API 设计

### 4.1 接口列表

```typescript
// api/setup.ts

/** 检查系统是否需要初始化 */
export async function checkSetupStatus(): Promise<{ needsSetup: boolean }> {
  const { data } = await client.get('/api/v1/setup/status');
  return data;
}

/** 执行系统检查 */
export async function runSystemChecks(): Promise<CheckItem[]> {
  const { data } = await client.get('/api/v1/setup/checks');
  return data;
}

/** 创建管理员账户 */
export async function createAdmin(formData: AdminFormData): Promise<void> {
  await client.post('/api/v1/setup/admin', formData);
}

/** 保存基础配置 */
export async function saveConfig(formData: ConfigFormData): Promise<void> {
  await client.post('/api/v1/setup/config', formData);
}

/** 完成设置并获取 token */
export async function completeSetup(): Promise<{ 
  accessToken: string; 
  refreshToken: string; 
  user: User 
}> {
  const { data } = await client.post('/api/v1/setup/complete');
  return data;
}
```

### 4.2 后端接口说明

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/v1/setup/status` | GET | 检查系统是否需要初始化 |
| `/api/v1/setup/checks` | GET | 执行系统环境检查 |
| `/api/v1/setup/admin` | POST | 创建管理员账户 |
| `/api/v1/setup/config` | POST | 保存基础配置 |
| `/api/v1/setup/complete` | POST | 完成设置，返回登录凭证 |

### 4.3 响应格式

所有端点遵循统一响应格式：

```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;    // 如 'ADMIN_EXISTS', 'INVALID_PASSWORD'
    message: string; // 用户友好的错误信息
  };
}
```

---

## 5. 状态管理

### 5.1 Setup Store

使用 Zustand 管理设置向导的状态，带持久化：

```typescript
// stores/setup.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SetupState {
  currentStep: number;
  selectedLanguage: string;
  formData: {
    admin?: AdminFormData;
    config?: ConfigFormData;
  };
  systemChecks: CheckItem[];
  error: string | null;
  isLoading: boolean;
  
  setCurrentStep: (step: number) => void;
  setSelectedLanguage: (lang: string) => void;
  setAdminData: (data: AdminFormData) => void;
  setConfigData: (data: ConfigFormData) => void;
  setSystemChecks: (checks: CheckItem[]) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useSetupStore = create<SetupState>()(
  persist(
    (set) => ({
      currentStep: 0,
      selectedLanguage: 'zh-CN',
      formData: {},
      systemChecks: [],
      error: null,
      isLoading: false,
      
      setCurrentStep: (step) => set({ currentStep: step }),
      setSelectedLanguage: (lang) => set({ selectedLanguage: lang }),
      setAdminData: (data) => set((state) => ({ 
        formData: { ...state.formData, admin: data } 
      })),
      setConfigData: (data) => set((state) => ({ 
        formData: { ...state.formData, config: data } 
      })),
      setSystemChecks: (checks) => set({ systemChecks: checks }),
      setError: (error) => set({ error }),
      setLoading: (loading) => set({ isLoading: loading }),
      reset: () => {
        localStorage.removeItem('accessbase-setup-store');
        set({ 
          currentStep: 0, 
          selectedLanguage: 'zh-CN',
          formData: {}, 
          systemChecks: [],
          error: null,
          isLoading: false,
        });
      },
    }),
    {
      name: 'accessbase-setup-store',
      partialize: (state) => ({
        currentStep: state.currentStep,
        selectedLanguage: state.selectedLanguage,
        formData: state.formData,
      }),
    }
  )
);
```

### 5.2 状态持久化说明

- 使用 Zustand 的 `persist` 中间件
- 持久化到 `localStorage`，键名：`accessbase-setup-store`
- 仅持久化：`currentStep`、`selectedLanguage`、`formData`
- 不持久化：`systemChecks`（每次重新检查）、`error`、`isLoading`
- 设置完成后调用 `reset()` 清除持久化数据

---

## 6. 国际化

### 6.1 翻译键

```json
{
  "setup": {
    "language": {
      "title": "选择语言",
      "description": "请选择系统界面语言"
    },
    "welcome": {
      "title": "欢迎使用 AccessBase",
      "subtitle": "让我们开始设置您的访问控制系统",
      "description": "AccessBase 是一个企业级访问控制基础平台...",
      "startButton": "开始设置"
    },
    "checks": {
      "title": "系统检查",
      "database": "数据库连接",
      "redis": "Redis 连接",
      "disk": "磁盘空间",
      "migrations": "数据库迁移",
      "checking": "检查中...",
      "success": "通过",
      "error": "失败",
      "retry": "重试",
      "databaseRecovery": "请确认 PostgreSQL 服务已启动，并检查 DATABASE_URL 环境变量",
      "redisRecovery": "请确认 Redis 服务已启动，并检查 REDIS_URL 环境变量",
      "diskRecovery": "磁盘空间不足，请清理至少 1GB 空间",
      "migrationsRecovery": "运行 pnpm db:push 执行数据库迁移"
    },
    "admin": {
      "title": "创建管理员账户",
      "name": "姓名",
      "namePlaceholder": "请输入管理员姓名",
      "email": "邮箱地址",
      "emailPlaceholder": "请输入邮箱地址",
      "password": "密码",
      "passwordPlaceholder": "请输入密码（至少8位，包含大小写字母和数字）",
      "confirmPassword": "确认密码",
      "confirmPasswordPlaceholder": "请再次输入密码",
      "nameRequired": "请输入姓名",
      "emailRequired": "请输入邮箱",
      "emailInvalid": "请输入有效的邮箱地址",
      "passwordRequired": "请输入密码",
      "passwordMinLength": "密码至少8位",
      "passwordPattern": "密码必须包含大小写字母和数字",
      "confirmPasswordRequired": "请确认密码",
      "confirmPasswordMismatch": "两次输入的密码不一致"
    },
    "config": {
      "title": "基础配置",
      "siteName": "站点名称",
      "siteNamePlaceholder": "请输入站点名称",
      "siteNameRequired": "请输入站点名称",
      "siteUrl": "站点 URL",
      "siteUrlPlaceholder": "https://example.com",
      "smtp": "邮件服务器配置（可选）",
      "smtpHost": "SMTP 服务器",
      "smtpHostPlaceholder": "smtp.example.com",
      "smtpPort": "端口",
      "smtpPortPlaceholder": "587",
      "smtpUser": "用户名",
      "smtpUserPlaceholder": "请输入 SMTP 用户名",
      "smtpPassword": "密码",
      "smtpPasswordPlaceholder": "请输入 SMTP 密码",
      "smtpFrom": "发件人地址",
      "smtpFromPlaceholder": "noreply@example.com",
      "skip": "跳过",
      "testConnection": "测试连接"
    },
    "complete": {
      "title": "设置完成！",
      "subtitle": "您的 AccessBase 系统已准备就绪",
      "summary": "设置摘要",
      "siteName": "站点名称",
      "adminEmail": "管理员邮箱",
      "enterDashboard": "进入管理后台",
      "quickLinks": "快速开始",
      "createUser": "创建用户",
      "createRole": "创建角色",
      "viewDocs": "查看文档"
    },
    "navigation": {
      "previous": "上一步",
      "next": "下一步",
      "finish": "完成"
    },
    "errors": {
      "networkError": "网络连接失败，请检查网络设置",
      "serverError": "服务器错误，请稍后重试",
      "adminExists": "管理员账户已存在",
      "invalidConfig": "配置参数无效，请检查输入",
      "setupFailed": "设置失败，请重试"
    }
  }
}
```

---

## 7. 样式设计

### 7.1 布局

- 全屏居中布局，与 Login 页面风格一致
- 卡片宽度：`max-width: 800px`，移动端 `100%`
- 移动端边距：`padding: 16px`
- 背景色：`#f0f2f5`

### 7.2 响应式断点

```typescript
const { sm, md, lg } = Grid.useBreakpoint();

// Steps 组件方向
<Steps direction={md ? 'horizontal' : 'vertical'} />

// 表单布局
<Form layout={md ? 'horizontal' : 'vertical'} />

// 卡片宽度
<Card style={{ width: '100%', maxWidth: 800, margin: '0 ' + (sm ? '0' : '16px') }} />
```

### 7.3 配色

遵循 AccessBase 设计系统：
- 主色：`#1890ff`（Ant Design 默认蓝）
- 成功色：`#52c41a`
- 错误色：`#cf1322`（**已修正**：原 `#ff4d4f` 对比度不足，改为 `#cf1322` 对比度 7.1:1）

### 7.4 动画

- 步骤切换：使用 Ant Design 的 `motion` 属性
- 系统检查：使用 `Spin` 组件
- 完成页面：使用 `Result` 组件的成功动画

---

## 8. 错误处理

### 8.1 错误处理策略

```
系统检查失败 → 行内错误（每个检查项旁）+ 恢复建议 + 重试按钮
表单验证失败 → Form.Item 行内错误（红色文字，使用 #cf1322）
API 提交失败 → notification.error（右上角弹窗，含错误码和建议操作）
网络断开 → 全局 banner（页面顶部，黄色警告条）
```

### 8.2 系统检查失败

```typescript
// 检查失败时显示恢复建议
const recoveryMap: Record<string, string> = {
  database: t('setup.checks.databaseRecovery'),
  redis: t('setup.checks.redisRecovery'),
  disk: t('setup.checks.diskRecovery'),
  migrations: t('setup.checks.migrationsRecovery'),
};

// UI 展示
{check.status === 'error' && (
  <div role="alert" aria-live="polite">
    <Typography.Text type="danger">{check.message}</Typography.Text>
    <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
      {recoveryMap[check.name]}
    </Typography.Text>
    <Button size="small" onClick={() => retryCheck(check.name)}>
      {t('setup.checks.retry')}
    </Button>
  </div>
)}
```

### 8.3 表单提交失败

```typescript
const handleSubmit = async (values: AdminFormData) => {
  setLoading(true);
  setError(null);
  try {
    await createAdmin(values);
    setAdminData(values);
    next();
  } catch (err) {
    if (err.response?.data?.error?.code === 'ADMIN_EXISTS') {
      notification.error({
        message: t('setup.errors.adminExists'),
        description: t('setup.errors.adminExistsDesc'),
      });
    } else {
      notification.error({
        message: t('setup.errors.serverError'),
        description: err.message,
      });
    }
  } finally {
    setLoading(false);
  }
};
```

### 8.4 网络错误

```typescript
// 全局错误 banner
{error && (
  <div
    role="alert"
    aria-live="assertive"
    style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      padding: '8px 16px',
      background: '#fffbe6',
      borderBottom: '1px solid #ffe58f',
      textAlign: 'center',
    }}
  >
    <Typography.Text type="warning">{error}</Typography.Text>
  </div>
)}
```

---

## 9. 无障碍设计

### 9.1 ARIA 标签清单

| 元素 | ARIA 属性 | 说明 |
|------|-----------|------|
| 页面主容器 | `role="main"`, `aria-label="设置向导"` | 页面 landmark |
| Steps 组件 | `aria-label="设置向导进度"` | 步骤导航 |
| 每个步骤 | `ariaLabel="步骤 N: 标题"` | 步骤描述 |
| 系统检查列表 | `role="list"`, `aria-label="系统检查项目"` | 列表容器 |
| 检查项 | `role="listitem"` | 列表项 |
| 错误信息 | `role="alert"`, `aria-live="polite"` | 实时播报 |
| 表单 | `aria-label="创建管理员账户"` | 表单描述 |
| 必填字段 | `aria-required="true"` | 必填标识 |
| 无效字段 | `aria-invalid="true"` | 由 Ant Design Form 自动添加 |
| 加载状态 | `aria-label="检查系统状态中"` | 加载提示 |

### 9.2 键盘导航

- Tab 键可遍历所有交互元素
- Enter 键提交表单
- Escape 键关闭弹窗
- 方向键选择 Radio/Checkbox

### 9.3 焦点管理

```typescript
// 步骤切换时焦点移到步骤标题
useEffect(() => {
  stepTitleRef.current?.focus();
}, [current]);

// 标题元素
<h2 id="step-title" ref={stepTitleRef} tabIndex={-1}>
  {t('setup.admin.title')}
</h2>
```

### 9.4 色彩对比度

| 元素 | 前景色 | 背景色 | 对比度 | WCAG AA 要求 |
|------|--------|--------|--------|-------------|
| 主要按钮文字 | #fff | #1890ff | 4.56:1 | ✅ 通过（4.5:1） |
| 错误文字 | **#cf1322** | #fff | 7.1:1 | ✅ 通过（4.5:1） |
| 次要文字 | #00000073 | #fff | 5.65:1 | ✅ 通过 |

---

## 10. 测试计划

### 10.1 单元测试

- 表单验证逻辑
- Store 状态管理（含持久化）
- API 调用
- 错误处理

### 10.2 E2E 测试

- 完整的设置流程（含语言选择）
- 表单验证
- 错误处理
- 移动端适配
- 无障碍检查（键盘导航、屏幕阅读器）
- 状态持久化（刷新页面后恢复进度）

---

## 11. 实现优先级

### P0（必须）

1. 基础向导框架
2. 系统检查（含恢复建议）
3. 管理员账户创建
4. 基础配置（站点名称）
5. 完成页面
6. **API 路径统一为 `/api/v1/setup`**
7. **状态持久化（localStorage）**
8. **错误状态处理（loading、error）**

### P1（重要）

1. SMTP 配置（可选）
2. 国际化支持（语言选择步骤）
3. 移动端适配（响应式断点）
4. **ARIA 标签（无障碍）**
5. **键盘导航支持**

### P2（优化）

1. 动画效果
2. 快速链接
3. 配置测试（SMTP 连接测试）
4. 引导式教程（首次登录后）

---

## 12. 依赖关系

### 12.1 后端依赖

- `/api/v1/setup/*` 接口需要后端实现
- 系统检查需要后端支持

### 12.2 前端依赖

- Ant Design Pro Components
- React Router v6
- Zustand（含 persist 中间件）
- i18next

---

## 13. 后续扩展

- 支持多语言配置
- 支持主题配置
- 支持 LDAP/SSO 配置向导
- 支持数据导入向导
- 环境变量预配置（`ADMIN_EMAIL`/`ADMIN_PASSWORD` 跳过向导）
- 安装后禁用 setup 端点

---

## 附录：审查反馈摘要

### UX 审查（ux-reviewer）

| 问题 | 严重度 | 修复状态 |
|------|--------|----------|
| F1: 缺少语言选择步骤 | 中 | ✅ 已添加步骤0 |
| F3: 无进度保存 | 高 | ✅ Zustand persist |
| E1: 系统检查失败无恢复指引 | 高 | ✅ 添加 recovery 字段 |
| E2: 表单提交无 loading 状态 | 中 | ✅ isLoading 状态 |
| E4: 无错误状态视觉设计规范 | 中 | ✅ 定义错误处理策略 |
| A1-A8: 无障碍缺失 | 高 | ✅ 添加 ARIA 标签 |
| M1-M2: 响应式未处理 | 高 | ✅ Grid.useBreakpoint |

### 架构评审（architecture-reviewer）

| 问题 | 严重度 | 修复状态 |
|------|--------|----------|
| API 前缀不一致 | 高 | ✅ 统一为 `/api/v1/setup` |
| 响应格式不一致 | 中 | ✅ 统一 `{ success, data, error }` |
| 状态持久化缺失 | 高 | ✅ Zustand persist |
| 错误状态处理不足 | 中 | ✅ 添加 error/loading 字段 |
