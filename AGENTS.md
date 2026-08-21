# PROJECT KNOWLEDGE BASE

**Generated:** 2026-08-21
**Status:** Design Phase (v3.0 — P0+P1+P2+P3 complete)
**Stack:** TypeScript / Fastify / React / Ant Design / Drizzle ORM / PostgreSQL / Redis

## OVERVIEW

AccessBase is an enterprise access control foundation (IAM) providing authentication, authorization, and audit capabilities. Currently in design phase — 42-chapter architecture doc complete, 80 design decisions documented, no implementation code yet.

## STRUCTURE

```
.
├── docs/                    # Design documentation
│   ├── architecture.md      # Stub index → modules/
│   └── modules/             # 31 modular design docs (split from architecture.md)
├── .agents/                 # AI agent configuration
│   ├── skills/              # 20 project-specific skills (openspec, graphify, etc.)
│   ├── rules/               # Coding rules by language (15 dirs)
│   └── memorys/             # Project memory (status, decisions, pitfalls, conventions)
├── .refinfo/new-api/        # Reference implementation (new-api) — READ ONLY, not our code
├── scripts/                 # Utility scripts
└── .opencode/               # OpenCode configuration
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Architecture overview | `docs/modules/overview.md` | §1-§7 概述/需求/定义/架构 |
| Tech stack decisions | `docs/modules/tech-stack.md` | §9 Fastify+Drizzle+React+AntD |
| Core package design | `docs/modules/core-packages.md` | §10 8 L0 packages |
| Security design | `docs/modules/security.md` | §19+§25+§29+§36 merged |
| UI design | `docs/modules/ui.md` | §14+§37 merged (2678 lines) |
| Database schema | `docs/modules/database.md` | §22 core tables |
| API spec | `docs/modules/api.md` | §23 RESTful conventions |
| Design decisions | `.agents/memorys/decisions.md` | D1-D80 with rationale |
| Project status | `.agents/memorys/status.md` | Current phase, blockers |
| Coding rules | `.agents/rules/` | Per-language rules |
| Skills | `.agents/skills/` | openspec, graphify, test-harness, etc. |
| Reference impl | `.refinfo/new-api/` | Go/React reference (AGENTS.md has conventions) |

## CONVENTIONS

- **Monorepo**: pnpm workspace, `@accessbase/*` npm scope
- **Backend**: Fastify + Drizzle ORM + PostgreSQL 16 + Redis
- **Frontend**: React + Ant Design + Vite + Zustand
- **Auth**: JWT (RS256) + OAuth 2.0 + WebAuthn + LDAP
- **RBAC**: RBAC1 with role inheritance, tenant isolation
- **i18n**: i18next (frontend) + go-i18n patterns
- **Logging**: pino (structured, redacted)
- **Testing**: Vitest (unit) + Playwright (E2E), ≥80% coverage
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
# Design docs
cat docs/modules/overview.md          # Read architecture overview

# When implementation starts (future):
pixi install                          # Install dependencies
pixi run npx tsc --noEmit             # Type check
pixi run npx vitest                   # Unit tests
pixi run npx playwright test          # E2E tests
```

## NOTES

- 80 design decisions documented in `.agents/memorys/decisions.md` (D1-D80)
- Architecture doc split into 31 modules under `docs/modules/`
- Each module has back-link to `architecture.md` stub
- Reference implementation (new-api) in `.refinfo/` for studying patterns
- L0 packages not yet implemented — design complete, awaiting implementation
