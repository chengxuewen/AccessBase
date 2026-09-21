# 批次 M 实施计划 — 运维剩余（rev.2，双 Momus 吸收后）

**日期**: 2026-09-20 | **依据**: spec rev.2 + 附录 REVIEW-ADDENDUM（FLOWS APPROVE-WITH-FIXES×3MAJOR + BLOCKERS APPROVE-WITH-FIXES 含 1 BLOCKER，全吸收）
**执行**: 组一 {M-T1 ∥ M-T2 ∥ M-T3 ∥ M-T4}（文件面互斥；派发死则控制器直做，PIT-065 纪律先查树）→ M-T5 收口

## 任务

### T1 — health 池单例（spec D1）
- routes/health.ts：memoized promise 单例（并发首探只 createDb 一次）；onClose = closeDb+**双双复位 undefined**（测试多 buildApp 复封毒池）；null 守卫。
- 测试三支：连续探一次；Promise.all 并发一次；close→重建→200。
- 文件面：apps/server/src/routes/health.ts + health 测试文件（先 find 确认既有测试所在）。

### T2 — /metrics（spec D2，契约面全在同一任务）
- prom-client 入 apps/server（lockfile 同提交）；config.metricsToken；**request**.routeOptions.url ?? 'unmatched'；默认指标 accessbase_ 前缀；hooks 注册于 OIDC hijack **之后**（/oidc 不计=文档化盲区，防表只增不减）；403 METRICS_AUTH（sha256→timingSafeEqual）；路由 cors:false；**setup-guard ALLOWED_PATHS += '/metrics'**；**app.ts 限流注册处新建 skip fn**（/health+/metrics——rev.1 伪前提修正）；warnDegradedChecks prod&无token 告警行；.env.example。
- 测试：200 形状 / 403×2 / 200-token / 无 ACAO / PG-down 绿（信号归零门）/ warn 纯函数支。
- 文件面：app.ts + routes/metrics.ts(新) + config.ts + middleware/setup-guard.ts + warnDegradedChecks 处 + .env.example + package.json/pnpm-lock + 测试。

### T3 — backup/restore（spec D3）
- **umask 077 首行** + 600 产物 + 头注 dump=机密（sessions.token 明文实锤）。
- restore：**先回显 target user@host:port/db** → 服务停机探测（deploy PIDFILE / native 5101 端口探测）或 --force → tty **键入库名**确认（非 localhost 或外部 DATABASE_URL 必打）→ ACCESSBASE_RESTORE_CONFIRM=yes 独立旁路。
- URL 拆分 + **%XX 解码** → PGPASSWORD env + -h/-p/-U/-d flags（conninfo 上 argv=ps 泄密）；retention `find -maxdepth 1 -type f -name 'accessbase-*.dump'`；OUT 校验 mkdir -p。
- accessbase.sh 子命令 backup/restore；.gitignore **不动**（data/ 已覆盖，rev.1 no-op 步骤删）。
- bash -n 全过 + shellcheck（若有）。

### T4 — entrypoint-dev 响亮 push（spec D4，flows R3 改写后）
- docker/entrypoint-dev.sh:50：`2>/dev/null || echo skipped` → 重试 3 次、失败**显错退出**。compose 文件**不动**（command: 被 ENTRYPOINT 吞为 $@——机制修正）。
- docker 可用则 G5-4 实弹仲裁；不可用记录 NOT VERIFIED 注记。
- 文件面：docker/entrypoint-dev.sh（仅此）。

### T5 — 控制器收口
- 全门禁：vitest 全量 · 双 tsc · eslint 改动面 · e2e workers=1（基线 137+3）· coverage。
- 实弹：deploy 构建产物 curl /metrics 200 + token 403（**统一 403，rev.1「401」废**）；throwaway DB backup→drop→restore round-trip（含错误库名 abort 零写）；entrypoint/compose live 或 NOT VERIFIED。
- 记忆四件套（D119 + Phase M 约束 + status + PIT 按需：entrypoint 吞败类、URL 百分号解码陷阱）。

## 并行矩阵
T1=health.ts+测试 · T2=app.ts/metrics.ts/config/setup-guard/warn/env/package · T3=scripts/+accessbase.sh · T4=entrypoint-dev.sh——零交集（T2 与 T1 文件不同；T3 与 T2 的 .env.example 无涉）。

## 完成判据
spec §5 六条全过 + execution-log 追加本文尾部 + scoped re-review 免除（附录即一轮修，flows 裁定无复审必要）。

## 执行记录（2026-09-21）

- 通道：配额墙整批控制器直做（H-T4c 先例）。6 commits：9ce47ae(T4 entrypoint) bf3a39d(T1) 9a1a341(T1-T2 主体) 97a2348(T3) 43e5768(T2 fp 修正) c5e22e0(T5 e2e 断言层)。
- 审查网实绩：dist 实弹抓 histogram 封装作用域空表（PIT-070，fp 修正+标签断言锁）；e2e 首跑 5 败全定性=T4 spec 断言层三坑（modal-root/footer 全局选择撞 forceRender/strict cell 撞复制按钮），scoped 修复 7/7；401/403 漂移全文统一 403。
- 门禁终数（实跑）：vitest 全量 924/0（PG-down 全绿）· 双 tsc 0 · eslint 改动面 0 err · **e2e 137+3skip 0 fail（6.6m workers=1）** · coverage PASS 51.45/77.9/77.49 地板升 · 真后端：backup→drop→restore round-trip（16 表+checksum+错误名零写 abort+非 tty 拒）、/metrics 双形态冒烟（dev inject + prod dist：route 标签/403/404/89 指标行）。
- NOT VERIFIED：docker compose down -v→up 全链路（环境无 docker daemon——entrypoint-dev 改动为单点机制替换，bash -n+读码核对；有 docker 的机器跑 G5-4 即闭环）。
- 记忆：status 行 + conventions Phase M（五件套契约/备份机密/restore 三重闸/池单例形制/entrypoint 响亮化/e2e 断言层级）+ PIT-068~070 + D119。
