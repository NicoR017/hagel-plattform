ALTER TABLE "repair_bookings" ADD COLUMN "origin_station_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_bookings" ADD CONSTRAINT "repair_bookings_origin_station_id_stations_id_fk" FOREIGN KEY ("origin_station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
