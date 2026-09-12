ALTER TABLE "passengers" ADD COLUMN "nationality" varchar(2);--> statement-breakpoint
ALTER TABLE "passengers" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "passengers" ADD COLUMN "extra_baggage_kg" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "passengers" ADD CONSTRAINT "passengers_nationality_uppercase_check" CHECK ("passengers"."nationality" IS NULL OR "passengers"."nationality" = upper("passengers"."nationality"));--> statement-breakpoint
ALTER TABLE "passengers" ADD CONSTRAINT "passengers_extra_baggage_check" CHECK ("passengers"."extra_baggage_kg" >= 0);