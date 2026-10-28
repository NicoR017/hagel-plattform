ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "contact_email" text;
--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "reply_from_contact" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "reply_mode" text;
--> statement-breakpoint
ALTER TABLE "report_sends" ADD COLUMN IF NOT EXISTS "reply_to" text;
