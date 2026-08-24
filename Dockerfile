# ---- Base: Node.js 22 + pnpm ----
FROM node:22-slim AS base
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

# ---- Dev: full toolchain + source ----
FROM base AS dev
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl postgresql-client redis-tools \
    && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/types/package.json packages/types/
COPY packages/logging/package.json packages/logging/
COPY packages/i18n/package.json packages/i18n/
COPY packages/migration/package.json packages/migration/
COPY packages/health/package.json packages/health/
COPY packages/identity/package.json packages/identity/
COPY packages/audit/package.json packages/audit/
COPY packages/admin/package.json packages/admin/
COPY apps/server/package.json apps/server/
COPY apps/admin-ui/package.json apps/admin-ui/
RUN pnpm install --no-frozen-lockfile
COPY . .
CMD ["bash"]

# ---- Builder: build backend + frontend ----
FROM base AS builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/types/package.json packages/types/
COPY packages/logging/package.json packages/logging/
COPY packages/i18n/package.json packages/i18n/
COPY packages/migration/package.json packages/migration/
COPY packages/health/package.json packages/health/
COPY packages/identity/package.json packages/identity/
COPY packages/audit/package.json packages/audit/
COPY packages/admin/package.json packages/admin/
COPY apps/server/package.json apps/server/
COPY apps/admin-ui/package.json apps/admin-ui/
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm --filter @accessbase/types build && \
    pnpm --filter @accessbase/logging build && \
    pnpm --filter @accessbase/i18n build && \
    pnpm --filter @accessbase/health build && \
    pnpm --filter @accessbase/identity build && \
    pnpm --filter @accessbase/audit build && \
    pnpm --filter @accessbase/admin build && \
    pnpm --filter @accessbase/migration build && \
    pnpm --filter @accessbase/server build
RUN pnpm --filter @accessbase/admin-ui build

# ---- Runtime: all-in-one (PostgreSQL + Redis + Server + UI) ----
FROM debian:bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive

# Install PostgreSQL 16 + Redis + Node.js 22
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl gnupg2 lsb-release ca-certificates \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get update && apt-get install -y --no-install-recommends \
    postgresql-16 redis-server nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create accessbase user
RUN useradd -m -s /bin/bash accessbase

# PostgreSQL setup
ENV PGDATA=/var/lib/postgresql/data
ENV PGUSER=accessbase
ENV PGPASSWORD=accessbase
ENV PGDATABASE=accessbase
RUN mkdir -p /var/run/postgresql && chown -R accessbase:accessbase /var/run/postgresql
USER accessbase
RUN initdb -D $PGDATA --auth=trust --username=accessbase && \
    echo "listen_addresses='*'" >> $PGDATA/postgresql.conf && \
    echo "host all all 0.0.0.0/0 trust" >> $PGDATA/pg_hba.conf

# Redis setup
USER root
RUN mkdir -p /var/lib/redis && chown accessbase:accessbase /var/lib/redis
USER accessbase

# Copy built artifacts
COPY --from=builder --chown=accessbase:accessbase /app/packages/ /app/packages/
COPY --from=builder --chown=accessbase:accessbase /app/apps/server/ /app/apps/server/
COPY --from=builder --chown=accessbase:accessbase /app/apps/admin-ui/dist/ /app/apps/admin-ui/dist/
COPY --from=builder --chown=accessbase:accessbase /app/node_modules/ /app/node_modules/
COPY --from=builder --chown=accessbase:accessbase /app/package.json /app/pnpm-lock.yaml /app/

# Entrypoint script
COPY --chown=accessbase:accessbase docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5101 5173 5432 6379
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:5101/health/live || exit 1
ENTRYPOINT ["/entrypoint.sh"]
