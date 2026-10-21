ALTER TABLE "vehicles" ADD COLUMN "bodyshop_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_bodyshop_id_stations_id_fk" FOREIGN KEY ("bodyshop_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
