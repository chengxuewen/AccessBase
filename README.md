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

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Docker & Docker Compose

### Installation

```bash
# Install dependencies
pnpm install

# Start development services
docker compose up -d

# Run database migrations
pnpm db:push

# Start development
pnpm dev
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
