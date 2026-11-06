-- V7 (Repair v2, F2): spare parts of a car, catalogue of generic part names by zone (4 languages), custom zones.
-- Additive and idempotent: new tables, new indexes, new default grants. The old list "partsToReplace" (vehicle header) is COPIED, never changed or removed.
CREATE TABLE IF NOT EXISTS "part_zones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "key" text NOT NULL,
  "group" text NOT NULL,
  "name_de" text DEFAULT '' NOT NULL,
  "name_en" text DEFAULT '' NOT NULL,
  "name_fr" text DEFAULT '' NOT NULL,
  "name_es" text DEFAULT '' NOT NULL,
  "sort" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "part_catalog" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "name_de" text DEFAULT '' NOT NULL,
  "name_en" text DEFAULT '' NOT NULL,
  "name_fr" text DEFAULT '' NOT NULL,
  "name_es" text DEFAULT '' NOT NULL,
  "translation_validated" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "part_catalog_zones" (
  "catalog_id" uuid NOT NULL,
  "zone_key" text NOT NULL,
  CONSTRAINT "part_catalog_zones_pk" PRIMARY KEY ("catalog_id", "zone_key")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_parts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "vehicle_id" uuid NOT NULL,
  "zone_key" text,
  "catalog_id" uuid,
  "name" text NOT NULL,
  "qty" integer DEFAULT 1 NOT NULL,
  "oem_ref" text,
  "source" text DEFAULT 'assessment' NOT NULL,
  "status" text DEFAULT 'to_order' NOT NULL,
  "migrated_key" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "part_zones" ADD CONSTRAINT "part_zones_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "part_catalog" ADD CONSTRAINT "part_catalog_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "part_catalog_zones" ADD CONSTRAINT "part_catalog_zones_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "part_catalog"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "vehicle_parts" ADD CONSTRAINT "vehicle_parts_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "vehicle_parts" ADD CONSTRAINT "vehicle_parts_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "part_catalog"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "part_zones_org_key_uq" ON "part_zones" ("org_id", "key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_catalog_org_idx" ON "part_catalog" ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_parts_vehicle_idx" ON "vehicle_parts" ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_parts_migrated_uq" ON "vehicle_parts" ("vehicle_id", "migrated_key") WHERE "migrated_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_parts_replace_uq" ON "vehicle_parts" ("vehicle_id", "zone_key") WHERE "source" = 'replace' AND "deleted_at" IS NULL;--> statement-breakpoint
-- the free-text parts of the estimate become parts of the right car (the header list stays as it is)
INSERT INTO "vehicle_parts" ("id", "vehicle_id", "zone_key", "name", "qty", "source", "status", "migrated_key")
SELECT gen_random_uuid(), v."id", NULL, left(trim(p."t"), 120), 1, 'migrated', 'to_order', lower(trim(p."t"))
FROM "vehicles" v
CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(v."header" -> 'partsToReplace') = 'array' THEN v."header" -> 'partsToReplace' ELSE '[]'::jsonb END) AS p("t")
WHERE trim(p."t") <> ''
ON CONFLICT ("vehicle_id", "migrated_key") WHERE "migrated_key" IS NOT NULL DO NOTHING;--> statement-breakpoint
-- phones fetch a car again when its change number moves: the cars that now have migrated parts get a new number (nothing else changes)
UPDATE "vehicles" SET "seq" = nextval('change_seq') WHERE "id" IN (SELECT DISTINCT "vehicle_id" FROM "vehicle_parts" WHERE "source" = 'migrated');--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'pieces.voir') WHERE "is_system" = true AND "key" IN ('org_admin', 'chef_site', 'aufnehmer', 'technicien', 'freelance') AND NOT ('pieces.voir' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'pieces.catalogue') WHERE "is_system" = true AND "key" IN ('org_admin', 'chef_site') AND NOT ('pieces.catalogue' = ANY("permissions"));
