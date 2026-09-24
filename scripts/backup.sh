#!/usr/bin/env bash
# AccessBase database backup (batch M D3).
#
# Produces a pg_dump custom-format snapshot + sha256 sidecar under an operator
# directory (default data/backups). Retention keeps the newest N dumps.
#
# SECURITY (review B2): the dump contains users.passwordHash AND PLAINTEXT
# sessions.token / oauth tokens — treat every artifact as a secret:
# umask 077 ⇒ files land 0600, directory 0700. Never pass the connection URI
# as an argument (ps would leak the password) — libpq PG* env vars only.
#
# Modes: works for native/deploy PG (local or URL-overridden). Container-mode
#

# Scheduling (Q2b note, gap-audit D7): sample systemd timer for daily 03:00:
#   accessbase-backup.service : ExecStart=/usr/bin/env bash /opt/accessbase/scripts/backup.sh /var/backups/accessbase
#   accessbase-backup.timer   : OnCalendar=*-*-* 03:00:00  Persistent=true
# Offsite copy + quarterly restore-drill (restore.sh triple gate) stay ops policy.
# one-liner: docker exec <pg> pg_dump -U accessbase -Fc accessbase > backup.dump
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
source "${SCRIPT_DIR}/_common.sh"
ensure_pixi

OUT="${PROJECT_ROOT}/data/backups"
KEEP=7
while [ $# -gt 0 ]; do
    case "$1" in
        --dir) OUT="$2"; shift 2 ;;
        --keep) KEEP="$2"; shift 2 ;;
        *) log_error "backup: unknown argument '$1'"; exit 2 ;;
    esac
done

umask 077
# W3-4 (F15g): symlink refusal must precede any effect on the target path.
if [ -L "$OUT" ]; then log_error "backup: refusing symlinked output dir $OUT"; exit 1; fi
mkdir -p "$OUT"
chmod 700 "$OUT"

# --- target from DATABASE_URL (override wins) else native/deploy defaults ---
URL="${DATABASE_URL:-postgresql://accessbase:accessbase_dev@localhost:${PG_PORT:-5432}/accessbase}"
log_info "Target: ${URL%%@*}@<redacted>"

# shellcheck source=pg-url.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "${SCRIPT_DIR}/pg-url.sh"
# Split without ever exporting the raw URI (shared parser, W2-3 dedupe).
ab_pgurl_export "$URL"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${OUT%/}/accessbase-${STAMP}.dump"
log_info "Dumping to ${FILE} ..."
pg_dump -Fc -f "$FILE"
chmod 600 "$FILE"

( cd "$OUT" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256" )
chmod 600 "${FILE}.sha256"
SIZE="$(du -h "$FILE" | cut -f1)"
HASH="$(cut -d' ' -f1 "${FILE}.sha256")"
log_ok "Backup written: ${FILE} (${SIZE})"
log_info "sha256: ${HASH}"
log_warn "This file contains password hashes AND plaintext session tokens — store it as a secret."

# --- retention: own-prefix regular files only, newest KEEP kept ---
# W3-4 (F15e): NUL-delimited newest-first list — filenames with spaces survive.
mapfile -d '' -t all < <(find "$OUT" -maxdepth 1 -type f -name 'accessbase-*.dump' -printf '%T@\t%p\0' | sort -z -t $'\t' -k1,1nr | cut -z -f2-)
if [ "${#all[@]}" -gt "$KEEP" ]; then
    for victim in "${all[@]:$KEEP}"; do
        rm -f -- "$victim" "${victim}.sha256"
        log_info "Retention removed: $victim"
    done
fi
log_ok "Done ($(find "$OUT" -maxdepth 1 -type f -name 'accessbase-*.dump' | wc -l) dump(s) retained, keep=${KEEP})"
