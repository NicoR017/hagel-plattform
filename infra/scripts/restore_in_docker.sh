#!/bin/sh
# runs inside the postgres:18 image against the STAGING database only: empty it, restore /d/<dump>, print row counts
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -qc "DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;" || exit 1
pg_restore --no-owner --no-acl -d "$TARGET_URL" "/d/$1" 2>&1 | tail -15
echo "pg_restore finished"
for t in organizations users stations vehicles photos audit_log colibri_scans; do printf "%-16s " $t; psql "$TARGET_URL" -Atc "select count(*) from $t" 2>&1 | tail -1; done
