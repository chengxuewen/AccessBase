---
name: security-hardening
description: 'AccessBase 安全加固。OWASP Top 10 + JWT/RBAC + 数据库安全 + 密钥管理。发布前/权限模块修改后/新增 API endpoint 后使用。'
---

# security-hardening — 安全加固

> OWASP Top 10 + JWT 认证 + RBAC + PostgreSQL 安全 + 密钥管理。每一条规则都有检查命令，每个检查都必须通过。

> **2026-11-09 重写（账本 E20）**：旧版 Phase 1–5 的 grep 目标 `packages/auth/`、`packages/core/`、
> `packages/admin-ui/`、容器 `audebase-postgres`、变量 `AUDE_*` 在本仓**全部不存在**（实测 MISSING）。
> 后果不是"检查不够严"，而是**每一项都返回空集 ⇒ 每一项都打印 ✅ ⇒ 报告宣称安全而无事可做**。
> 假绿在安全技能上的代价高于别处，所以本版多了一条凌驾于所有 Phase 的纪律。

## 纪律 0（先于一切 Phase）：目标存在性自检

```bash
# 必须先跑。任何 MISSING ⇒ 该 Phase 记 RED (target missing)，绝不记通过。
for p in apps/server/src apps/admin-ui/src packages/identity/src packages/audit/src \
         packages/logging/src packages/types/src .env.example .gitignore keys; do
  [ -e "$p" ] || echo "MISSING $p"
done
```

空结果只有在**目标确实存在而没匹配**时才是绿。附带一条同族教训：模式本身也会说谎——
`grep -E "hash("`（未闭合括号）与双引号里的反引号（被 shell 当命令替换执行）都曾产出假的 0；
本文件所有命令一律用 `grep -F` + 单引号。

## 触发条件

- 发布前（release candidate）
- Auth / RBAC / data-scope 模块修改后
- 新增 API endpoint，或新增/改动响应头（CORS 面）
- 新增 JWT / 加密密钥 / 轮换窗口
- 用户说 "security review" / "安全审计"

## Mode A: 审计模式

按 Phase 1→6 顺序执行，每条命令都要跑，输出进"报告格式"。任一 Phase 出现 `target missing` 记 RED。

## Mode B: Guard-while-editing（轻量）

**诚实边界**：本仓 `.githooks/pre-commit` 只跑 `agents sync → agents check`，**不含安全 guard**。
Mode B 是技能触发时的快速扫描，不是自动门。（若将来接入，必须按本节命令做一次红绿演示再宣称生效。）

```bash
# B1 危险模式（暂存文件；-F + -e 的写法是必需的，见纪律 0 附注）
git diff --cached --name-only -- '*.ts' '*.tsx' | xargs -r grep -nF \
  -e 'as any' -e '@ts-ignore' -e '@ts-expect-error' -e 'eval(' || true

# B2 密钥字面量（排除 process.env 引用与 .env.example）
git diff --cached --name-only -- '*.ts' '*.tsx' | xargs -r grep -nF \
  -e "sk-" -e "BEGIN RSA PRIVATE KEY" -e "password: '" || true

# B3 依赖漏洞（仅当 lockfile 变更）
git diff --cached --name-only | grep -q 'pnpm-lock.yaml' && pnpm audit --audit-level high | head -20 || echo "skip: lockfile unchanged"
```

## Phase 1：密钥与配置

| 检查项 | 命令 | 通过标准 | 本仓事实 |
| --- | --- | --- | --- |
| 私钥不入库 | `git ls-files keys/` | 空 | `.gitignore:101-102` 已排除 `keys/`；工作区存在 `keys/*.pem` 供 dev 使用 |
| 私钥权限 | `stat -c '%a' keys/*.pem` | 私钥 ≤600 | 实测 `664` ⇒ **LOW 提示**：dev 密钥放宽，部署时须收紧或改用 env 注入 |
| `.env` 不入库 | `git ls-files .env` | 空 | 仅 `.env.example` 入库 |
| 密钥轮换面 | `grep -oE '^[A-Z_]+_OLD' .env.example` | 存在 *_OLD 即有轮换窗口工具 | `JWT_SECRET_OLD`、`MFA_ENCRYPTION_KEY_OLD`；工具 `scripts/re-encrypt.ts`（信封密钥版本化，见 `secret-mgmt.md` 头部） |
| JWT 算法不被降级 | `grep -n "algorithm:" apps/server/src/app.ts` | `RS256` | `app.ts:196` `sign: { algorithm: 'RS256', expiresIn: '15m' }`；`config.ts:83` 记录 HMAC 降级条件（F12）⇒ 任何把算法改成 HS256 的 diff 都要 RED |

## Phase 2：认证与会话

| 检查项 | 命令 | 通过标准 | 实测基线（asOf 2026-11-09，须当场重测） |
| --- | --- | --- | --- |
| Access token 有效期 | `grep -n "expiresIn" apps/server/src/app.ts` | ≤15m | `15m` ✅ |
| Refresh 轮换 + 空闲门 | `grep -n "rotateRefreshToken" packages/identity/src/managers/SessionManager.ts` | 存在且 WHERE 内含 idle 判定 | `:170`；返回 `{refreshToken, userId}`（**不返回 access token**，见 `identity-sdd.md` as-built 表） |
| 密码哈希 | `grep -nF 'hash(' packages/identity/src/managers/UserManager.ts` | cost ≥12 | `bcryptjs`（纯 JS，非原生 bcrypt）cost 12，`:70`/`:546` |
| 失败锁定 | `grep -oE 'LOCKOUT_[A-Z_]+' .env.example` | 有键且默认非 0 | `LOCKOUT_MAX_FAILURES` / `LOCKOUT_WINDOW_SE…` |
| 限速真身（旧版本此条是假的） | `grep -n -A3 "register(rateLimit" apps/server/src/app.ts` | 明确记录全局值与 fail 策略 | `max: 100, timeWindow: '1 minute', skipOnError: true`（Redis 故障→本地计数，刻意 fail-soft）；**登录路由无专属限速** ⇒ 若客户要求撞库防护，这是待办不是既成事实 |
| route-less 逃逸 | `grep -n -B2 -A2 "escapes" apps/server/src/config.ts` | 已知并已补位 | `config.ts:158-160`：404/route-less 区不受 `@fastify/rate-limit` 覆盖；OIDC 劫持区用 `oidcIpRatePerMin: 120` 自管 ⇒ 新增非路由端点必须自带 per-IP 计数 |

## Phase 3：授权与租户隔离

| 检查项 | 命令 | 通过标准 |
| --- | --- | --- |
| 强制点存在 | `grep -rnF 'preHandler: requirePermission' apps/server/src/routes \| wc -l` | 每个写端点都在；计数随路由增长（重测，勿引用旧数） |
| 无绕过路由 | `grep -rn "method: 'POST'\|method: 'PUT'\|method: 'DELETE'" apps/server/src/routes \| wc -l` 与上一条对比 | 写操作数 ≥ 强制点数 |
| data-scope 行过滤 | `grep -rnF 'data-scope' apps/server/src/utils/data-scope.ts apps/server/src/routes/users.ts \| head` | 存在（per-binding self/dept/all，D 记录见 `security.md` 头部） |
| 租户维度贯穿 | `grep -rnF 'tenantId' apps/server/src packages/identity/src \| wc -l` | 大量命中；抽查任一列表查询是否 `eq(...tenantId)` |
| **没有 RLS** | `grep -rn "pg_policies" scripts/ docs/modules/database.md \| head` | 0 命中 ⇒ 隔离在**应用层 WHERE**，不在数据库策略。任何"RLS 已启用"的说法都是假的；新增表必须自带 tenantId 约束 |
| 系统账户保护 | `grep -rnF 'isSystem' packages/identity/src \| head` | 存在且删除路径引用它 |

## Phase 4：API 与输入面

| 检查项 | 命令 | 通过标准 / 本仓事实 |
| --- | --- | --- |
| CORS 不放行任意源（生产） | `grep -n -A6 "requireCorsOrigins" apps/server/src/config.ts` | 生产未设 `CORS_ORIGINS` ⇒ **抛错**（fail-fast，非 fail-open）；`origin: true` 只可能是 dev/test |
| 响应头暴露面 | `grep -n -A3 "exposedHeaders" apps/server/src/app.ts` | 仅列契约元数据头（`Deprecation`/`Sunset`/`Link`，见 `api.md` §23.2.1）；新增暴露头必须同时有读取方与测试 |
| 输入校验真身 | `grep -rnF "schema: {" apps/server/src/routes \| wc -l` | 走 **Fastify JSON Schema**（快照 109 处）；`zod` 虽在 `apps/server` 依赖里但**源码零引用** ⇒ 该依赖是死的，任何"Zod 校验完整"的结论都不成立 |
| SQL 拼接审查 | `grep -rnF 'sql\`' apps/server/src packages/*/src \| grep -v __tests__ \| head -40` | 逐条确认插值只出现在 `sql\`` 模板的参数位；出现 `sql\`...${` + 变量拼接 ⇒ RED |
| XSS 面 | `grep -rn "dangerouslySetInnerHTML\|innerHTML" apps/admin-ui/src` | 快照 1 处：`components/CaptchaField.tsx:59` 注入 `challenge.svg`，来源为**本仓生成**（`utils/captcha.ts` 调 `svg-captcha`，无网络）⇒ 当前可接受；规则：**内联 HTML/SVG 的来源必须是本仓生成**，接入第三方 captcha provider 时该处立即变 RED |
| 新响应头的注入面 | `grep -n "reply.header" apps/server/src -r` | 值不得含请求派生数据或控制字符（`deprecation.ts` 在启动时就拒绝 CR/LF，别把失败推到请求时） |

## Phase 5：数据库与运维面

| 检查项 | 命令 | 通过标准 |
| --- | --- | --- |
| 连接串只从 env 来 | `grep -rn "DATABASE_URL" apps/server/src/config.ts scripts/*.sh \| head` | 无硬编码；`scripts/pg-url.sh` 是唯一拼装口 |
| 迁移唯一写入者 | `grep -n "migrate.sh" docs/modules/database.md` | D117：运行时迁移只走 `scripts/migrate.sh`；任何在 app 里建表的 diff 都 RED |
| 备份即密钥载体 | `grep -n "backup" docs/runbooks/*.md \| head` | D119：备份/恢复按含密操作处理（访问控制、传输加密、留存期） |
| Metrics 暴露姿态 | `grep -n "metrics" docs/modules/monitoring.md \| head` | D119 的暴露面约定；新增 `/metrics` 消费者须鉴权 |

## Phase 6：依赖

```bash
pnpm audit --audit-level high          # 阻断级
pnpm audit --audit-level moderate | head -30   # 报告级，不阻断
# 未使用依赖（zod 就是这么被发现的）：声明数 vs 引用数
python3 - <<'PY'
import json,glob,subprocess
declared=set()
for f in glob.glob('apps/*/package.json')+glob.glob('packages/*/package.json'):
    d=json.load(open(f)); declared |= {k for k in {**d.get('dependencies',{}),**d.get('devDependencies',{})}}
src=subprocess.run(['grep','-rhoE','from .[a-z@][^'\"]+.','apps','packages','-r','--include=*.ts','--include=*.tsx'],
                   capture_output=True,text=True).stdout
print('declared not imported (spot-check):', sorted(d for d in declared if d not in src)[:20])
PY
```

## 报告格式

```markdown
## 安全审计报告 — <日期>

前置：纪律 0 输出（任何 MISSING 都必须出现在结论里）

| Phase | 结论 | 依据（命令 + 输出要点） |
|---|---|---|
| 1 密钥与配置 | PASS / RED / **RED (target missing)** | |
| 2 认证与会话 | | |
| 3 授权与租户 | | |
| 4 API 与输入 | | |
| 5 数据库与运维 | | |
| 6 依赖 | | |

CRITICAL: n | HIGH: n | MEDIUM: n | LOW: n
```

状态里必须区分"检查跑了没发现问题"与"检查没有可查对象"。后者永远是 RED。

## 与 OWASP Top 10 的对应（本仓真机制，不是通用清单）

| OWASP | 本仓机制 | 反例（旧版写法） |
| --- | --- | --- |
| A01 访问控制 | `requirePermission` preHandler（D115）+ data-scope 行过滤 + tenantId 贯穿 | "PermissionEngine + Record Rules + 字段级权限"（本仓无此三者） |
| A02 加密 | JWT **RS256**（`app.ts:196`）+ bcryptjs cost 12 + 信封密钥版本化 | "JWT HS256" |
| A03 注入 | Drizzle `sql\`` 参数化 + Fastify JSON Schema 校验 | "Zod 验证"（zod 源码零引用） |
| A04 不安全设计 | 会话绝对上限 + 空闲滑窗（`security.md` 头部）；rate-limit fail-soft 明示 | — |
| A05 安全配置 | `CORS_ORIGINS` 生产 fail-fast；`keys/` gitignore | "检查 `AUDE_*` 变量" |
| A06 脆弱组件 | `pnpm audit` + 死依赖扫描 | — |
| A07 认证失败 | 锁定（`LOCKOUT_*`）+ captcha + CIDR 准入；**注意撞库专属限速目前不存在** | "登录限速 5/min ✅" |
| A08 数据完整性 | schema 校验 + 迁移链唯一写入者（D117） | — |
| A09 日志监控 | 审计哈希链 + `/audit-logs/verify` + metrics（D119 暴露姿态） | — |
| A10 SSRF | `utils/webhook-url.ts` fail-closed（SSRF 面在出方向，不在"无服务端 HTTP 拉取"） | "无服务端 HTTP 拉取"（webhook dispatcher 就是） |

## 本技能自身的防腐

每次修改本文件后跑（任一行输出 MISSING = 本文件在教人查不存在的东西）：

```bash
grep -ohE 'apps/[a-z-]+/src|packages/[a-z-]+/src|\.env\.example|keys' .agents/skills/security-hardening/SKILL.md \
  | sort -u | while read p; do [ -e "$p" ] || echo "MISSING $p"; done
grep -n "packages/auth\|packages/core\|packages/admin-ui\|AUDE_\|audebase-\|HS256" .agents/skills/security-hardening/SKILL.md || echo "no stale identifiers"
```

第二行必须命中"反例"列（那里它们是刻意留档的错误说法），除非法则：出现新的、未在反例列出现过的旧平台标识 = 本文件又被复制粘贴污染了。
