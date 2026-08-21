# 技术栈选型

> 本文档从 [`architecture.md`](../architecture.md) 拆分而来。
> 原始章节：§9 技术栈选型

---

## 9. 技术栈选型

### 9.1 后端技术栈

| 组件 | 选择 | 理由 |
|------|------|------|
| **Web 框架** | Fastify | 性能最优、TypeScript 原生、内置日志集成 |
| **ORM** | Drizzle ORM | 轻量、类型安全、SQL-like、统一迁移和数据访问 |
| **数据库** | PostgreSQL 16 | 企业级、JSONB 支持、扩展丰富 |
| **缓存** | Redis | 高性能、会话存储、分布式锁 |
| **包管理** | pnpm | 性能最优、Monorepo 支持好 |

### 9.2 前端技术栈

| 组件 | 选择 | 理由 |
|------|------|------|
| **框架** | React | 生态最丰富、TypeScript 成熟、企业级选择 |
| **UI 组件库** | Ant Design | 企业级设计、组件丰富、定制性好 |
| **构建工具** | Vite | 开发体验最佳、快速 HMR |
| **状态管理** | Zustand | 轻量、TypeScript 友好、无样板代码 |
| **路由** | React Router | 成熟、功能丰富、SSR 支持 |

---
