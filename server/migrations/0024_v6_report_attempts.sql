-- V6, automatic insurer reports: how often an automatic send was tried (retries are limited). Additive and idempotent: two columns.
ALTER TABLE "insurer_report_runs" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "insurer_report_runs" ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamp with time zone;
