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
| `ui-ux-review` | Structured interface-quality review for the … |
<!-- END:skills-directory -->
<!-- BEGIN:agents-memory -->
Navigable digest — one bullet per entry; full text in `.agents/memorys/*.md`,
read on demand. Maintained by `agents sync`; do not hand-edit this region.

### decisions
- full text: `.agents/memorys/decisions.md`
... 105 older entries omitted (read the full file)
- D106: E2E 测试 Mock vs 真后端策略 (2026-08-27)
- D110: 安全基座架构（RS256 回退 + DB 权威会话 + 可注入审计存储） (2026-08-31)
- D111: FlowTokenService 单次用途 token 作为多步认证主干 (2026-08-31)
- D109: GitHub OAuth 豁免 PKCE（经典 OAuth App 限制） (2026-08-31)
- D112: 用户名无发现 WebAuthn Passkey 作为主登录因子 (2026-08-31)
- D113: Setup 状态以 DB 为准 + env 双变量旁路 (2026-09-01)
- D114: 已知 bug 用 E2E RED 回归网锁定（test.fail 标注法） (2026-09-03)
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

### pitfalls
- full text: `.agents/memorys/pitfalls.md`
... 93 older entries omitted (read the full file)
- PIT-092: The local e2e invocation has three environment traps, each eating a 60 s timeout before the real question is even asked (2026-11-05/06, T8)
- PIT-093: The measuring instrument lies more often than the measurement - three costumes seen in one wave (2026-11-06, panel-folded)
- PIT-094: A product fetch-surface change without its e2e mock-surface twin silently breaks specs nobody touched (2026-11-06, E10 wave)
- PIT-095: An imported layer's CLI entry called process.exit() at module scope and swallowed the entire dispatcher
- PIT-079: REGISTERED VOID — never assigned, number reserved (2026-11-17)
- PIT-096: A success log line as a function's last statement swallowed real gate failures
- PIT-097: A wrong verification predicate produces confident false findings — test the checker on BOTH samples before trusting its verdict
- PIT-098: 恒真锁三 costume——采样不触发缺陷的样本/白名单排除失败面/存在性检查冒充覆盖 (2026-11-23, panel-folded)
- PIT-099: playwright 失败后重启 worker → results.json 只含后半程组，"fail:0" 是假象 (2026-11-23)
- PIT-100: inert 加在 app 根上会连模态一起禁掉——overlays 在根内时必须只 inert 背景容器 (2026-11-23)
- PIT-101: forced-colors 下换色技巧不可靠——headless palette 让 Canvas==HighlightText，表单控件回退原生 (2026-11-23)
- PIT-102: 顶层 init 调用插到 const 定义前 = TDZ 静默中断整段经典脚本，node --check 全绿 (2026-11-23)
- PIT-103: 响应式断点只改布局不套状态语义 → 裁切 chrome；一个状态两个入口必须同语义 (2026-11-23, user-reported)
- PIT-104: python 批量 patch 两陷阱——选择器子串碰撞 + 工具回显 JSON 转义误导 old_str (2026-11-23, ≥3 轮失败)
- PIT-105: overflow-y:auto 把 overflow-x 计算成 auto + visibility:hidden 保留布局宽 = 隐藏间隔造出横滚条 (2026-11-23, user-reported)

### status
- full text: `.agents/memorys/status.md`
- 模块状态
- 代码结构
- 设计决策汇总
- 测试覆盖
- 运行模式
- 近期工作
<!-- END:agents-memory -->
