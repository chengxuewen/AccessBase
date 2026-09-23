#!/usr/bin/env bash
# AccessBase database restore (batch M D3).
#
# DESTROYS AND REPLACES the target database's schema+data (pg_restore --clean).
# The review-mandated guard stack (B1 — wrong-host wipes are the classic):
#   1. target identity is ECHOED before anything else (user@host:port/db);
#   2. if the server for that target looks up (port probe), refuse unless --force;
#   3. non-localhost target OR externally-set DATABASE_URL ⇒ operator must TYPE
#      the database name to proceed (or set ACCESSBASE_RESTORE_CONFIRM=yes —
#      SEPARATE from the reset guard's ACCESSBASE_RESET_CONFIRM, never shared).
# A failed restore can leave the schema half-applied: prefer rehearsing on a
# scratch DB first (documented in the output).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
source "${SCRIPT_DIR}/_common.sh"
ensure_pixi

FILE=""
FORCE=0
while [ $# -gt 0 ]; do
    case "$1" in
        --force) FORCE=1; shift ;;
        -*) log_error "restore: unknown flag '$1'"; exit 2 ;;
        *) FILE="$1"; shift ;;
    esac
done
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
    log_error "usage: accessbase.sh restore <dump-file> [--force]"; exit 2
fi

URL="${DATABASE_URL:-postgresql://accessbase:accessbase_dev@localhost:${PG_PORT:-5432}/accessbase}"
_exterior_url=0
[ -n "${DATABASE_URL:-}" ] && _exterior_url=1

# shellcheck source=pg-url.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "${SCRIPT_DIR}/pg-url.sh"
ab_pgurl_export "$URL"

echo "=================================================="
echo " RESTORE TARGET: ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}"
echo " SOURCE FILE   : ${FILE}"
echo " This DROPS and recreates ALL objects in that database."
echo "=================================================="

# --- guard 2: server-stopped check (5101 app port probe; --force bypasses) ---
_app_up=0
if (exec 3<>"/dev/tcp/127.0.0.1/${PORT:-5101}") 2>/dev/null; then exec 3>&- 3<&-; _app_up=1; fi
if [ "$_app_up" -eq 1 ] && [ "$FORCE" -ne 1 ]; then
    log_error "server on :${PORT:-5101} is UP — stopping it first is required (or --force). Restoring under a live app half-applies schema."
    exit 1
fi

# --- W3-4 (F15h): verify integrity BEFORE touching the target; mismatch aborts. ---
if [ -f "${FILE}.sha256" ]; then
    if ( cd "$(dirname "$FILE")" && sha256sum -c "$(basename "${FILE}.sha256")" >/dev/null ); then
        log_ok "dump checksum verified"
    else
        log_error "dump checksum MISMATCH — refusing to restore ${FILE}"
        exit 1
    fi
else
    log_warn "no ${FILE}.sha256 sidecar — integrity not verified (continuing)"
fi

# --- guard 3: risky target ⇒ typed db-name confirmation ---
if { [ "$PGHOST" != "localhost" ] && [ "$PGHOST" != "127.0.0.1" ]; } || [ "$_exterior_url" -eq 1 ]; then
    if [ "${ACCESSBASE_RESTORE_CONFIRM:-}" = "yes" ]; then
        log_warn "ACCESSBASE_RESTORE_CONFIRM=yes — skipping typed confirmation (non-interactive path)."
    elif [ -t 0 ]; then
        read -r -p "Type the target database name (${PGDATABASE}) to proceed: " answer
        if [ "$answer" != "$PGDATABASE" ]; then
            log_error "Confirmation mismatch — ABORTED with zero writes."
            exit 1
        fi
    else
        log_error "Non-interactive restore to a risky target requires ACCESSBASE_RESTORE_CONFIRM=yes"
        exit 1
    fi
fi

log_info "pg_restore --clean --if-exists --no-owner ..."
if ! pg_restore --clean --if-exists --no-owner -d "$PGDATABASE" "$FILE"; then
    log_error "restore FAILED mid-stream — the target schema may be HALF-APPLIED."
    log_error "Recover by restoring a known-good dump or re-running; consider rehearsing restores on a scratch DB."
    exit 1
fi

log_ok "Restored ${PGDATABASE} from ${FILE}"
