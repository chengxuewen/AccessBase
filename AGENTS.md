# PROJECT KNOWLEDGE BASE

**Generated:** 2026-08-21
**Status:** Phase 4 完成（基础实施完成，可交付）
**Stack:** TypeScript / Fastify / React / Ant Design / Drizzle ORM / PostgreSQL / Redis

## OVERVIEW

AccessBase is an enterprise access control foundation (IAM) providing authentication, authorization, and audit capabilities. Currently in Phase 5 — core implementation complete, three build modes operational, setup wizard + auth + user CRUD functional.

## STRUCTURE

```
.
├── docs/                    # Design documentation
│   ├── architecture.md      # Stub index → modules/
│   ├── modules/             # 31 modular design docs + 8 SDD docs (split from architecture.md)
├── .agents/                 # AI agent configuration
│   ├── skills/              # 20 project-specific skills (openspec, graphify, etc.)
│   ├── rules/               # Coding rules by language (15 dirs)
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
| Design decisions      | `.agents/memorys/decisions.md`  | D1-D106 with rationale                         |
| Project status        | `.agents/memorys/status.md`     | Current phase, blockers                        |
| Coding rules          | `.agents/rules/`                | Per-language rules                             |
| Skills                | `.agents/skills/`               | openspec, graphify, test-harness, etc.         |
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

- 106 design decisions documented in `.agents/memorys/decisions.md` (D1-D106)
- 19 pitfalls documented in `.agents/memorys/pitfalls.md` (PIT-001~019)
- Architecture doc split into 31 modules under `docs/modules/`
- Each module has back-link to `architecture.md` stub
- Reference implementation (new-api) in `.refinfo/` for studying patterns
- L0 packages fully implemented (8 packages)
- Three build modes: native (Pixi), container (Docker), compose (Docker Compose)
- Deploy mode: build to `out/`, single-port serve (API + UI)
- Auth endpoints: login/me/logout/refresh (wired to UserManager)
- User CRUD: 7 API endpoints + frontend UI + E2E tests
