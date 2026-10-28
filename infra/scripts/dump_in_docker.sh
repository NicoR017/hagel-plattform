#!/bin/sh
# runs inside postgres:18: pg_dump (custom format, read only) of $TARGET_URL into /o/$1 and a table of contents check
pg_dump --format=custom --no-owner --no-acl --dbname "$TARGET_URL" --file "/o/$1" && pg_restore --list "/o/$1" | wc -l
