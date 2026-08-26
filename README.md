# AccessBase

Enterprise access control foundation (IAM) providing authentication, authorization, and audit capabilities.

## Tech Stack

- **Backend**: TypeScript, Fastify, Drizzle ORM
- **Database**: PostgreSQL 16, Redis 7
- **Frontend**: React, Ant Design, Vite
- **Testing**: Vitest, Playwright
- **Package Manager**: pnpm (monorepo)

## Getting Started

### Prerequisites

- **Native mode:** [pixi](https://pixi.sh) installed
- **Container mode:** Docker installed
- **Compose mode:** Docker + Docker Compose installed

### Quick Start

**Native (recommended for development):**
```bash
pixi install -e native
pixi run dev
```

**Single Container:**
```bash
bash accessbase.sh dev:container
```

**Docker Compose:**
```bash
bash accessbase.sh dev:compose
```

### Development

```bash
# Type check
pnpm typecheck

# Lint
pnpm lint

# Format
pnpm format

# Run tests
pnpm test

# Run E2E tests
pnpm test:e2e
```

### Build Modes

```bash
# Native mode (Pixi)
bash accessbase.sh dev:native        # Full dev
bash accessbase.sh start:native      # Start infra only
bash accessbase.sh stop:native       # Stop all
bash accessbase.sh reset:native      # Reset data
bash accessbase.sh status:native     # Show status

# Container mode (Docker)
bash accessbase.sh dev:container     # Full dev
bash accessbase.sh start:container   # Production
bash accessbase.sh stop:container    # Stop
bash accessbase.sh status:container  # Status
bash accessbase.sh logs:container    # Logs

# Compose mode (Docker Compose)
bash accessbase.sh dev:compose       # Full dev
bash accessbase.sh start:compose     # Start infra
bash accessbase.sh start:prod        # Production
bash accessbase.sh stop:compose      # Stop
bash accessbase.sh status:compose    # Status
bash accessbase.sh logs:compose      # Logs

# Shared
bash accessbase.sh build             # Build all packages
bash accessbase.sh test              # Run tests
bash accessbase.sh typecheck         # Type check
bash accessbase.sh lint              # Lint
bash accessbase.sh format            # Format
bash accessbase.sh db:push           # Push schema
bash accessbase.sh clean             # Clean artifacts
```

## Project Structure

```
.
├── packages/              # L0 packages
│   ├── shared-types/      # Shared TypeScript types
│   ├── logging/           # Logging utilities
│   ├── i18n/              # Internationalization
│   ├── migration/         # Database migrations
│   ├── identity/          # Authentication & authorization
│   ├── audit/             # Audit logging
│   ├── health-check/      # Health check endpoints
│   └── admin/             # Admin UI framework
├── apps/
│   └── admin-ui/          # Admin web application
├── docs/                  # Design documentation
├── docker-compose.yml     # Development services
└── package.json           # Root package
```

## Documentation

- [Architecture Overview](docs/modules/overview.md)
- [Implementation Plan](docs/implementation-plan.md)
- [Design Decisions](docs/modules/)

## License

Proprietary
