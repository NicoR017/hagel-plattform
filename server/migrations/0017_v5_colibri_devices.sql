-- V5, Colibri scanners belong to a station (devices + dated assignments). Additive and idempotent: two new tables and one permission appended to the default roles. No existing row is touched.
CREATE TABLE IF NOT EXISTS "colibri_device_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"valid_from" text NOT NULL,
	"valid_to" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "colibri_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tenant" text DEFAULT '' NOT NULL,
	"number" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "colibri_device_assignments" ADD CONSTRAINT "colibri_device_assignments_device_id_colibri_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."colibri_devices"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "colibri_device_assignments" ADD CONSTRAINT "colibri_device_assignments_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "colibri_device_assignments" ADD CONSTRAINT "colibri_device_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "colibri_devices" ADD CONSTRAINT "colibri_devices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "colibri_devices" ADD CONSTRAINT "colibri_devices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "colibri_assign_device_idx" ON "colibri_device_assignments" USING btree ("device_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "colibri_assign_one_open_idx" ON "colibri_device_assignments" USING btree ("device_id") WHERE valid_to is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "colibri_devices_key_uq" ON "colibri_devices" USING btree ("org_id","tenant","number");
--> statement-breakpoint
-- new permission for the default roles "Organisation admin" and "Station manager" (editable afterwards like any other). Idempotent.
UPDATE "roles" SET "permissions" = array_append("permissions", 'colibri.geraete')
WHERE "is_system" = true AND "key" IN ('org_admin', 'chef_site') AND NOT ('colibri.geraete' = ANY("permissions"));
