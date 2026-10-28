-- V6, automatic insurer reports. Additive and idempotent: two new tables and three permissions appended to the default roles. No existing row is touched.
CREATE TABLE IF NOT EXISTS "insurer_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'es' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"insurer_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"bodyshop_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"station_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"countries" text[] DEFAULT '{}'::text[] NOT NULL,
	"project_start" text,
	"frequency" text DEFAULT 'week' NOT NULL,
	"send_day" integer DEFAULT 1 NOT NULL,
	"window_from" text DEFAULT '16:00' NOT NULL,
	"window_to" text DEFAULT '17:00' NOT NULL,
	"timezone" text DEFAULT 'Europe/Madrid' NOT NULL,
	"to_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"cc_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"bcc_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"reply_to" text,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"kpis" text[] DEFAULT '{}'::text[] NOT NULL,
	"annex_vehicles" boolean DEFAULT false NOT NULL,
	"show_amounts" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insurer_report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"period_from" text NOT NULL,
	"period_to" text NOT NULL,
	"trigger" text DEFAULT 'auto' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"file_key" text,
	"error" text,
	"kpis" jsonb,
	"sent_by" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insurer_reports" ADD CONSTRAINT "insurer_reports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insurer_reports" ADD CONSTRAINT "insurer_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insurer_report_runs" ADD CONSTRAINT "insurer_report_runs_report_id_insurer_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."insurer_reports"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insurer_report_runs" ADD CONSTRAINT "insurer_report_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insurer_report_runs" ADD CONSTRAINT "insurer_report_runs_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insurer_reports_org_idx" ON "insurer_reports" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insurer_report_runs_report_idx" ON "insurer_report_runs" USING btree ("report_id","created_at");--> statement-breakpoint
-- one automatic send per report and period (a retry or a second worker never sends twice)
CREATE UNIQUE INDEX IF NOT EXISTS "insurer_report_runs_auto_uq" ON "insurer_report_runs" USING btree ("report_id","period_from","period_to") WHERE trigger = 'auto';
--> statement-breakpoint
-- new permissions for the default roles: "Organisation admin" all three, "Station manager" see + send (editable afterwards like any other). Idempotent.
UPDATE "roles" SET "permissions" = array_append("permissions", 'rapports.voir')
WHERE "is_system" = true AND "key" IN ('org_admin', 'chef_site') AND NOT ('rapports.voir' = ANY("permissions"));
--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'rapports.envoyer')
WHERE "is_system" = true AND "key" IN ('org_admin', 'chef_site') AND NOT ('rapports.envoyer' = ANY("permissions"));
--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'rapports.gerer')
WHERE "is_system" = true AND "key" = 'org_admin' AND NOT ('rapports.gerer' = ANY("permissions"));
