#!/usr/bin/env bash
#
# Applies the migration to a throwaway Postgres and exercises the RLS policies.
#
#   supabase/tests/run.sh
#
# Runs against a local cluster, not your Supabase project — the fixtures create
# users and rows, so pointing this at a real database would pollute it.
#
# Needs postgresql 14+ on PATH. On macOS:
#   brew install postgresql@16
#   export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

set -euo pipefail

# Postgres refuses to start if a library made the postmaster multithreaded
# during startup, which macOS's locale resolution does. C sidesteps it.
export LC_ALL=C

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d)"
# The socket path has a 103-byte limit, so it cannot live under a long temp dir.
sock="$(mktemp -d /tmp/pgs.XXXX)"
port=55432

cleanup() {
  pg_ctl -D "$work/pgdata" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$work" "$sock"
}
trap cleanup EXIT

echo "→ initializing cluster"
initdb -D "$work/pgdata" -U postgres --auth=trust >/dev/null

echo "→ starting postgres on $sock"
pg_ctl -D "$work/pgdata" \
  -o "-k $sock -p $port -c listen_addresses=''" \
  -l "$work/pg.log" start >/dev/null

run() { psql -h "$sock" -p "$port" -U postgres -v ON_ERROR_STOP=1 "$@"; }

run -q -c "create database app_test;"
run -d app_test -q -c 'create extension if not exists "pgcrypto";'

echo "→ installing Supabase stubs"
run -d app_test -q -f "$root/supabase/tests/supabase-stub.sql"

apply_schema() {
  for part in "$root"/supabase/schema/*.sql; do
    run -d app_test -q -f "$part" >/dev/null
  done
}

echo "→ applying schema"
apply_schema

# Applied twice on purpose. The schema is meant to converge an existing
# database, not only build a new one, and a second pass is the cheapest way to
# keep that honest — anything not written idempotently fails here rather than in
# a production SQL editor.
echo "→ applying schema again (idempotence)"
apply_schema

echo "→ running policy tests"
output="$(run -d app_test -f "$root/supabase/tests/rls.sql" 2>&1)"
echo "$output" | grep -v '^SET$\|^RESET$\|^GRANT$\|^INSERT 0\|^UPDATE \|^DO$\|^DELETE \|Pager usage'

# Every assertion is either a row reading `t` or a PASS notice. An `f` means a
# policy let something through that it shouldn't have.
if echo "$output" | grep -qE '^ [a-z].*\| f$' || echo "$output" | grep -q 'FAIL:'; then
  echo
  echo "✗ at least one policy assertion failed"
  exit 1
fi

echo
echo "✓ all policy assertions passed"
