-- V7 (Repair v2, F5): imported documents of a car (parts invoice of the body shop, paint invoices, insurer / customer documents, photos, other) with versions,
-- and the repair dossier sends. Additive and idempotent: two new tables, new default grants. Nothing sent or imported is ever deleted: a new version replaces, the old one stays.
CREATE TABLE IF NOT EXISTS "vehicle_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "vehicle_id" uuid NOT NULL,
  "category" text NOT NULL,
  "type" text NOT NULL,
  "title" text DEFAULT '' NOT NULL,
  "file_key" text,
  "content_type" text,
  "size" integer DEFAULT 0 NOT NULL,
  "number" text,
  "amount_ht" numeric(12, 2),
  "partner_station_id" uuid,
  "order_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "paint_job_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "in_dossier" boolean DEFAULT false NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "supersedes_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dossier_sends" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "vehicle_id" uuid NOT NULL,
  "to_emails" text[] DEFAULT '{}'::text[] NOT NULL,
  "cc_emails" text[] DEFAULT '{}'::text[] NOT NULL,
  "status" text DEFAULT 'sent' NOT NULL,
  "error" text,
  "included" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "note" text,
  "sent_by" uuid,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_vehicle_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "dossier_sends" ADD CONSTRAINT "dossier_sends_vehicle_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_documents_vehicle_idx" ON "vehicle_documents" ("vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dossier_sends_vehicle_idx" ON "dossier_sends" ("vehicle_id");--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'documents.importer') WHERE "is_system" = true AND "key" IN ('org_admin', 'chef_site') AND NOT ('documents.importer' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'dossier.envoyer') WHERE "is_system" = true AND "key" IN ('org_admin', 'chef_site') AND NOT ('dossier.envoyer' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'facturation.voir') WHERE "is_system" = true AND "key" IN ('org_admin', 'chef_site') AND NOT ('facturation.voir' = ANY("permissions"));
