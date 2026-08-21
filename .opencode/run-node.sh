#!/usr/bin/env bash
set -euo pipefail

# Resolve pixi node bin dir relative to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
NODE_BIN="$SCRIPT_DIR/../.pixi/envs/default/bin"

if [ ! -x "$NODE_BIN/node" ]; then
  echo "ERROR: node not found at $NODE_BIN/node" >&2
  exit 1
fi

export PATH="$NODE_BIN:$PATH"
exec node "$@"
