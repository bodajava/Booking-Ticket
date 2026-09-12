CREATE TYPE "public"."booking_status" AS ENUM('PENDING', 'CONFIRMED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."seat_class" AS ENUM('Economy', 'Business');--> statement-breakpoint
CREATE TABLE "aircraft_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aircraft_model" text NOT NULL,
	"total_seats" integer NOT NULL,
	"seat_configuration" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aircraft_layouts_total_seats_check" CHECK ("aircraft_layouts"."total_seats" > 0)
);
--> statement-breakpoint
CREATE TABLE "airports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(3) NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"country" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "airports_code_uppercase_check" CHECK ("airports"."code" = upper("airports"."code"))
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pnr" varchar(6) NOT NULL,
	"flight_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"total_price" numeric(10, 2) NOT NULL,
	"status" "booking_status" DEFAULT 'PENDING' NOT NULL,
	"stripe_payment_intent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_total_price_check" CHECK ("bookings"."total_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "destination_guides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city" text NOT NULL,
	"country" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_number" varchar(10) NOT NULL,
	"origin_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"aircraft_layout_id" uuid,
	"departure_time" timestamp with time zone NOT NULL,
	"arrival_time" timestamp with time zone NOT NULL,
	"base_price" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flights_distinct_endpoints_check" CHECK ("flights"."origin_id" <> "flights"."destination_id"),
	CONSTRAINT "flights_arrival_after_departure_check" CHECK ("flights"."arrival_time" > "flights"."departure_time"),
	CONSTRAINT "flights_base_price_check" CHECK ("flights"."base_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "passengers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"passport_number" varchar(20) NOT NULL,
	"selected_seat_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"stripe_event_id" text PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_id" uuid NOT NULL,
	"seat_number" varchar(4) NOT NULL,
	"class" "seat_class" NOT NULL,
	"baggage_allowance_kg" integer DEFAULT 0 NOT NULL,
	"extra_baggage_price_per_kg" numeric(10, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seats_baggage_allowance_check" CHECK ("seats"."baggage_allowance_kg" >= 0),
	CONSTRAINT "seats_extra_baggage_price_check" CHECK ("seats"."extra_baggage_price_per_kg" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flights"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_origin_id_airports_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."airports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_destination_id_airports_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."airports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_aircraft_layout_id_aircraft_layouts_id_fk" FOREIGN KEY ("aircraft_layout_id") REFERENCES "public"."aircraft_layouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passengers" ADD CONSTRAINT "passengers_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passengers" ADD CONSTRAINT "passengers_selected_seat_id_seats_id_fk" FOREIGN KEY ("selected_seat_id") REFERENCES "public"."seats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seats" ADD CONSTRAINT "seats_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aircraft_layouts_model_idx" ON "aircraft_layouts" USING btree ("aircraft_model");--> statement-breakpoint
CREATE UNIQUE INDEX "airports_code_idx" ON "airports" USING btree ("code");--> statement-breakpoint
CREATE INDEX "airports_city_idx" ON "airports" USING btree ("city");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_pnr_idx" ON "bookings" USING btree ("pnr");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_payment_intent_idx" ON "bookings" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX "bookings_user_created_idx" ON "bookings" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "bookings_flight_idx" ON "bookings" USING btree ("flight_id");--> statement-breakpoint
CREATE INDEX "destination_guides_embedding_idx" ON "destination_guides" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "destination_guides_city_idx" ON "destination_guides" USING btree ("city","country");--> statement-breakpoint
CREATE UNIQUE INDEX "flights_number_departure_idx" ON "flights" USING btree ("flight_number","departure_time");--> statement-breakpoint
CREATE INDEX "flights_route_departure_idx" ON "flights" USING btree ("origin_id","destination_id","departure_time");--> statement-breakpoint
CREATE UNIQUE INDEX "passengers_selected_seat_idx" ON "passengers" USING btree ("selected_seat_id");--> statement-breakpoint
CREATE INDEX "passengers_booking_idx" ON "passengers" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seats_flight_number_idx" ON "seats" USING btree ("flight_id","seat_number");--> statement-breakpoint
CREATE INDEX "seats_flight_class_idx" ON "seats" USING btree ("flight_id","class");