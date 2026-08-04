#!/usr/bin/env bash
# Applies the schema to a Postgres database and runs the RLS and cloudSync
# suites against it.
#
#   npm run test:cloud                                  # local cluster (see below)
#   PGURL=postgres://… npm run test:cloud               # any Postgres 16
#
# The database is left in place afterwards so you can poke at it; both suites
# clean up the rows they create.
#
# To make a throwaway local cluster (Postgres 16 must be installed):
#
#   initdb -D /tmp/ccpg -U postgres --auth=trust
#   pg_ctl -D /tmp/ccpg -o "-p 55432" -l /tmp/ccpg/log start
#   createdb -h 127.0.0.1 -p 55432 -U postgres cctest
#
# Against the real Supabase project, skip local-shim.sql — Supabase already
# provides the auth schema and the anon/authenticated/service_role roles.
set -euo pipefail

cd "$(dirname "$0")/.."

PGURL="${PGURL:-postgres://postgres@127.0.0.1:55432/cctest}"
export PGURL

echo "==> target: ${PGURL%%\?*}"

if [ "${SUPABASE:-0}" != "1" ]; then
  echo "==> local shim (auth schema + roles)"
  psql "$PGURL" -v ON_ERROR_STOP=1 -q -f supabase/local-shim.sql
fi

echo "==> schema (pass 1)"
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f supabase/schema.sql 2>&1 | grep -vi '^NOTICE' || true

echo "==> schema (pass 2 — must be idempotent)"
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f supabase/schema.sql 2>&1 | grep -vi '^NOTICE' || true

echo "==> RLS"
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/rls-test.sql 2>&1 | sed -n 's/^psql.*NOTICE:  /  /p;/PASSED/p'

echo "==> list ingest (iCloud Reminders)"
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/ingest-test.sql 2>&1 | sed -n 's/^psql.*NOTICE:  /  /p'

echo "==> deals ingest (Gmail)"
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/deals-ingest-test.sql 2>&1 | sed -n 's/^psql.*NOTICE:  /  /p'

echo "==> cloudSync"
npx tsx scripts/cloudsync-test.ts
