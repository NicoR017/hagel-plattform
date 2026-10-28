#!/usr/bin/env bash
# Copy PRODUCTION data into the STAGING database (production is only READ by pg_dump, never written).
#
#   SOURCE_DATABASE_URL=<prod url, read only use> TARGET_DATABASE_URL=<staging url> \
#   CONFIRM_TARGET_IS_STAGING=yes infra/scripts/staging_refresh.sh
#
# Needs pg_dump / pg_restore / psql 18 on the PATH. Prints row counts of both sides at the end.
set -euo pipefail

: "${SOURCE_DATABASE_URL:?SOURCE_DATABASE_URL is required}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
[ "${CONFIRM_TARGET_IS_STAGING:-}" = "yes" ] || { echo "Refused: set CONFIRM_TARGET_IS_STAGING=yes after checking the target is the STAGING database"; exit 2; }

# host:port/dbname of a postgres URL (credentials ignored)
ident() { echo "$1" | sed -E 's#^[a-z]+://([^@/]*@)?##; s#\?.*$##' | tr 'A-Z' 'a-z'; }
SRC="$(ident "$SOURCE_DATABASE_URL")"; DST="$(ident "$TARGET_DATABASE_URL")"
[ "$SRC" != "$DST" ] || { echo "Refused: source and target are the same database ($SRC)"; exit 2; }
# a production URL given as target by mistake: refuse if PRODUCTION_DATABASE_URL is known and matches
if [ -n "${PRODUCTION_DATABASE_URL:-}" ] && [ "$(ident "$PRODUCTION_DATABASE_URL")" = "$DST" ]; then echo "Refused: the target is the production database"; exit 2; fi
# the target must announce itself as staging
STAGING_FLAG=$(psql "$TARGET_DATABASE_URL" -Atc "select coalesce(current_setting('hagel.env', true), '')" 2>/dev/null || true)
if [ "$STAGING_FLAG" != "staging" ] && [ "${FIRST_TIME:-}" != "yes" ]; then
  echo "The target database is not marked as staging yet. Check it is the STAGING database, then run once with FIRST_TIME=yes"
  echo "  (this marks it: ALTER DATABASE ... SET hagel.env = 'staging')"
  exit 2
fi

DUMP="$(mktemp -t hagel-staging-XXXX.dump)"; trap 'rm -f "$DUMP"' EXIT
echo "1/4 dumping source ($SRC), read only"
pg_dump --format=custom --no-owner --no-acl --dbname "$SOURCE_DATABASE_URL" --file "$DUMP"
echo "2/4 restoring into target ($DST)"
pg_restore --no-owner --no-acl --clean --if-exists --dbname "$TARGET_DATABASE_URL" "$DUMP"
echo "3/4 marking the target as staging"
DBNAME="$(psql "$TARGET_DATABASE_URL" -Atc 'select current_database()')"
psql "$TARGET_DATABASE_URL" -qc "ALTER DATABASE \"$DBNAME\" SET hagel.env = 'staging'"
if [ "${ANONYMISE_EMAILS:-}" = "yes" ]; then
  echo "   anonymising user e-mails (keeps the super-admin)"
  psql "$TARGET_DATABASE_URL" -qc "update users set email = 'user-' || substr(id::text,1,8) || '@staging.test' where is_superadmin = false"
fi
echo "4/4 row counts (source | target)"
for t in organizations users stations vehicles photos report_sends audit_log colibri_scans; do
  a=$(psql "$SOURCE_DATABASE_URL" -Atc "select count(*) from $t"); b=$(psql "$TARGET_DATABASE_URL" -Atc "select count(*) from $t")
  printf "  %-16s %8s | %8s\n" "$t" "$a" "$b"
done
echo "Done. Start staging, then 'npm run integrity' on both sides and compare."
