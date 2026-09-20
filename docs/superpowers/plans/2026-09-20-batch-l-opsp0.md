# 批次 L（运维 P0）实施计划

**依据 spec**: `docs/superpowers/specs/2026-09-20-batch-l-opsp0-design.md`
**日期**: 2026-09-20
**执行模式**: subagent-driven（全 TDD；每任务独立审查；bg 通道死则按 PIT-060/H-T4c 先例控制器直接实现）

## 前置纪律（每任务通用）

- 测试前 `export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1`
- vitest 基线对照：`352 passed | 7 skipped`（PG 双态，H′ 入册）+ 全仓 826/0/7
- 提交/注释英文，本计划中文；`git add` 显式路径；commit 后 `git branch --show-current` 验 master
- 迁移链目录 `packages/migration/drizzle/`；存量库继续 db:push（conventions 既有约束不动）
- 禁止 sed 改代码；shell 脚本改动 = 整文件级审阅

---

## L-T0 侦察（无代码变更，产出事实清单）

1. `out/packages/migration/drizzle/*.sql` 是否随 `build:deploy` 落地（读 scripts/deploy/build.sh 复制循环节；缺则 T1 需补 build.sh 复制行——列入 T1 diff）。
2. 本地跑 `pnpm test:coverage`（全仓），抄录四类实测数（statements/branches/functions/lines）与阈值 80 的差距 → 决定 D3 re-baseline 值。
3. e2e 套件真后端依赖盘点：逐一列出哪些 spec 在 mock-API 模式需 webServer（vite）与/或真 5101；确认 CI job 里 playwright `webServer` 配置能否满足（若 health.spec 自 skip、setup-real 类不存在即无碍）。
4. 检查 drizzle 0000-0004 SQL 是否含不能跑在事务里的语句（`CREATE INDEX CONCURRENTLY` 等）→ 决定 `-1` 保留。
5. 检查容器镜像内 psql 可用性（Dockerfile PGUSER trust 本地连接）与 deploy 侧 psql（pixi native bin）连接参数差异（DATABASE_URL → psql 分解）。

**验收**: 事实在本文件尾部「T0 实测记录」落笔（5 条齐全）后才允许动 T1-T5。

## L-T1 迁移接线（P0 核心，spec D1）

**新建 `scripts/migrate.sh`**（纯 bash+psql，无新依赖）:
- 入参：`MIGRATE_CHAIN_DIR`（默认 `$SCRIPT_DIR/../packages/migration/drizzle`）；连接串用现成 `DATABASE_URL`（PG* 环境变量兜底给容器）
- 逻辑四步：tracking 表 IF NOT EXISTS → 空表且 `users` 存在 ⇒ baseline stamp（全部文件名入库+注明 stamped）→ 按字典序逐文件 `psql -v ON_ERROR_STOP=1 -1 -f` + 成功即插行 → 链目录缺失/无文件 ⇒ 响亮 exit 1（spec R-1）
- 幂等重跑零操作；失败 exit 1 带文件名
**改调用点**:
- `docker/entrypoint.sh:32` → `bash /app/scripts/migrate.sh`（删 `|| true`；确认 Dockerfile 把 scripts/ COPY 进 runtime 层，缺则补 COPY 行——与 build.sh 同性质）
- `scripts/deploy/start.sh:113` → `bash "${PROJECT_ROOT}/scripts/migrate.sh" || { log_error "Migrations failed — aborting"; exit 1; }`
**测试（RED 先行）**: `scripts/__tests__/migrate.test.ts`（或 apps/server/src/__tests__/ops-migrate.test.ts，就近 vitest include 范围）：
- fresh：临时库（探测 PG，skipIf）→ migrate.sh 跑 → `\dt`=16 表 + tracking 5 行
- legacy：先裸建 `users` 表 → 跑 → stamped（tracking 5 行但无 CREATE TABLE 执行——用「再跑一次不报 already exists」反证 + 日志断言 baseline）
- 幂等：三连跑 exit 0
- 响亮失败：塞坏 .sql → exit ≠ 0 + stderr 含文件名
- 静态：两 entrypoint 源文本不含 `cli.js up`；不含对 migrate 的 `|| true`
**验收**: 上列测试全绿；`bash -n` 语法门；container/deploy 冒烟归 T6 终验。

## L-T2 selfHealSeed 有界重试（spec D2）

- `permissions-seed.ts`：拆 `runSelfHealOnce(dbUrl)`；`selfHealSeed(dbUrl, opts?)` attempts=6/delayMs=5000/可注入 runOnce seam；中途 warn、末次 error 带「guarded routes 403」提示
- `index.ts:40` 调用形态不变（`void selfHealSeed(...)`）
- 测试：注入失败-成功序列断言 attempts=2；恒失败断言 attempts=6 + error 一次；首成断言 attempts=1（fake timers 防真睡）
- 红线：buildApp() 无启动副作用约束不碰（route-guard.test 静态锁仍在）

## L-T3 进程防线（spec D4）

- `index.ts`：SIGTERM/SIGINT 注册旁补 `uncaughtException`/`unhandledRejection` → `logger.fatal({err}, ...)` + `process.exit(1)`
- `start.sh`：`DEPLOY_STOPPING` 标志 + 重启 while 环（cleanup() 置标志；崩溃 log_warn + sleep 3 重拉；正常 TERM 退出不复活）
- 测试：index.ts 静态断言两 handler 注册（import 触发真 listen，不做行为测——先例 route-guard.test 静态锁）；start.sh 环逻辑 `bash -n` + 人工场景归 T6（kill -9 实弹）

## L-T4 启动降级告警（spec D5）

- `config.ts`：`export function warnDegradedChecks()` 返回字符串数组（纯函数，判项 = MFA_ENCRYPTION_KEY/SMTP/OAuth providers/SAML/WEBAUTHN_ORIGIN 默认值+prod/SITE_URL prod）；`index.ts` 启动时逐条 `logger.warn`
- 零行为变更、零 fail-fast
- 测试：env 矩阵两例（全缺→N 条；全配→0 条）+ prod localhost 站点断言

## L-T5 CI（spec D3；依赖 T0 事实 2/3）

- `ci.yml` test job：`pnpm test` → `pnpm test:coverage`；阈值按 T0 实测定（≥80 保留；否则降档 + `ponytail:` 注释 + backlog 行）
- 新增 `e2e` job：services postgres:16 + redis:8（healthcheck 门），install → build → `npx playwright install --with-deps chromium` → `npx playwright test --project=chromium`；env 含 DATABASE_URL/REDIS_URL/JWT_SECRET/MFA_ENCRYPTION_KEY（32-hex 测试值）/no_proxy；`if: always()` 上传 playwright-report artifact
- 本地不可全验（GitHub runner）→ 交付声明标 NOT VERIFIED (CI-side)，push 后由用户回报首跑
- 若 T0 盘点发现 spec 需真后端 wizard 态不可确定性满足 → 按 D3 逃生门 pin 子集（`testIgnore` 明示 + backlog 登记）

## L-T6 终验收口

- 全量：vitest（对照 T0 基线）· 双 tsc + 根闸 · eslint 改动面 · e2e 全量本地（mock，5101 停）
- 容器实弹：`docker build` → 空卷 run → `\dt` 16 表 + `/health/ready` db:true；重启零重放
- deploy 实弹：`build:deploy` → `start:deploy`（fresh data/）→ 同上；再演 legacy 分支（预建 users 裸表 → stamp 日志）；kill -9 server → 环重拉且 PG 存活
- memory 收口：status 批次行 + conventions（migrate.sh 契约：新链文件自动被 apply；改链目录名两处同步）+ 若有新坑 PIT 入库；本计划文件尾部补「执行记录」

## 顺序与并行

T0 →（T1 ∥ T2 ∥ T3 ∥ T4 文件面互不相交：T1=shell+新测试，T2=permissions-seed，T3=index.ts+start.sh——**T2/T3 共 touch index.ts 相邻行，合并为同一实现单元或串行**）→ T5（需 T2/T4 落地后 CI 才有全绿可能）→ T6。
派发切分：T1 独立；T2+T3 合派一人（同文件协调）；T4 独立；T5 独立；控制器保 T6。

## T0 实测记录

（执行时填写）
