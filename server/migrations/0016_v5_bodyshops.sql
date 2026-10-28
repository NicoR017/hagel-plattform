-- V5, body shops are customers (not places). Additive and idempotent: two nullable columns and one permission appended to the default roles.
-- Nothing is deleted or renamed. Vehicles that stand in a body shop are NOT touched here: they are moved by
-- server/src/scripts/v5_move_bodyshop_vehicles.ts (dry run first, history + audit entry per vehicle).
ALTER TABLE "stations" ADD COLUMN IF NOT EXISTS "contact_name" text;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN IF NOT EXISTS "contact_phone" text;--> statement-breakpoint
-- new permission for the default roles "Organisation admin" and "Station manager" (editable afterwards like any other)
UPDATE "roles" SET "permissions" = array_append("permissions", 'bodyshops.gerer')
WHERE "is_system" = true AND "key" IN ('org_admin', 'chef_site') AND NOT ('bodyshops.gerer' = ANY("permissions"));
