-- V7 (Repair v2, F3a): life of a spare part on the car (delivered, installed with photos, returned) and who may do it.
-- Additive and idempotent: new nullable columns, new default grants.
ALTER TABLE "vehicle_parts" ADD COLUMN IF NOT EXISTS "expected_at" date;--> statement-breakpoint
ALTER TABLE "vehicle_parts" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicle_parts" ADD COLUMN IF NOT EXISTS "delivered_by" uuid;--> statement-breakpoint
ALTER TABLE "vehicle_parts" ADD COLUMN IF NOT EXISTS "installed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicle_parts" ADD COLUMN IF NOT EXISTS "installed_by" uuid;--> statement-breakpoint
ALTER TABLE "vehicle_parts" ADD COLUMN IF NOT EXISTS "photo_before_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicle_parts" ADD COLUMN IF NOT EXISTS "photo_after_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicle_parts" ADD COLUMN IF NOT EXISTS "return_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'pieces.reception') WHERE "is_system" = true AND "key" IN ('org_admin', 'chef_site') AND NOT ('pieces.reception' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'pieces.installer') WHERE "is_system" = true AND "key" IN ('org_admin', 'chef_site', 'technicien', 'freelance') AND NOT ('pieces.installer' = ANY("permissions"));
