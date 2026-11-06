-- V7 (Repair v2, F3b): parts orders to the body shop (a non-fiscal REQUEST, never an invoice), settings per body shop, insurer approval, order numbers.
-- Additive and idempotent: new tables, new nullable columns, new default grants. Nothing sent is ever deleted: an order is cancelled with an "Anulación".
CREATE TABLE IF NOT EXISTS "org_counters" (
  "org_id" uuid NOT NULL,
  "key" text NOT NULL,
  "year" integer NOT NULL,
  "n" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "org_counters_pk" PRIMARY KEY ("org_id", "key", "year")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "body_shop_order_settings" (
  "station_id" uuid PRIMARY KEY NOT NULL,
  "org_id" uuid NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "mode" text DEFAULT 'manual' NOT NULL,
  "to_emails" text[] DEFAULT '{}'::text[] NOT NULL,
  "cc_emails" text[] DEFAULT '{}'::text[] NOT NULL,
  "reply_to" text,
  "lang" text DEFAULT 'es' NOT NULL,
  "show_prices" boolean DEFAULT false NOT NULL,
  "delivery_days" integer DEFAULT 3 NOT NULL,
  "reminder_days" integer DEFAULT 0 NOT NULL,
  "subject_template" text DEFAULT '' NOT NULL,
  "body_template" text DEFAULT '' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "part_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "number" text NOT NULL,
  "vehicle_id" uuid NOT NULL,
  "body_shop_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "parent_order_id" uuid,
  "reason" text,
  "status" text DEFAULT 'draft' NOT NULL,
  "requested_delivery_date" date,
  "announced_delivery_date" date,
  "confirmed_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "recipients" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "lang" text DEFAULT 'es' NOT NULL,
  "observations" text DEFAULT '' NOT NULL,
  "pdf_key" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "last_error" text,
  "reminder_sent_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "part_order_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "vehicle_part_id" uuid NOT NULL,
  "n" integer DEFAULT 1 NOT NULL,
  "zone" text DEFAULT '' NOT NULL,
  "designation" text NOT NULL,
  "oem_ref" text DEFAULT '' NOT NULL,
  "qty" integer DEFAULT 1 NOT NULL,
  "observations" text DEFAULT '' NOT NULL
);--> statement-breakpoint
ALTER TABLE "vehicle_parts" ADD COLUMN IF NOT EXISTS "order_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "insurer_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "insurer_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "insurer_approval_note" text;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "body_shop_order_settings" ADD CONSTRAINT "bsos_station_fk" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "part_orders" ADD CONSTRAINT "part_orders_vehicle_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "part_orders" ADD CONSTRAINT "part_orders_body_shop_fk" FOREIGN KEY ("body_shop_id") REFERENCES "stations"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "part_order_lines" ADD CONSTRAINT "part_order_lines_order_fk" FOREIGN KEY ("order_id") REFERENCES "part_orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "part_order_lines" ADD CONSTRAINT "part_order_lines_part_fk" FOREIGN KEY ("vehicle_part_id") REFERENCES "vehicle_parts"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "part_orders_number_uq" ON "part_orders" ("org_id", "number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_orders_vehicle_idx" ON "part_orders" ("vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_orders_status_idx" ON "part_orders" ("org_id", "status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_order_lines_order_idx" ON "part_order_lines" ("order_id");--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'pieces.commander') WHERE "is_system" = true AND "key" IN ('org_admin', 'chef_site') AND NOT ('pieces.commander' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'pieces.prix.voir') WHERE "is_system" = true AND "key" IN ('org_admin', 'chef_site') AND NOT ('pieces.prix.voir' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'facturation.gerer') WHERE "is_system" = true AND "key" IN ('org_admin') AND NOT ('facturation.gerer' = ANY("permissions"));
