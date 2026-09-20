# 批次 L（运维 P0）实施计划

**依据 spec**: `docs/superpowers/specs/2026-09-20-batch-l-opsp0-design.md`（已按双 Momus 附录修订）
**审核附录**: `docs/superpowers/plans/2026-09-20-batch-l-opsp0-REVIEW-ADDENDUM.md` — flows R1-R9 / blockers B1-B2,H1,M1-M3,L1-L6 全部吸收于下文加粗「[R/B/H/M/L- n]」标记处
**日期**: 2026-09-20
**执行模式**: subagent-driven（全 TDD；每任务独立审查；bg 通道死则按 PIT-060/H-T4c 先例控制器直接实现）

## 前置纪律（每任务通用）

- 测试前 `export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1`
- vitest 基线对照：`352 passed | 7 skipped`（PG 双态，H′ 入册）+ 全仓 826/0/7
- 提交/注释英文，本计划中文；`git add` 显式路径；commit 后 `git branch --show-current` 验 master
- 迁移链目录 `packages/migration/drizzle/`；存量库继续 db:push（conventions 既有约束不动）
- 禁止 sed 改代码；shell 脚本改动 = 整文件级审阅

---

## Task 0 (L-T0) 侦察（无代码变更，产出事实清单）

1. `out/packages/migration/drizzle/*.sql` 是否随 `build:deploy` 落地（读 scripts/deploy/build.sh 复制循环节；缺则 T1 需补 build.sh 复制行——列入 T1 diff）。
2. 本地跑 `pnpm test:coverage`（全仓），抄录四类实测数（statements/branches/functions/lines）与阈值 80 的差距 → 决定 D3 re-baseline 值。
3. e2e 套件真后端依赖盘点：逐一列出哪些 spec 在 mock-API 模式需 webServer（vite）与/或真 5101；确认 CI job 里 playwright `webServer` 配置能否满足（若 health.spec 自 skip、setup-real 类不存在即无碍）。
4. 检查 drizzle 0000-0004 SQL 是否含不能跑在事务里的语句（`CREATE INDEX CONCURRENTLY` 等）→ 决定 `-1` 保留。
5. 检查容器镜像内 psql 可用性（Dockerfile PGUSER trust 本地连接）与 deploy 侧 psql（pixi native bin）连接参数差异（DATABASE_URL → psql 分解）。

**验收**: 事实在本文件尾部「T0 实测记录」落笔（5 条齐全）后才允许动 T1-T5。

## Task 1 (L-T1) 迁移接线（P0 核心，spec D1）

**新建 `scripts/migrate.sh`**（纯 bash+psql，无新依赖）:
- 入参 **[R3]**：`migrate.sh <chain-dir>` 第一位置参数必填（容器 `/app/packages/migration/drizzle`；deploy 仓库根路径——out/ 无链，已实锤，不改 build.sh）；缺参/目录缺/零 `NNNN_*.sql` ⇒ exit 1 响亮（绝不空 stamp）
- 连接 **[R7]**：`psql "$DATABASE_URL"` 有值即用；无值裸 `psql` 吃 PG\* socket 环境（容器 trust）
- 逻辑 **[H1][LOW-5]**：tracking 表 `(id, applied_at, note text)` IF NOT EXISTS → 空表且 `users` 存在 ⇒ baseline stamp（`note='stamped'`）**后跑链尾哨兵探测 `SELECT phone FROM users LIMIT 1`，列缺 → 响亮 error 行 `legacy DB behind chain head (0004) — run db:push to reconcile` 且 exit 0 不阻断** → 按字典序逐文件 `psql -v ON_ERROR_STOP=1 -1 -f` + 成功即插行 → 失败 exit 1 带文件名
**改调用点**:
- `docker/entrypoint.sh:32` → `bash /app/scripts/migrate.sh /app/packages/migration/drizzle`（删 `|| true`）
- **[R4] Dockerfile** runtime 段补 `COPY --chmod=755 scripts/migrate.sh /app/scripts/migrate.sh`（镜像现无 scripts/，实锤）+ 顺手 **[L-4]** HEALTHCHECK 加 `--start-period=60s`
- `scripts/deploy/start.sh:113` → `bash "${PROJECT_ROOT}/scripts/migrate.sh" "${PROJECT_ROOT}/packages/migration/drizzle" || { log_error "Migrations failed — aborting"; exit 1; }`
**测试（RED 先行）[R5]**: `apps/server/src/__tests__/ops-migrate.test.ts`（vitest include 只收 packages/apps，scripts/ 不被收集）：
- fresh（skipIf PG probe）：临时库 → 跑 → 16 表 + tracking 5 行
- legacy-behind：**裸建 users（无 phone 列）**→ 跑 → stamped + **error 行含 chain head 文案**、exit 0
- 响亮失败：塞坏 .sql → exit ≠ 0 + stderr 含文件名
- 幂等：三连跑 exit 0；缺目录 → exit 1
- 静态：两调用点源文本不含 `cli.js up`/对 migrate 的 `|| true`；Dockerfile 含 COPY migrate.sh 行
**验收**: 测试全绿；`bash -n`；container 镜像内 `/app/scripts/migrate.sh` 存在归 T6 docker build 验。

## Task 2 (L-T2) selfHealSeed 有界重试（spec D2）

- `permissions-seed.ts`：**[M1]** `runSelfHealOnce(dbUrl)` = 拨号 + **探活 `SELECT 1 FROM permissions`（失败 throw）** + 再跑现有吞错 body（`ensureSeedForAdmin` never-throws 契约保留——init/setup 共用不开 throw 口）；`selfHealSeed(dbUrl, opts?)` attempts=6/delayMs=5000/可注入 seam；中途 warn、末次 error 带「guarded routes 403」提示
- `index.ts:40` 调用形态不变（`void selfHealSeed(...)`）
- 测试 **[R1]**：注入失败-成功序列断言 attempts=2；恒失败断言 attempts=6 + error 一次；首成断言 attempts=1（fake timers 防真睡）；**真探活断言**：坏连接串 → runSelfHealOnce reject（证探针可观测失败，防再犯吞错死环）
- 红线：buildApp() 无启动副作用约束不碰（route-guard.test 静态锁仍在）

## Task 3 (L-T3+T4) 进程防线 + 启动降级告警（spec D4）

- `start.sh` 重启环 **[B1][B2][L-1]** 四条硬事实：① 环体 `code=0; wait "$SERVER_PID" || code=$?`（全局 set -eo pipefail 下裸 wait 非零即卒，重拉分支永不达）；② wrapper `$$` 落 `data/.startpid`，`stop.sh` **先 TERM wrapper**（trap 置 `DEPLOY_STOPPING=1` → 环检标志退出走 cleanup）再走现流程——否则 stop:deploy 演变为「杀 server→3s 复活→PG 没了僵尸占 5101」；③ **每轮重写 server PID 进 PIDFILE**（cleanup 永不打现役代）；④ 15s 内连退 3 次 → log_error crash-loop + break 收栈（坏 env 无限刷屏护栏）
- `index.ts`：`app.log.fatal({err}, 'uncaught exception')` + `process.exit(1)` 双 handler（uncaughtException/unhandledRejection），listen 前注册；**不引 logger import**（index.ts 现走 app.log）
- 测试：index.ts 静态断言两 handler 注册（先例 route-guard.test 静态锁）；start.sh/stop.sh 环逻辑 `bash -n` + 场景归 T6（kill -9 实弹 + B2 场景）

### T4 启动降级告警（spec D5）

- `config.ts`：`export function warnDegradedChecks(env, isProd): string[]`（**[R6]** 纯函数零 import 零副作用；**env-only 判项**：MFA_ENCRYPTION_KEY/SMTP env/OAuth env/SAML env/WEBAUTHN_ORIGIN prod 默认 localhost/SITE_URL prod——options 表 listen 后才预热，boot 不可见，文案带「options-configured 除外」限定）；`index.ts` buildApp 后逐条 `app.log.warn`
- 零行为变更、零 fail-fast
- 测试：env 矩阵两例（全缺→N 条；全配→0 条）+ prod localhost 站点断言

## Task 4 (L-T5) CI + playwright webServer（spec D3；依赖 T0 事实 2/3）

- **前置 [R2]**：`playwright.config.ts` webServer command 加 CI 分支 `process.env['CI'] ? 'pnpm --filter @accessbase/admin-ui dev' : 'pnpm run dev'`（否则 CI 递归 watch 饿死 vite，e2e job 全灭；本地 reuse 路径零变化）
- 新增 `e2e` job **去服务化 [结构简化]**：install → `npx playwright install --with-deps chromium` → `npx playwright test --project=chromium`。**无 PG/Redis services、无 build、无 DATABASE_URL**——admin-ui 零运行时 @accessbase import（实锤）、chromium 项目 testIgnore 排除 setup-real、health.spec 在 5101-down 自跳。CI 中 **5101 必须无监听**（mock 纪律，job 内断言或注明）。`if: always()` 上传 playwright-report artifact
- 验收声明措辞 [L-2]：不声称「真后端 e2e 已入 CI」（health skip / setup-real 排除）；真迁移链路验证在 T6 实弹
- test job **[M2]**：`pnpm test:coverage -- --reporter=junit --outputFile=test-results.xml`（junit 透传保留，dorny 消费不断）
- coverage **[M3]** 先修后测：vitest.config.ts `coverage.exclude` 改 `['**/node_modules/**','**/dist/**','**/*.test.ts','**/*.spec.ts']` + `include: ['packages/*/src/**/*.ts','apps/*/src/**/*.{ts,tsx}']` 保 `all:true` → 本地重测一次 → 阈值=逐维 floor−5 + `ponytail:` 注释；数字仍飘 → thresholds 移除 INFO-only + backlog（**1 任务时间盒，超时即降级，e2e job 不等它**）
- 本地不可全验（GitHub runner）→ 交付声明标 NOT VERIFIED (CI-side)，push 后由用户回报首跑；runner 独有红的逃生门 = pin 子集 + 响亮 backlog

## Task 5 (L-T6) 终验收口

- 全量：vitest（对照 T0 基线）· 双 tsc + 根闸 · eslint 改动面 · e2e 全量本地（mock，5101 停）
- 容器实弹：`docker build` → 空卷 run → `\dt` 16 表 + `/health/ready` db:true；重启零重放
- deploy 实弹：`build:deploy` → `start:deploy`（fresh data/）→ 同上；再演 legacy-behind 分支（预建 users 裸表无 phone → stamp + **chain-head error 行出现**、exit 0）；kill -9 server → 环重拉且 PG 存活 **[B1 的证伪测试]**；**[B2] crash-restart 后 `stop:deploy` → 全栈归零（5101 无监听、PG/Redis down、无孤儿 node）**；`docker build` 后镜像内 `/app/scripts/migrate.sh` 存在 + HEALTHCHECK start-period 在位
- memory 收口：status 批次行 + conventions（migrate.sh 契约：新链文件自动被 apply；改链目录名两处同步）+ 若有新坑 PIT 入库；本计划文件尾部补「执行记录」

## 顺序与并行

T0 →（T1 ∥ T2 ∥ T3 ∥ T4 文件面互不相交：T1=shell+新测试，T2=permissions-seed，T3=index.ts+start.sh——**T2/T3 共 touch index.ts 相邻行，合并为同一实现单元或串行**）→ T5（需 T2/T4 落地后 CI 才有全绿可能）→ T6。
派发切分：**T1 独立**（shell+Dockerfile+entrypoint+迁移测试）；**T2 独立**（permissions-seed+测试，不碰 index.ts 调用行）；**T3+T4 合派一人**（同 touch index.ts，且 T3 兼带 start.sh/stop.sh）；**T5 独立**（playwright.config+ci.yml+vitest.config）；控制器保 T6。

1. **out/ 不含 .sql 链**（build.sh 只复制 dist+package.json）→ 定案：deploy 路径链源用仓库根 `${PROJECT_ROOT}/packages/migration/drizzle`（start.sh 本在仓库内运行），**不改 build.sh**；容器镜像整包 COPY /app/packages/ → 链在 /app 内可用。但 Dockerfile **不 COPY scripts/** → 需补一行 `COPY scripts/migrate.sh /app/scripts/`（+chmod）。
2. **coverage 实测不可信且配置长期坏**：默认 include 把 node_modules（tinycolor2/zustand 等）算进分母（exclude 写法不匹配 .pnpm 布局）→ 全局 55.46% 是假数。白名单 src 重测：apps/server 89.6/75.4/79.6（stmts/branch/funcs）；identity 69.6；packages/health|logging|i18n|types|admin|migration 显 0%（workspace 包经 dist 解析，src 被 all:true 当未测拾入）→ 分母受 src/dist 解析噪声污染。参考真值：backend-only ≈ 74/78/85。**CI 门决策（待 Momus 后定）**：候选 = 修 coverage include + per-dir 阈值，或首步降级 INFO 报告（不挂阈值）+ 收紧门入 backlog。
3. e2e 后端依赖：仅 health.spec 真后端（自探跳）；其余 25 套 page.route mock；webServer `pnpm -r run dev` 递归 watcher（tsc watch×8+tsx+vite），url 探 5173，CI=true 分支 retries:2/workers:1 已备。fresh CI DB = needsSetup 态——GlobalGuard 重定向是否打断 mock 流 = T5 实测评定项（批 11 已给 auth/dashboard 补过 /setup/status mock）。
4. 链 SQL 事务安全：0000-0004 无 CONCURRENTLY；`--> statement-breakpoint` 行 psql 按 `--` 注释安全；CREATE INDEX 均 IF NOT EXISTS → **`-1` 单事务保留可行**。
5. psql 连接：容器 trust+socket（$PGUSER/$PGDATABASE 现成）；deploy pixi PG listen localhost:$PG_PORT trust（DATABASE_URL 默认已按 $PG_PORT 拼好，start.sh:106）——两路均 `psql "$DATABASE_URL"` 可连；migrate.sh 需处理 DATABASE_URL 未设回退。
6. **审核期追加实锤（Momus-blockers）**：链 0 DROP/TRUNCATE（误 stamp 可恢复）；`/health/ready` db 检查=SELECT 1 兜不住 schema-behind；stop.sh 只杀 server PID（B2 击穿路径）；health 0% 归因不成立（src 相对导入，M3 重测定夺）；admin-ui 零运行时 @accessbase import（e2e job 去服务化）；chromium 项目 testIgnore setup-real 在位（CI 无毁库风险）；deploy 首启时序无竞态（pg_ctl -w→createdb→stop→条件再启→migrate）。

---

## 执行记录（T6 终验证据，2026-09-20）

- **Task 1** `b9e25b5`：migrate.sh 61 行 + 11 测试（RED 11-fail→GREEN）；review APPROVED（spec ✅ 全项）。
- **Task 2** `47d8aac`：runSelfHealOnce 探针 `SELECT 1 FROM permissions` + 6×5s 环；9/9；review APPROVED。
- **Task 4/CI** `8fa4aa7`+`57f876a`：e2e 去服务化 job + webServer CI 分支 + junit 透传 + coverage 修配置实测 51.01/76.19/75.05/51.01（drift 0.00×2）→ 阈值 46/71/70/46；review APPROVED。
- **Task 3** `47bfaaf`+`bb9f729`：双 handler + warnDegradedChecks(env,isProd) 纯函数（5 判项，prod-gate 2）+ 重启环四硬事实 + stop.sh wrapper-first + NODE_ENV 前移（_common.sh 零引用核实）；RED 18→GREEN 24；apps/server 474/0/11；review APPROVED（四事实逐条 ✅）。
- **T6 实弹全过**：fresh deploy 5/5→16 表+5 记→ready→**RS256 真登录 200**；幂等重放 0/5；kill -9→复活 PG 存活；复活后 stop→全栈归零无孤儿；legacy 裸表→stamped+chain-head ERROR 行+exit 0（表数=1 证 stamp≠apply）；坏 env→pre-flight 干净 exit 1；**crash-cap 实战触发**（缺 RS256 键三次即停）；容器 fresh 16+5/restart 0/5/ready/migrate.sh 在镜像可执行。
- **实弹抓到并修复出厂缺陷** `5ab6c7b`：oidc provider.ts `require('node:crypto')` 在编译后 ESM dist 生产 RS256 路径崩溃（dev/vitest 有 require shim 掩盖、且该路径仅生产可达）→ 静态 import + 全仓 eslint `no-require-imports` error 门禁。
- 终态门禁：vitest **856/0/11**（PG-down）· coverage 门 **PASS**（51.05≥46 / 76.37≥71 / 75.10≥70）· 双 tsc 净 · eslint 0 error（+2 warning=延迟项 (d)）· e2e **126+3 workers=1**（并行首跑的 oauth flake 单测+workers=1 双验通过，非回归）。
