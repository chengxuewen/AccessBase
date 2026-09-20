#!/usr/bin/env bash
# migrate.sh <chain-dir> — apply the committed drizzle SQL chain (batch L, spec D1).
# Sole runtime migration writer. Callers must NOT swallow its exit code.
# Per-file -1 transaction: drizzle-kit generated DDL is transaction-safe
# (spec R-3); if a future file breaks that, drop -1 for that file only.
set -euo pipefail

CHAIN_DIR="${1:-}"
if [ -z "$CHAIN_DIR" ]; then
  echo "migrate: usage: migrate.sh <chain-dir>" >&2
  exit 1
fi
if [ ! -d "$CHAIN_DIR" ]; then
  echo "migrate: chain dir not found: $CHAIN_DIR" >&2
  exit 1
fi

# DATABASE_URL wins; otherwise bare psql over PG* socket env (container trust).
if [ -n "${DATABASE_URL:-}" ]; then
  PSQL=(psql "$DATABASE_URL")
else
  PSQL=(psql)
fi
sql() { "${PSQL[@]}" -v ON_ERROR_STOP=1 -tA -c "$1"; }

mapfile -t FILES < <(find "$CHAIN_DIR" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]_*.sql' | sort)
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "migrate: no NNNN_*.sql files in $CHAIN_DIR — refusing to run empty" >&2
  exit 1
fi

sql "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), note text)" >/dev/null

# Baseline stamp: pre-tracking DB (db:push era) — record the chain as applied
# without executing it. Over-stamping is recoverable: the chain has no DROP/TRUNCATE.
if [ "$(sql 'SELECT count(*) FROM schema_migrations')" = "0" ] \
   && [ "$(sql "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users' LIMIT 1")" = "1" ]; then
  for f in "${FILES[@]}"; do
    sql "INSERT INTO schema_migrations (id, note) VALUES ('$(basename "$f")', 'stamped')" >/dev/null
  done
  echo "migrate: baseline stamped ${#FILES[@]} files into schema_migrations (note=stamped)"
  # Chain-head sentinel: /health/ready's SELECT 1 never surfaces a behind-head
  # legacy volume. Loud error line, warn-not-fail (K-T4 R3 precedent).
  if ! sql "SELECT phone FROM users LIMIT 1" >/dev/null 2>&1; then
    echo "migrate: ERROR: legacy DB behind chain head (0004) — run db:push to reconcile" >&2
  fi
  exit 0
fi

applied=0
for f in "${FILES[@]}"; do
  id="$(basename "$f")"
  [ "$(sql "SELECT 1 FROM schema_migrations WHERE id = '$id'")" = "1" ] && continue
  if ! "${PSQL[@]}" -v ON_ERROR_STOP=1 -1 -q -f "$f"; then
    echo "migrate: FAILED applying $id" >&2
    exit 1
  fi
  sql "INSERT INTO schema_migrations (id) VALUES ('$id')" >/dev/null
  applied=$((applied + 1))
done
echo "migrate: done — $applied of ${#FILES[@]} files applied"
