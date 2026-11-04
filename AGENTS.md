# PROJECT KNOWLEDGE BASE

**Generated:** 2026-08-21 · **Updated:** 2026-10-08
**Status:** Phase 9 + batches A-P complete; R1 11/11; R-audit LANDED (tamper chain + verify + sanctioned erasure, live-fire incl. D-ERASE-1 rev.4); auth.ts split + integration day (partial); session-lifetime LANDED; multi-node LANDED; logout-coherence LANDED (SAML SLO both directions, RP end_session, private_key_jwt); data-scope LANDED 2026-10-08 (DG-6d middle path: per-binding self/dept/all row scopes on the users surface); remaining ladder: branding+portal (sales-gated) + carryovers (real-IdP SAML live-fire, Q3D live-RP, re-encrypt tool)
**Stack:** TypeScript / Fastify / React / Ant Design / Drizzle ORM / PostgreSQL / Redis

## OVERVIEW

AccessBase is an enterprise access control foundation (IAM) providing authentication, authorization, and audit capabilities. Currently past Phase 9 + gap-audit ladder Q0-Q4c landed + round-2 batch R1 safety net + multi-node batch (options coherence, envelope key versioning, dispatcher drain) + logout-coherence batch (SAML SLO both directions with signed-redirect enforcement, RP end_session, provider private_key_jwt) + data-scope batch (per-binding self/dept/all row scopes on the users surface, departments as kind-marked groups) + verification day (live RP↔IdP loop repairs: userinfo claims wiring, end_session autoconfirm, StrictMode exchange guard, re-encrypt tool) — full IAM surface: RBAC enforcement with tenant partition (26-code seed, requirePermission guards, data-scope row filtering), user groups (departments) + SCIM /ScimGroups, events outbox + webhooks + bilingual email templates + auth.login/logout telemetry, helpdesk self-service (forgot/reset/invite/force-change), enforced MFA + captcha + CIDR admission + optional require-verified-email gate (possession-proven channels auto-verify), registration domain policy (allow/block lists + alias gating), OIDC Provider (device flow, rotating JWKS, persisted state, private_key_jwt client auth) + generic RP (end_session), SAML SP (SSO+SLO), OIDC RP back-channel logout receiver (Q3D), magic link, SMS OTP, OAuth, LDAP, API keys, multi-tenant control plane, audit + metrics (webhook dispatcher counters/backlog gauges) + backup ops line; vitest 1556 + e2e chromium 184 (+3 conditional skip) all green.

## STRUCTURE

```
.
├── docs/                    # Design documentation
│   ├── architecture.md      # Stub index → modules/
│   ├── modules/             # 44 docs (36 modular + 8 SDD), each with an Implementation status header (mandatory, D126)
├── .agents/                 # AI agent configuration
│   ├── skills/              # 13 project-specific skills (graphify, test-harness, adjudication-walkthrough, etc.)
│   ├── rules/               # Coding rules by language (14 language dirs)
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
| Skills                | `.agents/skills/`               | graphify, test-harness, design-system, etc.         |         |
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

- 124 design decisions documented in `.agents/memorys/decisions.md` (numbering runs D1–D126; two numbers were intentionally skipped and never assigned)
- 90 pitfalls documented in `.agents/memorys/pitfalls.md` (PIT-001~088; heading count includes addendum entries)
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
| `ecosystem-scan` | 审计 .agents/ 体系并扫描社区生态寻找可引入的技能/规则/MCP。双层（Quic… |
| `expert-panel-review` | 多角色专家团审核一份计划/结论/决策：先独立后合并、隔离视角、必设对抗者、保留分歧、按复… |
| `graphify` | Use for any question about a codebase, its a… |
| `lesson-review` | 批量会话回顾：系统性提取经验教训，写入项目记忆。Use after long debug… |
| `security-hardening` | AccessBase 安全加固。OWASP Top 10 + JWT/RBAC + 数据… |
| `skill-creator` | Generate AccessBase project skills from SDD … |
| `skill-router` | 分析用户意图，输出推荐技能列表。当用户说'怎么做'、'用什么技能'、意图模糊时自动激活。… |
| `test-harness` | AccessBase TypeScript 全栈自动化测试工具架。从 SDD 文档生成 … |
| `think-before-act` | 元约束：先查再动手，列方案让用户审批，不蛮干。Use BEFORE any non-tr… |
<!-- END:skills-directory -->
<!-- BEGIN:agents-memory -->
Navigable digest — one bullet per entry; full text in `.agents/memorys/*.md`,
read on demand. Maintained by `agents sync`; do not hand-edit this region.

### decisions
- full text: `.agents/memorys/decisions.md`
... 99 older entries omitted (read the full file)
- D100: CLI 脚本架构 (2026-08-21)
- D101: 四种构建模式架构 (2026-08-27)
- D102: Deploy 模式单端口服务 (2026-08-27)
- D103: Admin 自动创建策略 (2026-08-27)
- D104: E2E 测试不覆盖跨 session 状态 (2026-08-27)
- D105: 用户 CRUD API 类型约束 (2026-08-27)
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

### pitfalls
- full text: `.agents/memorys/pitfalls.md`
... 77 older entries omitted (read the full file)
- PIT-078: env-pinned config 单例 × vitest import 提升——顶层赋值晚于求值；resetModules 多次 buildApp 触发 prom-client 双注册 (2026-09-23)
- PIT-076 addendum (2026-09-23, batch P): 审计报告与 PoC 交付物同属 claims——派修复前逐行 grep
- PIT-080: 给 /login 页壳新增公开探针端点后未同步 e2e mock，17 个 spec 连锁红（2026-09-23）
- PIT-081: 值记忆化的异步构造函数在并发首波下退化为每请求实例（2026-09-23）
- PIT-082: vi.mock 代理对未声明导出「访问即抛」，typeof 守卫救不了（2026-09-23）
- PIT-080 追加（2026-09-23 Q3E）：/login 壳探针名册适用于【任何】新壳级 fetch，captcha/status 复发一次
- PIT-083: 连续重跑打爆共享 Redis rate 桶 → 跨文件 429 假回归 (2026-09-24, Q4b)
- PIT-082 addendum (2026-10-08 verification day): same family re-fire via buildApp destructure
- PIT-084: node-saml SLO/ACS integration triple trap (2026-10-08, logout-coherence)
- PIT-085: oidc-provider RP walls — human-confirm logoutSource + built-in SSRF dispatcher (2026-10-08, verification day)
- PIT-086: StrictMode double-fire burns one-time exchange codes; mocks structurally hide it (2026-10-08, verification day)
- PIT-087: bash-tool timeout reaps detached children; ctx_execute background sandbox survives (2026-10-08, verification day)
- PIT-088: emitEvent on a TX handle poisons the COMMIT — telemetry rides its own pool (2026-10-12, Q3D integration)
- PIT-089: "Creating" a file that is git-tracked-but-deleted silently overwrites repo history
- PIT-090: A host consuming the generated MCP declaration can fire self-healing installs that drift the dependency tree

### status
- full text: `.agents/memorys/status.md`
- 模块状态
- 代码结构
- 设计决策汇总
- 测试覆盖
- 运行模式
- 近期工作
<!-- END:agents-memory -->
