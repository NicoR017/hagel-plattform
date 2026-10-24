ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "repair_steps" text[] DEFAULT '{}'::text[] NOT NULL;
