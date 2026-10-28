#!/bin/sh
# runs inside postgres:18: execute the SQL file /q/query.sql (read-only use) against $TARGET_URL
psql "$TARGET_URL" -f /q/query.sql 2>&1 | head -600
