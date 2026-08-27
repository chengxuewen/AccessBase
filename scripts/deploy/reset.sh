#!/usr/bin/env bash
# reset.sh — Stop services, delete data, reinitialize
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
source "${SCRIPT_DIR}/../_common.sh"

DATA_DIR="${PROJECT_ROOT}/data"

log_warn "This will DELETE all data in ${DATA_DIR}/"
read -p "Are you sure? (y/N): " confirm
if [ "${confirm}" != "y" ] && [ "${confirm}" != "Y" ]; then
  log_info "Cancelled"
  exit 0
fi

# Stop services first
bash "${SCRIPT_DIR}/stop.sh"

# Delete data
rm -rf "$DATA_DIR/pg" "$DATA_DIR/redis" "$DATA_DIR/.pids"

log_ok "Data deleted. Run 'bash accessbase.sh start:deploy' to reinitialize."
