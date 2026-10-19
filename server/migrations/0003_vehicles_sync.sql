CREATE TABLE IF NOT EXISTS "org_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"file_key" text,
	"size" integer,
	"label" text DEFAULT '' NOT NULL,
	"phase" text DEFAULT 'besichtigung' NOT NULL,
	"source" text DEFAULT 'app' NOT NULL,
	"colibri_position" text,
	"colibri_index" integer,
	"in_pdf" boolean DEFAULT true NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taken_by" uuid,
	"sort" integer DEFAULT 0 NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_ops" (
	"op_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"result" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"from_station_id" uuid,
	"to_station_id" uuid,
	"user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"statut" text NOT NULL,
	"motif" text,
	"user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "statut_motif" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "statut_depuis" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "statut_avant" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "rep_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "header" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "panels" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "panels_at" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "shares" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "group_at" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "colibri" jsonb;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "colibri_file" jsonb;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "photos" ADD CONSTRAINT "photos_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "photos" ADD CONSTRAINT "photos_taken_by_users_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sync_ops" ADD CONSTRAINT "sync_ops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_moves" ADD CONSTRAINT "vehicle_moves_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_moves" ADD CONSTRAINT "vehicle_moves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_status_history" ADD CONSTRAINT "vehicle_status_history_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_status_history" ADD CONSTRAINT "vehicle_status_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photos_vehicle_idx" ON "photos" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photos_seq_idx" ON "photos" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "veh_seq_idx" ON "vehicles" USING btree ("org_id","seq");