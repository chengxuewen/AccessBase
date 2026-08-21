# Testing Requirements

## Minimum Test Coverage: 80%

Test Types (ALL required):
1. **Unit Tests** - Individual functions, utilities, components
2. **Integration Tests** - API endpoints, database operations
3. **E2E Tests** - Critical user flows (framework chosen per language)

### E2E 测试覆盖要求（强制，2026-07-30 新增）

对于每个 CRUD 资源（用户/角色/插件/Collection），以下 E2E 流程为 MANDATORY：

| 流程 | Playwright 操作 | 验证点 |
|------|--------|--------|
| 列表加载 | 登录 → 导航到列表页 | 表格渲染、数据可见、无 console.error |
| **创建** | 点击创建按钮 → 填写表单 → 提交 | 新记录出现在列表、成功提示 |
| **查看/编辑** | 点击编辑 → 修改字段 → 保存 | 数据更新、页面无报错 |
| **删除** | 点击删除 → 确认 | 记录消失、成功提示 |
| **空状态** | 清空数据后访问列表 | 空状态 UI 正常渲染 |
| **错误状态** | 断网或 server down → 操作 | 错误提示正确显示 |
| **控制台检查** | 每个操作后 `page.on('console')` | 0 应用 error（过滤 findDOMNode/chrome-extension/moz-extension/ResizeObserver） |
| **侧边栏导航** | 点击侧边栏所有菜单项 | 每页渲染正确、URL 正确 |
| **DOM 完整性** | 检查 `.ant-layout-sider` ≤ 1 | 无重复布局结构 |

### 控制台错误过滤

以下 console.error 不算应用错误：
- `findDOMNode` — ProLayout 已知问题
- `chrome-extension://` / `moz-extension://` — 浏览器扩展
- `ResizeObserver loop completed` — 浏览器内部，无害

过滤后仍有 error = 测试失败。

### 执行命令

```bash
pixi run npx playwright test --project=chromium
```

### 通过标准

- 所有测试文件 0 失败
- 任意失败 = 不允许声称"完成"
- 不得以"环境约束"跳过 E2E（服务未启动请先启动）
- 无法启动服务时声明："NOT VERIFIED — services unavailable"

## Test-Driven Development

MANDATORY workflow:
1. Write test first (RED)
2. Run test - it should FAIL
3. Write minimal implementation (GREEN)
4. Run test - it should PASS
5. Refactor (IMPROVE)
6. Verify coverage (80%+)

## Troubleshooting Test Failures

1. Use **tdd-guide** agent
2. Check test isolation
3. Verify mocks are correct
4. Fix implementation, not tests (unless tests are wrong)

## Agent Support

- **tdd-guide** - Use PROACTIVELY for new features, enforces write-tests-first

## Test Structure (AAA Pattern)

Prefer Arrange-Act-Assert structure for tests:

```typescript
test('calculates similarity correctly', () => {
  // Arrange
  const vector1 = [1, 0, 0]
  const vector2 = [0, 1, 0]

  // Act
  const similarity = calculateCosineSimilarity(vector1, vector2)

  // Assert
  expect(similarity).toBe(0)
})
```

### Test Naming

Use descriptive names that explain the behavior under test:

```typescript
test('returns empty array when no markets match query', () => {})
test('throws error when API key is missing', () => {})
test('falls back to substring search when Redis is unavailable', () => {})
```
