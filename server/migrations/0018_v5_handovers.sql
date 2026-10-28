-- V5, customer signature at drop-off and pick-up. Additive and idempotent: one new table, three nullable columns on vehicles. No existing row is touched (cars that are already in repair on go-live day keep repair_entered_at NULL: nothing to sign on them).
CREATE TABLE IF NOT EXISTS "vehicle_handovers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text,
	"remarks" text DEFAULT '' NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_by" uuid,
	"station_id" uuid,
	"signature" jsonb NOT NULL,
	"send_receipt" boolean DEFAULT false NOT NULL,
	"receipt_pdf_key" text,
	"mail_status" text,
	"mail_error" text,
	"mailed_at" timestamp with time zone,
	"replaced_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "repair_entered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "drop_off_signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "pick_up_signed_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_signed_by_users_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_handovers" ADD CONSTRAINT "vehicle_handovers_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_handovers_vehicle_idx" ON "vehicle_handovers" USING btree ("vehicle_id","kind");