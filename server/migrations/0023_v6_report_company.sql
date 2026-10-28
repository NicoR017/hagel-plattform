-- V6, the letterhead (company) of an insurer report. Additive and idempotent: one nullable column.
ALTER TABLE "insurer_reports" ADD COLUMN IF NOT EXISTS "company_id" uuid;
