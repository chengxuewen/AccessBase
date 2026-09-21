# 批次 N 实施计划 — OIDC provider 状态持久化

**日期**: 2026-09-21 | **依据**: spec `2026-09-21-batch-n-oidc-persistence-design.md` + 双 Momus 附录（回后修订）
**执行**: 控制器直做为主（配额墙先例）；N-T1→N-T4 串行（同文件面强依赖），N-T5 收口

## 任务

### N-T1 — 表与迁移（spec D1）
- schema.ts 加 `oidcAdapterState`（kind/id 复合主键、payload jsonb、uid/user_code/grant_id/not_after 派生列、partial 索引×2 + grant_id + not_after）。
- `pnpm --filter @accessbase/migration …` 或 drizzle-kit generate 出 0005 链文件（链目录纪律：generate 后核对 SQL 无 DROP；0005_xxx.sql 与 snapshot 同步提交）。
- 出口：db:push 到 scratch 验证 + migrate.sh 链可应用（本地 PG）。

### N-T2 — adapter 重写（spec D2）
- PG 全 kind（除 Client）；memory Map 删除；派生列计算（userCode lower；uid 仅 Session）；upsert ON CONFLICT；find 不做 TTL 读过滤（B6 记录 lazy 清理偏差）；consume=UPDATE jsonb_set 标记（非删除，v9 内存适配器对等=重放检测保命）；findByUid/ByUserCode 带 kind；revokeByGrantId(kind,grantId)（B1：kind-blind 会杀在飞 Interaction）；5min sweep（unref + stopSweeper→app.onClose）。
- jsonb 往返陷阱双保：读侧 `typeof payload === 'string' ? JSON.parse : payload` 防御（PIT jsonb 家族）+ 测试钉对象形。
- 文件面：apps/server/src/oidc/adapter.ts + app.ts（sweep 生命周期）+ provider.ts（若 sweep 装配在 provider 构建处）。

### N-T3 — 测试（spec D4 矩阵 1-8 + 集成 9）
- 单元：fake db 记录 SQL 形（kind+id 双键忠实，consume 断 delete+returning 同语句）；restart-sim（新实例同 store）；sweep fake timers。
- 集成 skipIf PG-down：`oidc-persistence.integration.test.ts` scratch 库（测试内建临时 schema? 用 MAINT DB 名 accessbase_oidc_test，测后清）——真 upsert/find/refresh-proxy 链。若测试基建过重，降级为「单元 restart-sim + 手动 live-fire」并记录。

### N-T4 — 实弹（N-T5 内）
- 起真后端（scratch DB + RS256 键）：脚本化 interaction→consent→code→token→**重启进程**→refresh 200 + userinfo scope 在（新进程=真 restart 证明）；revoke 后 refresh 400。

### N-T5 — 收口
- 全门禁：vitest 全量（PG-down 绿 + PG-up 集成）· 双 tsc · eslint · e2e 137+3 基线不动 · coverage。
- 记忆：conventions 批5「瞬时内存 catch-all」条目**替换**为 Phase N 持久化契约；status 行；D120（jsonb/round-trip 裁决若触发）；PIT 按发现。

## 完成判据
spec §D5 四条 + execution-log 追加本文尾部。
