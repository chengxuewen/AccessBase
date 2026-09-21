# 批次 M 双 Momus 对抗评审附录

**日期**: 2026-09-20 | **评审对象**: spec de87a23 + plan ae81228 | **裁定**: FLOWS = **APPROVE-WITH-FIXES**（3 MAJOR 全一线修复）；BLOCKERS = **APPROVE-WITH-FIXES**（含 1 BLOCKER 数据丢失面）

## 必须修（BLOCKER/HIGH）

| # | 级别 | 发现 | 吸收 |
|---|---|---|---|
| B1 | **BLOCKER** | restore 确认框**不回显目标身份**：DATABASE_URL override 最高优先——stale shell 指向 prod + 泛化 yes/no 提示 → `pg_restore --clean` 抹 prod | 提示**必打 host:port/dbname/user**；非 localhost 或 DATABASE_URL 显式设置时要求**键入库名**确认（ACCESSBASE_RESTORE_CONFIRM=yes 旁路，独立变量） |
| B2 | **HIGH** | dump 文件默认 umask 0644 世界可读，而 schema 实锤 `sessions.token` **明文 varchar**（+oauth 令牌+passwordHash）——备份=皇冠钥匙 | 脚本开头 `umask 077` + 产物 chmod 600；报告/头注明 dump 含明文 session 须按机密管理 |
| R2/B3 | **HIGH** | setup-guard ALLOWED_PATHS（:16）无 '/metrics'：setup 前 403 SETUP_REQUIRED、setup 后**每次抓取一趟 DB 查询**（D113 无缓存）、且 PG-down vitest 基线下 metrics 测试拿 503 **炸信号归零门** | ALLOWED_PATHS += '/metrics'；T2 文件矩阵 += middleware/setup-guard.ts；测试 PG-down 绿 |
| B4 | **HIGH** | 「unset=open 镜像 JWT 哲学」**论据为假**（JWT prod fail-fast；metrics 裸奔）；prod 下 route-pattern 直方图标签=**全 API 面地图**+`nodejs_version_info` 指纹；CORS 空单 dev 回显任意源 | 承 K-T4 禁新 fail-fast：**warnDegradedChecks 增 env-only 告警行**（prod & 无 token）+ `/metrics` 路由级 `cors:false`（服务器对服务器抓取无需 CORS）——一刀封两类 |

## MAJOR（flows）

| # | 发现 | 吸收 |
|---|---|---|
| R1 | 限流「既有 /health skip 列表」**伪前提**（app.ts:96-104 无 skip，utils/limiter 幽灵文件） | 改为：app.ts 注册处新增 `skip: req => /health 或 /metrics 前缀`；T2 矩阵删 utils/limiter 行 |
| R3 | **D4 机制与镜像现实不符**：compose server 走 Dockerfile.dev ENTRYPOINT=`entrypoint-dev.sh`（`command:` 被吞为入参），push **已在** :50 执行但 `2>/dev/null \|\| echo skipped` **吞败** | T4 重定向：改 entrypoint-dev.sh（push 失败致命或重试+显错），文件矩阵 += docker/entrypoint-dev.sh；compose command 改法**撤销**；G5-4 实弹（down -v→up→/setup/status 200）为唯一仲裁，机制如再异据实修 |

## MED/LOW（全采纳）

- **401↔403 跨文档矛盾**（G5/plan-T5 vs D2）→ 全文统一 **403 METRICS_AUTH**
- **`reply.routeOptions` 在 fastify@4.29.1 不存在**（reply.d.ts 无）→ **`request.routeOptions.url`**；404 无匹配 → 标签回退 `'unmatched'`（防 undefined 标签/高基数）
- **in-flight 表与 /oidc hijack 交互**：hijack 后 onResponse 不触发 → metrics hooks **注册在 hijack 之后**，/oidc 不计（文档化盲区，避免只增不减漏表）
- health 单例：close 后复用毒池（多 buildApp 测试序）→ onClose 里 `readyDb=undefined` 复位；async-import 竞态双池 → 单一 memoized promise；closeDb 前 null 守卫
- URL→PGPASSWORD 解析需 **%XX 百分号解码**（密码特殊字符）
- retention：`find "$OUT" -maxdepth 1 -type f -name 'accessbase-*.dump'` 白名单式删除 + OUT 目录校验
- timingSafeEqual 长度侧信道 → 两侧先 sha256 再比
- spec 正文 ACCESSBASE_RESET_CONFIRM 残留 → 改 RESTORE（plan 已裁）
- .gitignore `data/` 已覆盖 data/backups——步骤删除（防误导）
- db:push 漂移交互提示挂起风险：dev 容器非 TTY——随 R3 改写一并处理（失败显式≠挂起）
- closeDb 导出措辞 → 「@accessbase/identity/db 子路径」

## 派发门禁

T1/T2/T3 无阻塞（修正即本文）；T4 依 R3 改写后按实弹仲裁；T5 live-fire 清单改 403 + entrypoint 路径。
