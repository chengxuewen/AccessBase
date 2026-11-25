# PROJECT KNOWLEDGE BASE

**Generated:** 2026-08-21 · **Updated:** 2026-11-05
**Status:** Phase 9 + batches A-P complete; R1 11/11; R-audit LANDED (tamper chain + verify + sanctioned erasure, live-fire incl. D-ERASE-1 rev.4); auth.ts split + integration day (partial); session-lifetime LANDED; multi-node LANDED; logout-coherence LANDED (SAML SLO both directions, RP end_session, private_key_jwt); data-scope LANDED 2026-10-08 (DG-6d middle path: per-binding self/dept/all row scopes on the users surface); remaining ladder: branding+portal (sales-gated) + carryovers (real-IdP SAML live-fire, Q3D live-RP)
**Stack:** TypeScript / Fastify / React / Ant Design / Drizzle ORM / PostgreSQL / Redis

## OVERVIEW

AccessBase is an enterprise access control foundation (IAM) providing authentication, authorization, and audit capabilities. Currently past Phase 9 + gap-audit ladder Q0-Q4c landed + round-2 batch R1 safety net + multi-node batch (options coherence, envelope key versioning, dispatcher drain) + logout-coherence batch (SAML SLO both directions with signed-redirect enforcement, RP end_session, provider private_key_jwt) + data-scope batch (per-binding self/dept/all row scopes on the users surface, departments as kind-marked groups) + verification day (live RP↔IdP loop repairs: userinfo claims wiring, end_session autoconfirm, StrictMode exchange guard, re-encrypt tool) — full IAM surface: RBAC enforcement with tenant partition (26-code seed, requirePermission guards, data-scope row filtering), user groups (departments) + SCIM /ScimGroups, events outbox + webhooks + bilingual email templates + auth.login/logout telemetry, helpdesk self-service (forgot/reset/invite/force-change), enforced MFA + captcha + CIDR admission + optional require-verified-email gate (possession-proven channels auto-verify), registration domain policy (allow/block lists + alias gating), OIDC Provider (device flow, rotating JWKS, persisted state, private_key_jwt client auth) + generic RP (end_session), SAML SP (SSO+SLO), OIDC RP back-channel logout receiver (Q3D), magic link, SMS OTP, OAuth, LDAP, API keys, multi-tenant control plane, audit + metrics (webhook dispatcher counters/backlog gauges) + backup ops line; test baselines: see .agents/memorys/status.md (always re-measured there, never copied here — ADJ-7h).

## STRUCTURE

```
.
├── docs/                    # Design documentation
│   ├── architecture.md      # Stub index → modules/
│   ├── modules/             # 44 docs (36 modular + 8 SDD), each with an Implementation status header (mandatory, D126)
├── .agents/                 # AI agent configuration
│   ├── skills/              # Project-specific skills (the digest table below is the authoritative list; count dirs at run time)
│   ├── rules/               # Coding rules by language (count dirs at run time)
│   └── memorys/             # Project memory (status, decisions, pitfalls, conventions)
├── .refinfo/new-api/        # Reference implementation (new-api) — READ ONLY, not our code
├── scripts/                 # Utility scripts
└── .opencode/               # OpenCode configuration
```

## WHERE TO LOOK

| Task                  | Location                        | Notes                                          |
| --------------------- | ------------------------------- | ---------------------------------------------- |
| Architecture overview | `docs/modules/overview.md`      | §1-§7 概述/需求/定义/架构                      |
| Tech stack decisions  | `docs/modules/tech-stack.md`    | §9 Fastify+Drizzle+React+AntD                  |
| Core package design   | `docs/modules/core-packages.md` | §10 8 L0 packages                              |
| Security design       | `docs/modules/security.md`      | §19+§25+§29+§36 merged                         |
| UI design             | `docs/modules/ui.md`            | §14+§37 merged (2678 lines)                    |
| Database schema       | `docs/modules/database.md`      | §22 core tables                                |
| API spec              | `docs/modules/api.md`           | §23 RESTful conventions                        |
| Design decisions      | `.agents/memorys/decisions.md`  | D1-D124 with rationale                         |
| Project status        | `.agents/memorys/status.md`     | Current phase, blockers                        |
| Coding rules          | `.agents/rules/`                | Per-language rules                             |
| Skills                | `.agents/skills/`               | graphify, test-harness, design-system, etc.    |
| Reference impl        | `.refinfo/new-api/`             | Go/React reference (AGENTS.md has conventions) |

## CONVENTIONS

- **Monorepo**: pnpm workspace, `@accessbase/*` npm scope
- **Backend**: Fastify + Drizzle ORM + PostgreSQL 16 + Redis
- **Frontend**: React + Ant Design + Vite + Zustand
- **Auth**: JWT (RS256) + OAuth 2.0 + WebAuthn + LDAP
- **RBAC**: RBAC1 with role inheritance, tenant isolation
- **i18n**: i18next (frontend) + go-i18n patterns
- **Logging**: pino (structured, redacted)
- **Testing**: Vitest (unit) + Playwright (E2E), ≥80% coverage
- **E2E**: Mock API by default; real backend for setup/init tests; each test independent data
- **Migration**: Drizzle ORM, 3-phase (preload/postsync/postload)
- **Language**: English for EVERYTHING persisted (commits, comments, all docs incl. plans, memory, skills, rules); Chinese only in live AI-agent conversation, mirroring the user's input language (Chinese in → Chinese out) (2026-09-21 policy, conventions.md)

## ANTI-PATTERNS (THIS PROJECT)

- DO NOT implement code without explicit user request — this is a design-phase project
- DO NOT modify `.refinfo/` — it's reference material, read-only
- DO NOT use `as any`, `@ts-ignore`, `@ts-expect-error`
- DO NOT hardcode secrets — use environment variables
- DO NOT commit without running `tsc --noEmit`
- DO NOT skip E2E verification for frontend changes

## COMMANDS

```bash
# Development (native mode - Pixi managed PG/Redis)
bash accessbase.sh dev              # Full native dev (PG + Redis + server + frontend)
bash accessbase.sh dev:native       # Same as above (explicit)
bash accessbase.sh dev:container    # Docker all-in-one dev
bash accessbase.sh dev:compose      # Docker Compose dev

# Development (infra only)
bash accessbase.sh start:native     # Start native infra only (PG + Redis)
bash accessbase.sh stop:native      # Stop all native services
bash accessbase.sh reset:native     # Reset native data and reinitialize
bash accessbase.sh status:native    # Show native service status

# Deploy mode (single-port production)
bash accessbase.sh build:deploy     # Build all packages to out/ directory
bash accessbase.sh start:deploy     # Start deploy mode (PG + Redis + Server from out/)
bash accessbase.sh stop:deploy      # Stop all deploy services
bash accessbase.sh reset:deploy     # Reset deploy data (with confirmation)
bash accessbase.sh status:deploy    # Show deploy service status
bash accessbase.sh logs:deploy      # Show deploy service logs

# Container mode
bash accessbase.sh start:container  # Production single container
bash accessbase.sh stop:container   # Stop container services
bash accessbase.sh status:container # Show container status
bash accessbase.sh logs:container   # Show container logs

# Compose mode
bash accessbase.sh start:compose    # Start compose infrastructure
bash accessbase.sh start:prod       # Production start (Compose mode)
bash accessbase.sh stop:compose     # Stop compose services
bash accessbase.sh status:compose   # Show compose status
bash accessbase.sh logs:compose     # Show compose logs

# Shared commands
bash accessbase.sh build            # Build all packages
bash accessbase.sh test             # Run all tests
bash accessbase.sh test:e2e         # Run E2E tests
bash accessbase.sh typecheck        # Type check
bash accessbase.sh lint             # Lint
bash accessbase.sh format           # Format
bash accessbase.sh db:push          # Push database schema
bash accessbase.sh clean            # Clean build artifacts

# Pixi (alternative entry)
pixi install -e native              # Install native environment
pixi run dev                        # Same as bash accessbase.sh dev:native
```

## NOTES

- Design decisions documented in `.agents/memorys/decisions.md` (numbered D-series; two numbers intentionally skipped and never assigned — read the file's current max before taking a new one, `rule:lesson-memory`)
- Pitfalls documented in `.agents/memorys/pitfalls.md` (numbered PIT-series incl. addendum entries — counting command: `grep -c '^## PIT-' .agents/memorys/pitfalls.md`; do not restate the count here, ADJ-7h)
- Architecture doc split into 44 module files under `docs/modules/` — each carries an `Implementation status` line (gate: `grep -L 'Implementation status' docs/modules/*.md` -> empty)
- Each module has back-link to `architecture.md` stub
- Reference implementation (new-api) in `.refinfo/` for studying patterns
- L0 packages: 8 implemented — 4 wired into apps (types/logging/identity/audit), 4 standalone libraries without consumers (admin/migration/health/i18n) — gap-audit A6
- Three build modes: native (Pixi), container (Docker), compose (Docker Compose)
- Deploy mode: build to `out/`, single-port serve (API + UI)
- Auth endpoints: login/me/logout/refresh (wired to UserManager)
- User CRUD: 7 API endpoints + frontend UI + E2E tests
<!-- BEGIN:skills-directory -->
Skills single source: `.agents/skills/*/SKILL.md`; routing surface = each
frontmatter `description`. Maintained by `agents sync` — do not hand-edit this region.

| Skill | Purpose |
|---|---|
| `adjudication-walkthrough` | 裁决逐项过 -- one-at-a-time adjudication protocol… |
| `book-to-skill` | Converts books and documents (PDF, EPUB, DOC… |
| `code-review-and-quality` | Structured code review for this repo: determ… |
| `code-simplification` | Reduce complexity in TypeScript code. Cheste… |
| `design-system` | 为 AccessBase 企业应用平台生成一致的 UI。引导 AI 代理创建符合 Acc… |
| `doc-audit` | AccessBase 项目文档与架构审计。并行检查 AGENTS.md、记忆文件、决策记… |
| `ecosystem-scan` | INOPERATIVE — superseded by repo-audit (ruli… *(inoperative — do not route here)* |
| `expert-panel-review` | 多角色专家团审核一份计划/结论/决策：先独立后合并、隔离视角、必设对抗者、保留分歧、按复… |
| `graphify` | Use for any question about a codebase, its a… |
| `lesson-review` | 批量会话回顾：系统性提取经验教训，写入项目记忆。Use after long debug… |
| `mechanism-porting` | Execute the adoption of an EXTERNAL mechanis… |
| `repo-audit` | Whole-repo engineering audit across the mapp… |
| `reuse-first` | 借先于造：开工前证明没有现成的可用——四步证据链（面清点→NOTE 阅读→命令体验证→豁… |
| `security-hardening` | AccessBase 安全加固。OWASP Top 10 + JWT/RBAC + 数据… |
| `skill-creator` | Generate AccessBase project skills from SDD … |
| `skill-router` | 分析用户意图，输出推荐技能列表。当用户说'怎么做'、'用什么技能'、意图模糊时自动激活。… |
| `test-harness` | AccessBase TypeScript 全栈自动化测试工具架。从 SDD 文档生成 … |
| `think-before-act` | 元约束：先查再动手，列方案让用户审批，不蛮干。Use BEFORE any non-tr… |
| `ui-conformance` | 原型 vs 实现的设计符合度闭环：双截图采集（原型+实现）、像素级差距矩阵、CRITIC… |
| `ui-ux-review` | Structured interface-quality review for the … |
<!-- END:skills-directory -->
<!-- BEGIN:agents-memory -->
Navigable digest — one bullet per entry; full text in `.agents/memorys/*.md`,
read on demand. Maintained by `agents sync`; do not hand-edit this region.

### decisions
- full text: `.agents/memorys/decisions.md`
... 112 older entries omitted (read the full file)
- D115: 授权强制走 requirePermission preHandler（偏离 identity-sdd §3.3 plugin 路线） (2026-09-04)
- D116: Frontend state-stack review — keep Zustand + declarative react-router v7; TanStack Query deferred (2026-09-10)
- D117: Runtime migration sole writer = scripts/migrate.sh (bash+psql over committed drizzle SQL chain) (2026-09-20)
- D118: Tenant permission partition + binding funnel + platform belt (multi-tenant control plane) (2026-09-20)
- D119: Metrics exposure posture + backup/restore as secret-bearing ops (2026-09-21)
- D120: OIDC adapter state = single generic PG table, verbatim payload, parity-over-reasoning (2026-09-21)
- D121: English-only persistence policy (Chinese restricted to live conversation) (2026-09-21)
- D122: CI topology — Gitee origin + Gitee-side one-way mirror to GitHub for Actions (2026-09-23)
- D123: Retire the openspec skill family (superseded by the superpowers spec pipeline) (2026-09-23)
- D124: Batch O snapshot strategy — applied chain frozen, v7 rebuilt from the authoritative writer (2026-09-23)
- D125: Rotation replay classifier — 10s concurrent grace distinguishes double-fire from family burn (2026-09-23)
- D126: Gap-audit remediation ladder + documentation status-header gate (2026-09-23)
- D107: REGISTERED VOID — never assigned, number reserved (2026-11-17)
- D108: REGISTERED VOID — never assigned, number reserved (2026-11-17)
- D127: Introduce local-serena (pixi-kind MCP) — Batch-4 npm-only pruning reversed by ruling (2026-11-18)
- D128: 布尔控件规则统一——Switch=立即生效域 / Checkbox=提交标记+多选+attestation 域，真实与原型联动迁移 (2026-11-23)
- D129: 形状刻度 token 化——图标三语义档 / 浮层单一圆角 / 标签族圆角 token (2026-11-23)
- D130: 4A optimization roadmap — eight adjudications ratified one by one (2026-11-23)
- D131: 控件度量刻度定稿——图标按钮家族刻度 + 高度两档按语义归属 + 内联图标族 (2026-11-24)
- D132: 契约扩展 35–42 决策汇总——双入口同 builder / 服务端 job 建模 / 整页 state-mode / 强制改密交接 (2026-11-24)
- D133: 视觉语法对齐官方语义（裁决 43/44/45）——边框分级/圆角选中/两段式列表/density/文本链接 (2026-11-25)
- D134: 行操作形态回退图标并全页统一（裁决 46，用户偏好推翻 45）(2026-11-25)
- D135: 门禁升级——id-uniqueness 与跨页形态普查入 CI（PIT-118/121 预防）(2026-11-25)
- D136: local-playwright MCP 自带浏览器解析——三阶梯子 + 原子记录 + env 交接 (2026-11-25)
- D137: @types/node 双副本 + 双编译器——选择器 override + TS 统一 5.9.3 (2026-11-25)

### pitfalls
- full text: `.agents/memorys/pitfalls.md`
... 112 older entries omitted (read the full file)
- PIT-110: 控件高度靠 padding+font 推导 → 同 toolbar 混档参差不齐 (2026-11-24, user-reported)
- PIT-111: 高度刻度漏了 div 基控件（themed cbx）+ 锁采样隐藏 native select 成盲区 (2026-11-24, user-reported)
- PIT-112: 固定高按钮 + flex 可收缩 + 默认可换行 = 窄屏文字折行溢出 (2026-11-24, user-reported)
- PIT-113: 两档刻度的"档归属"按容器猜而非按控件语义 → 编辑控件被误归紧凑档 (2026-11-24, user-reported)
- PIT-114: 语义档归属执行不彻底——banner/card-head/row 动作钮仍挂 sm (2026-11-24, user-reported)
- PIT-115: 探针三 guard 缺失 → null throw 或隐藏块 0 值假象（复发 ≥4 次） (2026-11-24)
- PIT-116: fixed 浮层两陷阱——scrollIntoView 触发祖先 scroll 被外滚守卫误关 + backdrop-filter 祖先改变 fixed 包含块致错位 (2026-11-24, user-reported)
- PIT-117: 隐藏 chrome 后 grid 自动-placement 把 main 塞进首行 + 锁只测子 rect 不测可见窗 (2026-11-24, 自抓)
- PIT-118: 单文件 kit 扩展的标识符碰撞族——既有 id/const/helper 重名 + 改名漏掉被移动的代码块 (2026-11-24, 契约扩展批 ≥5 次)
- PIT-119: 探针值域靠猜 + 同组探针状态耦合 → 断言假失败/假通过 (2026-11-24, 契约扩展批 ≥3 次)
- PIT-120: 字符串外科手术的两类锚错误——切割点取到锚元素自身闭标签 / 属性剥离漏行首无空格形态 (2026-11-25, B2/B3 各一次)
- PIT-121: 形态类批量正则转换静默跳过变体 → 跨页混形（用户可见的不统一）(2026-11-25, user-reported)
- PIT-122: 共享 pre-commit gate 被并行在制品破坏——加性最小修复而非改 gate/提交外来正文 (2026-11-25, 事故)
- PIT-123: 译文双来源漂移——builder 内 zh 分支与既有 I18N 规则各产一套措辞 (2026-11-25, B2 一次)
- PIT-124: 真栈车道的"临时库"Helper 实为集群级重置——dev 库被清空 (2026-11-25, 一次，损失 dev 管理员账号)

### status
- full text: `.agents/memorys/status.md`
... 4 older entries omitted (read the full file)
- 模块状态
- 代码结构
- 设计决策汇总
- 测试覆盖
- 运行模式
- 近期工作
<!-- END:agents-memory -->
