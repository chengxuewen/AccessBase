# CI/CD 与部署

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§26 CI/CD 与部署

---

## 26. CI/CD 与部署

### 26.1 GitHub Actions 流水线

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm lint
      - run: pnpm type-check

  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: accessbase_test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm test
      - run: pnpm test:e2e

  build:
    needs: [lint, test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm build
      - uses: actions/upload-artifact@v4
        with:
          name: build
          path: dist/

  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: build
      - name: Deploy to production
        run: |
          # 部署脚本
```

### 26.2 Dockerfile 设计

```dockerfile
# 多阶段构建
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# 依赖安装阶段
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY packages/*/package.json ./packages/
RUN pnpm install --frozen-lockfile --prod

# 构建阶段
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# 生产阶段
FROM node:20-alpine AS production
RUN addgroup -g 1001 -S nodejs && adduser -S accessbase -u 1001
WORKDIR /app

# 安全：只复制必要文件
COPY --from=deps --chown=accessbase:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=accessbase:nodejs /app/dist ./dist
COPY --from=build --chown=accessbase:nodejs /app/package.json ./

# 安全：非 root 用户
USER accessbase

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health/live || exit 1

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### 26.3 部署策略

| 策略           | 说明               | 适用场景         |
| -------------- | ------------------ | ---------------- |
| **蓝绿部署**   | 两套环境，切换流量 | 生产环境、零停机 |
| **金丝雀部署** | 小比例流量测试     | 新版本验证       |
| **滚动更新**   | 逐个实例更新       | K8s 默认策略     |
| **回滚策略**   | 快速回退到上一版本 | 故障恢复         |

```yaml
# K8s 滚动更新策略
apiVersion: apps/v1
kind: Deployment
metadata:
  name: accessbase
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    spec:
      containers:
        - name: app
          image: accessbase/app:latest
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
```

---
