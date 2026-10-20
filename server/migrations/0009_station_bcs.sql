ALTER TABLE "stations" ADD COLUMN "azure_bc_ids" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
UPDATE "stations" SET "azure_bc_ids" = ARRAY["azure_business_customer_id"] WHERE "azure_business_customer_id" IS NOT NULL;
