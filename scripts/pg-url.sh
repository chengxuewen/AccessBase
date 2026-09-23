# Shared DATABASE_URL → PG* environment translator (batch P W2-3, report F10).
# Rationale: passing the conninfo as a psql/pg_dump ARGUMENT exposes the
# password in the process table (ps / /proc/<pid>/cmdline) for every call —
# backup.sh already documents this rule; migrate/restore now share the fix.
# Semantics lifted verbatim from the batch-M inline parsers (dedupe): split
# without exporting the raw URI, percent-decode the password (libpq env vars
# want the DECODED value), default port 5432, strip query strings from the db.
# Known edge (inherited): a URL without userinfo resolves host into the user
# fields — all repo producers always embed credentials, keep it that way.
#
# Usage:  source scripts/pg-url.sh
#         ab_pgurl_export "$DATABASE_URL"

ab_pgurl_export() {
    local url="$1"
    local _noscheme _userinfo _hostpart _rawpw _rest _decoded
    _noscheme="${url#*://}"
    _userinfo="${_noscheme%%@*}"
    _hostpart="${_noscheme#*@}"
    export PGUSER="${_userinfo%%:*}"
    _rawpw="${_userinfo#*:}"
    export PGHOST="${_hostpart%%[/:]*}"
    _rest="${_hostpart#"$PGHOST"}"
    export PGPORT="$(printf '%s' "$_rest" | sed -n 's|^[:]\([0-9]*\).*|\1|p')"
    [ -n "$PGPORT" ] || PGPORT=5432; export PGPORT
    export PGDATABASE="${_hostpart#*/}"
    export PGDATABASE="${PGDATABASE%%\?*}"
    if [ "$_rawpw" != "${_rawpw%%%*}" ]; then
        _decoded="$(node -e 'console.log(decodeURIComponent(process.argv[1]))' "$_rawpw")"
        export PGPASSWORD="$_decoded"
    else
        export PGPASSWORD="$_rawpw"
    fi
}
