ALTER TABLE "bookings" ADD COLUMN "verification_token" varchar(32);--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_verification_token_idx" ON "bookings" USING btree ("verification_token");