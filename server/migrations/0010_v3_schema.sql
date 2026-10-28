CREATE TABLE IF NOT EXISTS "calc_method_versions" (
	"method_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"params" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calc_method_versions_method_id_version_pk" PRIMARY KEY("method_id","version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calc_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"engine" text NOT NULL,
	"country" text NOT NULL,
	"base_method_id" uuid,
	"is_system" boolean DEFAULT false NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insurer_methods" (
	"insurer_id" uuid NOT NULL,
	"country" text NOT NULL,
	"method_id" uuid NOT NULL,
	CONSTRAINT "insurer_methods_insurer_id_country_pk" PRIMARY KEY("insurer_id","country")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repair_appointments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"technician_id" uuid NOT NULL,
	"date" text NOT NULL,
	"duration_min" integer DEFAULT 60 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repair_bookings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"date" text NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"time" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_email" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"started_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repair_checks" (
	"vehicle_id" uuid NOT NULL,
	"key" text NOT NULL,
	"done_by" uuid,
	"done_at" timestamp with time zone,
	CONSTRAINT "repair_checks_vehicle_id_key_pk" PRIMARY KEY("vehicle_id","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repair_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repair_todos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"text" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_by" uuid,
	"done_at" timestamp with time zone,
	"sort" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"text" text NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "repair_stage" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "repairs_per_day" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "excluded_insurer_emails" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "technicians" ADD COLUMN "kind" text DEFAULT 'pdr' NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "repair_stage" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "method_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "method_version" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calc_method_versions" ADD CONSTRAINT "calc_method_versions_method_id_calc_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."calc_methods"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calc_method_versions" ADD CONSTRAINT "calc_method_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calc_methods" ADD CONSTRAINT "calc_methods_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calc_methods" ADD CONSTRAINT "calc_methods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insurer_methods" ADD CONSTRAINT "insurer_methods_insurer_id_insurers_id_fk" FOREIGN KEY ("insurer_id") REFERENCES "public"."insurers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insurer_methods" ADD CONSTRAINT "insurer_methods_method_id_calc_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."calc_methods"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_appointments" ADD CONSTRAINT "repair_appointments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_appointments" ADD CONSTRAINT "repair_appointments_technician_id_technicians_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."technicians"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_appointments" ADD CONSTRAINT "repair_appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_bookings" ADD CONSTRAINT "repair_bookings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_bookings" ADD CONSTRAINT "repair_bookings_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_bookings" ADD CONSTRAINT "repair_bookings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_bookings" ADD CONSTRAINT "repair_bookings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_bookings" ADD CONSTRAINT "repair_bookings_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_checks" ADD CONSTRAINT "repair_checks_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_checks" ADD CONSTRAINT "repair_checks_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_events" ADD CONSTRAINT "repair_events_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_events" ADD CONSTRAINT "repair_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_todos" ADD CONSTRAINT "repair_todos_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_todos" ADD CONSTRAINT "repair_todos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_todos" ADD CONSTRAINT "repair_todos_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_comments" ADD CONSTRAINT "vehicle_comments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_comments" ADD CONSTRAINT "vehicle_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calc_methods_org_idx" ON "calc_methods" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_appointments_vehicle_idx" ON "repair_appointments" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_bookings_day_idx" ON "repair_bookings" USING btree ("station_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repair_bookings_one_booked_idx" ON "repair_bookings" USING btree ("vehicle_id") WHERE status = 'booked';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_events_vehicle_idx" ON "repair_events" USING btree ("vehicle_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_todos_vehicle_idx" ON "repair_todos" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_comments_vehicle_idx" ON "vehicle_comments" USING btree ("vehicle_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_method_id_calc_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."calc_methods"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
