#!/usr/bin/env bash
# build.sh — Build all packages for deploy mode
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

OUT_DIR="${PROJECT_ROOT}/out"

log_info "Building AccessBase for deploy mode..."

# Clean
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Step 1: Build all L0 packages (dependency order)
log_info "Building packages..."
pnpm --filter @accessbase/types build
pnpm --filter @accessbase/logging build
pnpm --filter @accessbase/i18n build
pnpm --filter @accessbase/health build
pnpm --filter @accessbase/identity build
pnpm --filter @accessbase/audit build
pnpm --filter @accessbase/admin build
pnpm --filter @accessbase/migration build

# Step 2: Build server
log_info "Building server..."
pnpm --filter @accessbase/server build

# Step 3: Build admin-ui
log_info "Building admin-ui..."
pnpm --filter @accessbase/admin-ui build

# Step 4: Assemble out/ — copy only built artifacts
log_info "Assembling out/ directory..."
cp -r apps/server/dist "$OUT_DIR/server"
cp -r apps/server/package.json "$OUT_DIR/server/"
cp -r apps/admin-ui/dist "$OUT_DIR/admin-ui"

# Copy each package's dist + package.json (for runtime resolution)
for pkg in types logging i18n health identity audit admin migration; do
  mkdir -p "$OUT_DIR/packages/$pkg"
  cp -r "packages/$pkg/dist" "$OUT_DIR/packages/$pkg/"
  cp "packages/$pkg/package.json" "$OUT_DIR/packages/$pkg/"
done

# Copy root config files
cp package.json pnpm-lock.yaml pnpm-workspace.yaml "$OUT_DIR/"

# Symlink server's node_modules so ESM can resolve pnpm ghost deps (fastify, etc.)
ln -sf "${PROJECT_ROOT}/apps/server/node_modules" "$OUT_DIR/server/node_modules"
# Symlink packages' node_modules for migration etc.
ln -sf "${PROJECT_ROOT}/packages/migration/node_modules" "$OUT_DIR/packages/migration/node_modules"
log_ok "Build complete: $OUT_DIR"
log_info "  Server:  $OUT_DIR/server/index.js"
log_info "  UI:      $OUT_DIR/admin-ui/index.html"
