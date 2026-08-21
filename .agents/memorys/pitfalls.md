# AccessBase 已知坑点与反模式

**更新日期**: 2026-08-21

## PIT-001: pino logger 类型重载问题

- **症状**: `logger.error('message', error)` 报类型错误
- **根因**: pino 的 `error` 方法有两个重载：`(obj: object, msg?: string)` 和 `(msg: string, ...args)`，当第二个参数是 `unknown` 类型时无法匹配
- **解法**: 使用对象作为第一个参数: `logger.error({ err: error }, 'message')`
- **验证**: `pnpm typecheck` 通过

## PIT-002: Fastify 插件 declare module 冲突

- **症状**: 多个插件文件中的 `declare module 'fastify'` 产生类型冲突
- **根因**: TypeScript 模块增强在同一编译单元中多次声明同一接口会冲突
- **解法**: 将类型增强放在单独的 `fastify.d.ts` 文件中
- **验证**: `pnpm typecheck` 通过

## PIT-003: process.env 属性访问

- **症状**: `process.env.KEY` 报错 `Property comes from an index signature`
- **根因**: tsconfig 启用了 `noPropertyAccessFromIndexSignature`
- **解法**: 使用 `process.env['KEY']` 语法
- **验证**: `pnpm typecheck` 通过

## PIT-004: vitest 配置排除 .refinfo 目录

- **症状**: 运行测试时包含 `.refinfo/` 和 `.opencode/` 中的测试文件
- **根因**: vitest 默认 include 匹配所有 `**/*.test.ts`
- **解法**: 在 vitest.config.ts 中配置 `include: ['packages/**/*.{test,spec}.ts', 'apps/**/*.{test,spec}.ts']`
- **验证**: `pnpm test` 只运行项目测试

## PIT-005: Fastify dual version 类型冲突

- **症状**: `fp(plugin)` 报 `FastifyInstance` 类型不匹配
- **根因**: monorepo 中同时存在 Fastify 4.x 和 5.x，类型增强只应用于一个版本
- **解法**: 统一 Fastify 版本，或使用 `skipLibCheck: true`
- **验证**: `pnpm typecheck` 通过

## PIT-006: useRef 在 React 19 中需要初始值

- **症状**: `useRef<ActionType>()` 报 `Expected 1 arguments, but got 0`
- **根因**: React 19 的 `useRef` 要求显式初始值
- **解法**: `useRef<ActionType>(null)`
- **验证**: `pnpm --filter @accessbase/admin-ui typecheck` 通过
