# 批次 L（运维 P0）双 Momus 审核附录

**审核对象**: spec `2026-09-20-batch-l-opsp0-design.md` + plan `2026-09-20-batch-l-opsp0.md`
**审核人**: Momus-flows（引用核对+流程正确性）+ Momus-blockers（对抗破坏面）
**判定**: flows = REJECT（2 CRITICAL + 2 MAJOR + 4 MINOR，全部吸收后转可执行）；blockers = 见 B 节

---

## A. Flows 线发现（R1-R9）

### R1 [CRITICAL] D2 重试环是死代码——吞错链使失败永不可观测
- **证据**: `ensureSeedForAdmin` 全量 catch-and-log（permissions-seed.ts:132-135 "best-effort: never crash startup"），`selfHealSeed` 外层再吞（:150-152），`createDb` 仅构 Pool 不拨号（identity/db/index.ts:16-22）。spec D2 让 `runSelfHealOnce` = "current body"——DB 宕机时该 body 照样正常 resolve → **重试环永不触发，G6 未修**。注入式 runOnce 测试接缝恰好吃掉这个缺陷（注入函数能 throw，生产函数不能）。
- **吸收（定稿方案）**: `runSelfHealOnce` = 前置**探活查询 `SELECT 1 FROM permissions`**（一举三角色：连接活着 + 核心 schema 存在 + 失败可 throw），探活成功后再跑现有吞错 body（seed 本体语义/日志全不动）。新库未走向导（无 admin 角色）时探活通过、body no-op、attempt-1 正常退出——无惊扰重试。测试补 down-DB 集成锁（假 runOnce-first-fail 只证环，另加真探活断言）。

### R2 [CRITICAL] CI e2e webServer 被 watch 饿死——`pnpm run dev` 在 CI 永不达 vite
- **证据**: `playwright.config.ts:29` command=`pnpm run dev` → 根 `package.json:13` = `pnpm -r run dev`；8 包 dev=`tsc --watch` 永不退出，递归并发默认 4，拓扑序把 apps/admin-ui 排最后 → vite 永不启动 → CI（`reuseExistingServer: false`）webServer 超时、e2e job 全灭。本地被 `reuseExistingServer: true`（dev 已人工拉起）完全掩盖。
- **吸收**: webServer command 加 CI 分支：`process.env['CI'] ? 'pnpm --filter @accessbase/admin-ui dev' : 'pnpm run dev'`。mock 套件本就浏览器层 page.route，不需要 5101（约定：mock 全量跑时 5101 必须无后端——CI 只拉 vite 恰好满足）；health.spec 自探测自跳过。**CI 纪律明文**：e2e job 不得启动 server 进程。

### R3 [MAJOR] spec D1 "build.sh copies the package dir" 为假——out/ 只有 dist+package.json
- **证据**: build.sh:43-47 仅 `cp -r packages/$pkg/dist` + package.json → `out/packages/migration/drizzle/` 不存在。
- **吸收（比审稿建议更懒）**: 不补 build.sh 复制行。deploy 调用点显式传仓库根链目录 `bash scripts/migrate.sh "${PROJECT_ROOT}/packages/migration/drizzle"`；容器传 `/app/packages/migration/drizzle`（Dockerfile:93 整包 COPY 已在镜像内）。migrate.sh 链目录改为**第一位置参数（必填）**，删 SCRIPT_DIR 相对猜测。spec D1 括注同步改写。

### R4 [MAJOR] 容器 runtime 镜像没有 /app/scripts——COPY 行是必加项非条件项
- **证据**: Dockerfile:93-100 无任何 scripts/ COPY（entrypoint 自己落在 /entrypoint.sh）。
- **吸收**: Dockerfile runtime 段新增 `COPY --chown=accessbase:accessbase scripts/migrate.sh /app/scripts/migrate.sh`（+RUN chmod +x 或 COPY --chmod=0755）。T1 验收加镜像内路径断言（`docker build` 后 `docker run --rm image ls -l /app/scripts/migrate.sh`）。

### R5 [MINOR] `scripts/__tests__/migrate.test.ts` 不被 vitest 收集
- **证据**: vitest.config.ts:18 include 仅 `packages/**` + `apps/**`（T0 已实锤）。
- **吸收**: 定死 L-T1 测试 = `apps/server/src/__tests__/ops-migrate.test.ts`。

### R6 [MINOR] D5 与 L-T4 措辞分叉 + env 层看不见 options 驱动的 OAuth/SAML
- **证据**: spec 说 config.ts 内 logger.warn，plan 说纯函数 + index.ts 打；options 表在 listen 后预热（index.ts:44-49），env-only 判项会把 options 已配置的 provider 误报为降级。
- **吸收**: 采 plan 版（纯函数 + 启动侧 app.log.warn）。**判项收窄为 env-only 可断言集**：MFA_ENCRYPTION_KEY 缺、SMTP env 缺（注记 options 可另行配置）、WEBAUTHN_ORIGIN prod 默认 localhost、SITE_URL prod 缺；OAuth/SAML 判项措辞限定 "no env-level provider config (options-table config not visible at boot)"。

### R7 [MINOR/备案] deploy DATABASE_URL 与 PG_PORT 解耦陷阱（预存，非本批新伤）
- .env 显式钉死 5432 而 PG_PORT=5433 时 server 同瞎。migrate.sh 与 server 同吃 `psql "$DATABASE_URL"`，故障面对称，不新增。记 pitfalls。

### R8 [备案] 引用体检：G1/G2/G4/G5/G6/G8/G9 全实、链 5 文件 16 表无 CONCURRENTLY、双模式 psql 可连、route-guard.test 静态锁与 T2/T3 改动面兼容、`--project=chromium` 天然排除 setup-real 项目（chromium testIgnore 在位）。

### R9 [流程] `pnpm test:coverage` 存在可直接挂 CI，但**分母实测被 node_modules 与 src/dist 解析噪声污染**（T0.2）——覆盖门槛值本身不可信。

## B. Blockers 线发现（B1-B2, H1, M1-M3, L1-L6）

### B1 [BLOCKER] 重启环被 `set -eo pipefail` 杀死——wait 非零即脚本卒，重拉分支永不达
- 证据：`start.sh:3` 全局 set -e；server 崩溃时 `wait $SERVER_PID` 返回非零（137/1）→ 在执行重启分支前就触发 EXIT trap 连坐 PG/Redis → G8 未修且 T6 kill -9 实弹必红。`log_warn "(code $?)"` 的 `$?` 在独立行展开时也已失真。
- 吸收：循环体钉死 `code=0; wait "$SERVER_PID" || code=$?` 后统一用 `$code`。

### B2 [BLOCKER] 重启环击穿 stop:deploy——杀 server = 被重拉，事后留下无库僵尸
- 证据：`stop.sh:19-26` 只对 PIDFILE 内 server PID 发 TERM（今天能停恰因"杀 server→wait 返回→脚本退→trap 收栈"）；加环后 stop.sh 继续关 PG/Redis、删 PIDFILE，环 3s 重拉孤儿 node 占 5101。次级同族：环重拉后 PIDFILE 不再更新，cleanup 打的永远是第一代死 PID。
- 吸收：start.sh 把 wrapper `$$` 落第二份 pid 文件；stop.sh 先 TERM wrapper（trap 置 `DEPLOY_STOPPING=1` → 环检标志退）再走现流程；环每轮重写 server PID 进 PIDFILE。T6 新增场景"crash-restart 后 stop:deploy 全栈归零 + 无残留监听"。

### H1 [HIGH] baseline stamp 对 legacy-behind 卷完全静默，/health/ready 兜不住
- 证据：哨兵 = users 存在 + tracking 空 ⇒ 全入库；`health.ts` ready 的 db 检查 = `SELECT 1` 永远 ok；缺 tenants/phone 列的运行期 42703 全被吞错链就地记账（permissions-seed.ts 三层 catch）；而 migrate 步骤宣告成功。附带好消息（attack 4 落定）：全链 0 DROP/TRUNCATE → 误 stamp 响亮失败可恢复，真风险只剩 stamp-behind。
- 吸收：migrate.sh stamp 分支后加链尾哨兵探测 `SELECT phone FROM users LIMIT 1` → 列缺则 `log_error "legacy DB behind chain head (0004) — run db:push"`，**不阻断**（K-T4 R3 哲学）。T6 legacy 场景断言该 error 行出现。tracking 表补 `note text` 列（stamp 行='stamped'），不给实现者留发挥空间（LOW-5）。

### M1 [MED] 探针 `SELECT 1` 太弱 → 定稿 `SELECT 1 FROM permissions`
- 表存在性一行换：连接活 + 核心 schema 在；`ensureSeedForAdmin` 的 never-throws 契约保留不动（init/setup 共用）。预向导新库（表存 0 行）probe 过、body no-op、attempt-1 正常退。残余由 H1 哨兵覆盖。

### M2 [MED] test:coverage 切换必须保留 junit 透传
- `ci.yml:59-65` 的 dorny/test-reporter 消费 `test-results.xml`；L-T5 改为 `pnpm test:coverage -- --reporter=junit --outputFile=test-results.xml`，写进 diff 要求。

### M3 [MED] coverage 决策定稿：先修配置再测，不稳则 INFO-only，1 任务时间盒
- `vitest.config.ts` exclude 是无 `**/` 前缀的字符串（漏 .pnpm 布局）= 55.46% 假数根因；T0.2 对 health 0% 的归因不成立（`service.test.ts:2` 是 `import '../service.js'` src 相对导入，重测大概率非 0）。定稿：`all:true` + include 白名单 `["packages/*/src/**/*.ts","apps/*/src/**/*.{ts,tsx}"]` + exclude 修正式 `**/node_modules/**`/`**/dist/**`（未触文件显式 0% 正是地板本意）→ 重测一次，阈值 = 实测逐维下取整再减 5；仍不稳 → thresholds 移除、报告照打（INFO-only）+ 收紧门入 backlog。

### LOW（不阻塞，入 T6/收口）
- L-1 环无退避封顶：坏 env（JWT_SECRET 缺失→import 即抛，预检因 NODE_ENV 默认 :109 后设而漏拦）→ 3s 无限刷屏。**采纳廉价护栏**：15s 窗口内连退 3 次 → log_error + break 走 trap 收栈（一行计数数组，不引 systemd）。
- L-2 `playwright.config.ts:18` chromium 项目确有 `testIgnore: /setup-real/` ✓；CI 永不跑毁库 spec；本地/CI 失败形态恒等（5101 均无监听）。验收声明不得声称"真后端 e2e CI 已覆盖"（health.spec 在 CI 必 skip）。
- L-3 conventions 收口行：运行时迁移唯一写者 = scripts/migrate.sh；禁对同库混用 `db:migrate`（up:pg 读不存在的根 ./drizzle 且写 `__drizzle_migrations`，现状 inert）。
- L-4 Dockerfile HEALTHCHECK 顺手补 `--start-period=60s`（首启含 initdb+全链）。
- L-5 见 H1 吸收（note 列）。
- L-6 fresh deploy 首启时序已核无竞态（`pg_ctl -w` → createdb → stop → 条件再启 → migrate）；createdb 的 `|| true` 吞错由 migrate 转必需后的 exit 1 兜住。

### 结构性简化（审稿衍生，非审稿条目）
- admin-ui 对 @accessbase/* **零运行时 import**（唯一命中是 `api/users.ts:4` 注释）→ **e2e CI job 去服务依赖**：无 PG/Redis services、无 build、无 DATABASE_URL——install → `npx playwright install --with-deps chromium` → `npx playwright test --project=chromium`（webServer CI 分支只拉 vite）。原 D3 的 service/env 矩阵整段作废。

**双 Momus 终判：两路均 REJECT → 全部吸收后转可执行；无未消化 BLOCKER/CRITICAL/HIGH。**
