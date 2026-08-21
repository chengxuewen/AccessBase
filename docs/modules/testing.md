# 测试策略

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§30 测试策略

---

## 30. 测试策略

### 30.1 测试分层

| 层次 | 框架 | 覆盖率目标 | 说明 |
|------|------|-----------|------|
| **单元测试** | Vitest | ≥ 80% | 函数、类、工具 |
| **集成测试** | Vitest + Supertest | ≥ 60% | API 端点、数据库操作 |
| **E2E 测试** | Playwright | 关键流程 | 用户流程、UI 交互 |
| **性能测试** | k6 / Artillery | 基线 | 并发、响应时间 |

### 30.2 测试配置

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.d.ts', '**/*.test.ts'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80
      }
    },
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 10000
  }
})
```

### 30.3 测试示例

```typescript
// 单元测试
describe('AuthService', () => {
  it('should hash password correctly', async () => {
    const password = 'test123'
    const hash = await authService.hashPassword(password)
    expect(hash).not.toBe(password)
    expect(await authService.verifyPassword(password, hash)).toBe(true)
  })
  
  it('should reject invalid password', async () => {
    const hash = await authService.hashPassword('correct')
    expect(await authService.verifyPassword('wrong', hash)).toBe(false)
  })
})

// 集成测试
describe('POST /api/v1/auth/login', () => {
  it('should return 401 for invalid credentials', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'wrong' })
    
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('AUTH_001')
  })
  
  it('should return 200 with tokens for valid credentials', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'correct' })
    
    expect(response.status).toBe(200)
    expect(response.body.data.accessToken).toBeDefined()
    expect(response.body.data.refreshToken).toBeDefined()
  })
})
```

### 30.4 E2E 测试

```typescript
// Playwright E2E 测试
import { test, expect } from '@playwright/test'

test('user login flow', async ({ page }) => {
  await page.goto('/login')
  
  // 填写登录表单
  await page.fill('[data-testid="email-input"]', 'admin@example.com')
  await page.fill('[data-testid="password-input"]', 'password123')
  await page.click('[data-testid="login-button"]')
  
  // 验证跳转到仪表盘
  await expect(page).toHaveURL('/dashboard')
  await expect(page.locator('[data-testid="welcome-text"]')).toContainText('欢迎')
})

test('user CRUD operations', async ({ page }) => {
  // 创建用户
  await page.goto('/users')
  await page.click('[data-testid="create-user-button"]')
  await page.fill('[data-testid="user-email"]', 'newuser@example.com')
  await page.fill('[data-testid="user-name"]', 'New User')
  await page.click('[data-testid="submit-button"]')
  
  // 验证用户已创建
  await expect(page.locator('text=newuser@example.com')).toBeVisible()
})
```

### 30.5 CI 集成

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install
      - run: pnpm test -- --coverage
      - run: pnpm test:e2e
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

---
