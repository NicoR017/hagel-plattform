-- V7 (Repair v2, F4): paint jobs (one per element to paint), partner body shops that paint, customer appointments for cars that must not be moved.
-- Additive and idempotent: a new table, new nullable / defaulted columns, new default grants.
ALTER TABLE "stations" ADD COLUMN IF NOT EXISTS "paint_partner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "paint_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "vehicle_id" uuid NOT NULL,
  "element_key" text NOT NULL,
  "status" text DEFAULT 'to_paint' NOT NULL,
  "source" text DEFAULT 'ptp' NOT NULL,
  "partner_station_id" uuid,
  "planned_date" date,
  "planned_time" text,
  "customer_appointment" boolean DEFAULT false NOT NULL,
  "customer_email" text,
  "customer_phone" text,
  "confirmation_sent_at" timestamp with time zone,
  "reminder_sent_at" timestamp with time zone,
  "driver_user_id" uuid,
  "done_at" timestamp with time zone,
  "done_by" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "paint_jobs" ADD CONSTRAINT "paint_jobs_vehicle_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "paint_jobs" ADD CONSTRAINT "paint_jobs_partner_fk" FOREIGN KEY ("partner_station_id") REFERENCES "stations"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "paint_jobs_vehicle_element_uq" ON "paint_jobs" ("vehicle_id", "element_key") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paint_jobs_vehicle_idx" ON "paint_jobs" ("vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paint_jobs_plan_idx" ON "paint_jobs" ("partner_station_id", "planned_date");--> statement-breakpoint
-- cars being repaired right now that have "push to paint" elements get their paint jobs (nothing else changes)
INSERT INTO "paint_jobs" ("org_id", "vehicle_id", "element_key", "status", "source")
SELECT v."org_id", v."id", e."key", 'to_paint', 'ptp'
FROM "vehicles" v CROSS JOIN LATERAL jsonb_each(v."panels") AS e("key", "value")
WHERE v."deleted_at" IS NULL AND v."statut" IN ('reparatur', 'attente') AND v."repair_stage" IS NOT NULL AND e."value" ->> 'method' = 'ptp'
ON CONFLICT ("vehicle_id", "element_key") WHERE "deleted_at" IS NULL DO NOTHING;--> statement-breakpoint
UPDATE "vehicles" SET "seq" = nextval('change_seq') WHERE "id" IN (SELECT DISTINCT "vehicle_id" FROM "paint_jobs");--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'peinture.gerer') WHERE "is_system" = true AND "key" IN ('org_admin', 'chef_site') AND NOT ('peinture.gerer' = ANY("permissions"));
