#!/usr/bin/env bash
# migrate.sh <chain-dir> — apply the committed drizzle SQL chain (batch L, spec D1;
# Q2a-C single-session rewrite). Sole runtime migration writer. Callers must NOT
# swallow its exit code.
#
# ONE psql session carries the whole run:
#   pg_advisory_lock -> ledger DDL -> (stamp branch) -> per-file
#   NOT EXISTS probe via \gset + \if BEGIN; \ir file; ledger INSERT; COMMIT; \endif.
# Why a session (batch P audit D3): concurrent replica boots previously raced
# per-file psql invocations and both applied the same file (loser died on
# duplicate-object mid-chain, wedging the restart loop). The advisory lock
# serializes; the in-session NOT EXISTS re-scan makes the loser a clean no-op.
# Per-file transactionality (old -1) is preserved via explicit BEGIN/COMMIT —
# drizzle-kit DDL is transaction-safe (spec R-3).
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
# \ir resolves RELATIVE to the generated session script (a /tmp mktemp), so the
# chain paths baked into it must be absolute (macOS-safe pwd -P, not realpath).
CHAIN_DIR="$(cd "$CHAIN_DIR" && pwd -P)"

# W2-3 (F10): translate DATABASE_URL into PG* env — the conninfo (password
# included) must never ride a psql argv where ps can read it. Unset URL keeps
# the bare-socket path (container trust, local all all trust).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=pg-url.sh
source "${SCRIPT_DIR}/pg-url.sh"
if [ -n "${DATABASE_URL:-}" ]; then
  ab_pgurl_export "$DATABASE_URL"
fi
PSQL=(psql)
sql() { "${PSQL[@]}" -v ON_ERROR_STOP=1 -tA -c "$1"; }

# Fixed namespace for the session lock (pg_advisory_lock is per-database).
readonly MIGRATE_ADVISORY_KEY=727241
# Bound the loser wait: beyond this, a stuck holder should surface as a loud
# failed boot (restart loop retries) rather than a hung entrypoint.
LOCK_TIMEOUT="${MIGRATE_LOCK_TIMEOUT:-120s}"

mapfile -t FILES < <(find "$CHAIN_DIR" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]_*.sql' | sort)
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "migrate: no NNNN_*.sql files in $CHAIN_DIR — refusing to run empty" >&2
  exit 1
fi

# ---- generate the single session script -------------------------------------
SESSION_SQL="$(mktemp)"
trap 'rm -f "$SESSION_SQL"' EXIT
{
  printf '%s\n' '\set ON_ERROR_STOP on'
  printf "SET lock_timeout = '%s';\n" "$LOCK_TIMEOUT"
  printf 'SELECT pg_advisory_lock(%d);\n' "$MIGRATE_ADVISORY_KEY"
  printf '%s\n' 'CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), note text);'

  # Baseline stamp (db:push-era volume): INSIDE the lock, atomic. Over-stamping
  # is recoverable: the chain has no DROP/TRUNCATE.
  printf '%s\n' "SELECT (SELECT count(*) FROM schema_migrations)=0 AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users') AS do_stamp \\gset"
  printf '%s\n' '\if :do_stamp'
  ids=()
  for f in "${FILES[@]}"; do ids+=("'$(basename "$f")'"); done
  printf 'INSERT INTO schema_migrations (id, note) SELECT f, %s FROM unnest(ARRAY[%s]) f ON CONFLICT DO NOTHING;\n' "'stamped'" "$(IFS=,; echo "${ids[*]}")"
  printf '%s\n' "SELECT 'STAMPED' AS migrate_marker;"
  printf '%s\n' '\endif'

  # Per-file: re-probe pending AFTER the lock (\\gset client-side), apply in its
  # own transaction with the ledger row, and mark stdout for the summary.
  i=0
  for f in "${FILES[@]}"; do
    base="$(basename "$f")"
    printf "SELECT NOT EXISTS (SELECT 1 FROM schema_migrations WHERE id = '%s') AS p%d \\gset\n" "$base" "$i"
    printf '%s\n' "\if :p$i"
    printf '%s\n' 'BEGIN;'
    printf '\\ir %s\n' "$f"          # absolute path: keeps failed-file names on stderr
    printf "INSERT INTO schema_migrations (id) VALUES ('%s');\n" "$base"
    printf '%s\n' 'COMMIT;'
    printf "SELECT 'APPLIED %s' AS migrate_marker;\n" "$base"
    printf '%s\n' '\endif'
    i=$((i + 1))
  done
  printf 'SELECT pg_advisory_unlock(%d);\n' "$MIGRATE_ADVISORY_KEY"
} > "$SESSION_SQL"

# ---- run ---------------------------------------------------------------------
# -tA: bare unaligned rows — the APPLIED/STAMPED marker grep below depends on it
if ! OUT="$("${PSQL[@]}" -q -X -tA -f "$SESSION_SQL" 2>&1)"; then
  # psql surfaces 'psql:/abs/NNNN_file.sql:LINE: ERROR: ...' — filename stays
  # visible to operators and to the ops-migrate stderr lock.
  echo "migrate: FAILED (session aborted; uncommitted files roll back atomically)" >&2
  printf '%s\n' "$OUT" >&2
  exit 1
fi

if printf '%s\n' "$OUT" | grep -qx 'STAMPED'; then
  echo "migrate: baseline stamped ${#FILES[@]} files into schema_migrations (note=stamped)"
  # Chain-head sentinels: /health/ready's SELECT 1 never surfaces a
  # behind-head legacy volume — probe one cheap schema fact per chain file
  # (DISCIPLINE: append an entry here whenever a migration is added; batch N
  # review B1 caught the staleness this list prevents). Loud lines,
  # warn-not-fail (K-T4 R3 precedent). Bash post-session probes are fine:
  # read-only and advisory-lock independent.
  SENTINELS=(
    "0004|SELECT phone FROM users LIMIT 1"
    "0005|SELECT 1 FROM oidc_adapter_state LIMIT 1"
  )
  for entry in "${SENTINELS[@]}"; do
    ver="${entry%%|*}"
    probe="${entry#*|}"
    if ! sql "$probe" >/dev/null 2>&1; then
      echo "migrate: ERROR: legacy DB behind chain head (${ver}) — run db:push to reconcile" >&2
    fi
  done
  exit 0
fi

applied="$(printf '%s\n' "$OUT" | grep -c '^APPLIED ' || true)"
echo "migrate: done — ${applied:-0} of ${#FILES[@]} files applied"
