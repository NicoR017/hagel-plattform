CREATE TABLE IF NOT EXISTS "citas_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"appointment_id" text NOT NULL,
	"location_id" text NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "citas_location_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "citas_links" ADD CONSTRAINT "citas_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "citas_links" ADD CONSTRAINT "citas_links_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "citas_links" ADD CONSTRAINT "citas_links_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "citas_links" ADD CONSTRAINT "citas_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "citas_links_appt_uq" ON "citas_links" USING btree ("org_id","appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "citas_links_vehicle_idx" ON "citas_links" USING btree ("vehicle_id");