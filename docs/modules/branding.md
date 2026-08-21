# 品牌定制机制

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§16 品牌定制机制

---

## 16. 品牌定制机制

### 16.1 BrandTokens 接口

```typescript
// 品牌令牌接口
interface BrandTokens {
  // 品牌色
  primaryColor: string        // 主色（如 #1890ff）
  secondaryColor: string      // 次色（如 #52c41a）
  successColor?: string       // 成功色
  warningColor?: string       // 警告色
  errorColor?: string         // 错误色
  infoColor?: string          // 信息色
  
  // Logo
  logo: string | React.ReactNode  // 主 Logo
  logoCollapsed: string | React.ReactNode  // 折叠 Logo
  logoDark?: string | React.ReactNode  // 暗色主题 Logo
  
  // 品牌语
  brandName: string           // 品牌名称
  brandTagline?: string       // 品牌标语
  
  // 字体
  fontFamily?: string         // 字体族
  
  // 间距、圆角、阴影等设计令牌
  // ...
}
```

### 16.2 品牌定制方式

| 方式 | 说明 | 适用场景 |
|------|------|---------|
| **配置文件** | config.yaml 声明品牌令牌 | 静态配置、部署时确定 |
| **组件注入** | React/Vue 组件注入品牌令牌 | 动态配置、运行时切换 |
| **环境变量** | 环境变量注入品牌令牌 | 12-Factor、容器化部署 |

### 16.3 主题继承机制

```
L0 基石层（AccessBase）
    ↓ 默认中性主题
L1 平台层（企业应用平台）
    ↓ 继承+覆盖平台品牌
L2 应用层（MediaServo/MES）
    ↓ 继承+覆盖应用品牌
最终主题
```

**继承规则**：
1. L0 提供默认中性主题（无品牌色）
2. L1 注入平台品牌令牌（品牌色、字体）
3. L2 注入应用品牌令牌（Logo、品牌语）
4. 每层可覆盖上层的令牌

### 16.4 品牌预设

```yaml
# config.yaml
brand:
  # 默认品牌（L0 中性设计）
  default:
    primary_color: '#1890ff'
    secondary_color: '#52c41a'
    logo: '/accessbase-logo.svg'
    brand_name: AccessBase
  
  # 品牌预设
  presets:
    mediaservo:
      primary_color: '#722ed1'
      secondary_color: '#13c2c2'
      logo: '/mediaservo-logo.svg'
      brand_name: MediaServo
    
    mes:
      primary_color: '#fa541c'
      secondary_color: '#faad14'
      logo: '/mes-logo.svg'
      brand_name: MES
```

### 16.5 组件注入示例

```typescript
// React 组件注入
import { AccessBaseProvider } from '@accessbase/react'

function App() {
  return (
    <AccessBaseProvider
      config={{ baseUrl: 'https://accessbase.example.com' }}
      brand={{
        primaryColor: '#722ed1',
        logo: '/mediaservo-logo.svg',
        brandName: 'MediaServo',
        brandTagline: '视频服务平台'
      }}
    >
      <App />
    </AccessBaseProvider>
  )
}
```

---
