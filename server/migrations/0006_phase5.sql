CREATE TABLE IF NOT EXISTS "azure_bc_insurance_links" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"business_customer_id" text NOT NULL,
	"insurance_id" text NOT NULL,
	"partition_key" text DEFAULT '' NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "azure_business_customers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"partition_key" text DEFAULT '' NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "azure_insurances" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"partition_key" text DEFAULT '' NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "azure_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"error" text,
	"stats" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "azure_sync_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "azure_tenants" (
	"name" text PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "colibri_scans" (
	"partition_key" text NOT NULL,
	"row_key" text NOT NULL,
	"tenant" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"colibri_number" text DEFAULT '' NOT NULL,
	"business_customer" text DEFAULT '' NOT NULL,
	"claim_number" text DEFAULT '' NOT NULL,
	"scan_date_time" timestamp with time zone,
	"plate" text DEFAULT '' NOT NULL,
	"vin" text DEFAULT '' NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"build_year" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"language" text DEFAULT '' NOT NULL,
	"calculation_method" text DEFAULT '' NOT NULL,
	"dents_total" integer,
	"scan_failed" boolean DEFAULT false NOT NULL,
	"error_message" text DEFAULT '' NOT NULL,
	"url_pdf" text DEFAULT '' NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"import_status" text DEFAULT 'new' NOT NULL,
	"vehicle_id" uuid,
	"imported_by" uuid,
	"imported_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "colibri_scans_partition_key_row_key_pk" PRIMARY KEY("partition_key","row_key")
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "colibri_scan_key" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "colibri_scans_tenant_idx" ON "colibri_scans" USING btree ("tenant","import_status");--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_colibri_scan_key_unique" UNIQUE("colibri_scan_key");