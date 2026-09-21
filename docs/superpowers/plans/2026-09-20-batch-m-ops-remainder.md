# 批次 M 实施计划 — 运维剩余

**日期**: 2026-09-20 | **依据**: spec `2026-09-20-batch-m-ops-remainder-design.md`（de87a23）+ 双 Momus 附录（回后修订）
**执行**: 组一 {M-T1 ∥ M-T2 ∥ M-T4}（quota 墙存活则派发，死则控制器直做）→ M-T3（脚本面，控制器直做）→ M-T5 收口

## 任务

### T1 — health 池单例（spec D1）
- routes/health.ts：模块级 lazy readyDb + onClose closeDb；测试两支（两次 ready createDb=1；onClose end）。
- 文件面：apps/server/src/routes/health.ts + __tests__/health*.test.ts。

### T2 — /metrics（spec D2）
- prom-client dep（apps/server/package.json + lockfile 同提交）；config.metricsToken；app 级 onRequest/onResponse 直方图（route-pattern label）+ 默认指标；/metrics 路由（token timing-safe 403 METRICS_AUTH；unset=open）；限流豁免核对；.env.example + compose prod 透传注记。
- 测试：200 形状 / 403×2 / 200-with-token。文件面：app.ts + routes/metrics.ts(新) + config.ts + utils/limiter 处 + 测试 + package.json + pnpm-lock。

### T3 — backup/restore（spec D3）
- scripts/backup.sh + scripts/restore.sh + accessbase.sh 子命令 + _common.sh 解析复用；.gitignore data/backups；bash -n + shellcheck（若有）；真库 round-trip 于 T5。
- 裁决预置：RESTORE 确认用独立 ACCESSBASE_RESTORE_CONFIRM=yes（不复用 RESET 名）。

### T4 — compose dev schema（spec D4）
- docker-compose.dev.yml server command → `sh -c "pnpm db:push && pnpm --filter @accessbase/server dev"`。若 docker 可用实测 down -v/up；不可用则记录 NOT VERIFIED（G5-4 豁免注记）。

### T5 — 控制器收口
- 全门禁：vitest 全量 · 双 tsc · eslint 改动面 · e2e workers=1 无回归（基线 137+3）。
- 实弹：deploy 构建产物 curl /metrics（PIT-061 纪律）+ token 401；throwaway DB backup→drop→restore round-trip；health 两次探针 spy 已在单测。
- 记忆四件套（D119 + Phase M 约束 + status 行 + PIT 按需）。

## 并行矩阵
T1=health.ts(+测试)；T2=app.ts/metrics.ts/config/limiter/package；T3=scripts/+accessbase.sh；T4=docker-compose.dev.yml——零交集。T2 与 T1 同文件风险=无（metrics hooks 在 app.ts，health.ts 独立）。

## 完成判据
spec §5 六条 + execution-log 追加本文件尾。
