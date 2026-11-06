-- V7 (Repair v2, F1): the customer's consent to move the car (drop-off signature), the "do not move" flag and the driver of a move.
-- Additive and idempotent: new nullable columns only, nothing is renamed, dropped or rewritten (the previous release keeps working on this schema).
ALTER TABLE "vehicle_handovers" ADD COLUMN IF NOT EXISTS "move_consent" boolean;--> statement-breakpoint
ALTER TABLE "vehicle_handovers" ADD COLUMN IF NOT EXISTS "move_consent_text" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "no_move" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicle_moves" ADD COLUMN IF NOT EXISTS "driver_user_id" uuid;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "vehicle_moves" ADD CONSTRAINT "vehicle_moves_driver_user_id_users_id_fk" FOREIGN KEY ("driver_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
