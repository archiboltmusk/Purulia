#!/usr/bin/env bash
# Runs the migration against a fresh legacy-shaped DB and a fresh empty DB,
# twice each (idempotency), then the scenario tests.
#   PGHOST=/path/to/socket PGPORT=55432 supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
P="psql -U postgres -v ON_ERROR_STOP=1 -q"
for db in kasa_legacy kasa_fresh; do
  $P -c "drop database if exists $db" -c "create database $db" >/dev/null
  $P -d $db -f tests/supabase_stub.sql >/dev/null
  if [ $db = kasa_legacy ]; then $P -d $db -f tests/legacy_schema.sql >/dev/null; fi
  for pass in 1 2; do
    for m in migrations/*.sql; do $P -d $db -f "$m" >/dev/null 2>&1; done
  done
  if [ $db = kasa_fresh ]; then
    # Fresh projects have no legacy rows; seed one so the suite's first lookup works.
    $P -d $db -c "insert into public.reports (lat, lng, status) values (23.3321, 86.3655, 'resolved')" \
              -c "update public.reports set resolution_method = 'legacy_unverified'" >/dev/null
  fi
  echo "== $db"
  python3 tests/test_migration.py "host=${PGHOST} port=${PGPORT} dbname=$db user=postgres"
done
