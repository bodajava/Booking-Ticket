import { relations, sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/*                                    Enums                                   */
/* -------------------------------------------------------------------------- */

export const seatClassEnum = pgEnum("seat_class", ["Economy", "Business"]);

export const bookingStatusEnum = pgEnum("booking_status", [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
]);

/* -------------------------------------------------------------------------- */
/*                                  Airports                                  */
/* -------------------------------------------------------------------------- */

export const airports = pgTable(
  "airports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** IATA code, always stored uppercase (e.g. "CAI"). */
    code: varchar("code", { length: 3 }).notNull(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    country: text("country").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("airports_code_idx").on(table.code),
    index("airports_city_idx").on(table.city),
    check("airports_code_uppercase_check", sql`${table.code} = upper(${table.code})`),
  ],
);

/* -------------------------------------------------------------------------- */
/*                              Aircraft layouts                              */
/* -------------------------------------------------------------------------- */

/**
 * Describes the physical cabin of an aircraft model. Used to materialise the
 * per-flight rows in `seats` — each cabin expands to
 * `(rowEnd - rowStart + 1) * columns.length` seats, numbered `${row}${column}`.
 */
export type SeatConfiguration = {
  cabins: Array<{
    class: (typeof seatClassEnum.enumValues)[number];
    rowStart: number;
    rowEnd: number;
    /** Seat letters left-to-right, e.g. ["A", "B", "C", "D", "E", "F"]. */
    columns: string[];
    /** Columns an aisle sits behind, for seat-map rendering. */
    aislesAfter?: string[];
  }>;
};

export const aircraftLayouts = pgTable(
  "aircraft_layouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** e.g. "Airbus A320neo". */
    aircraftModel: text("aircraft_model").notNull(),
    totalSeats: integer("total_seats").notNull(),
    seatConfiguration: jsonb("seat_configuration")
      .$type<SeatConfiguration>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("aircraft_layouts_model_idx").on(table.aircraftModel),
    check("aircraft_layouts_total_seats_check", sql`${table.totalSeats} > 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/*                                   Flights                                  */
/* -------------------------------------------------------------------------- */

export const flights = pgTable(
  "flights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Marketing flight number, e.g. "MS985". */
    flightNumber: varchar("flight_number", { length: 10 }).notNull(),
    originId: uuid("origin_id")
      .notNull()
      .references(() => airports.id, { onDelete: "restrict" }),
    destinationId: uuid("destination_id")
      .notNull()
      .references(() => airports.id, { onDelete: "restrict" }),
    aircraftLayoutId: uuid("aircraft_layout_id").references(
      () => aircraftLayouts.id,
      { onDelete: "set null" },
    ),
    departureTime: timestamp("departure_time", { withTimezone: true }).notNull(),
    arrivalTime: timestamp("arrival_time", { withTimezone: true }).notNull(),
    basePrice: numeric("base_price", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // A flight number is reused daily, so it is only unique per departure.
    uniqueIndex("flights_number_departure_idx").on(
      table.flightNumber,
      table.departureTime,
    ),
    // Drives the primary search: origin + destination + date.
    index("flights_route_departure_idx").on(
      table.originId,
      table.destinationId,
      table.departureTime,
    ),
    check("flights_distinct_endpoints_check", sql`${table.originId} <> ${table.destinationId}`),
    check("flights_arrival_after_departure_check", sql`${table.arrivalTime} > ${table.departureTime}`),
    check("flights_base_price_check", sql`${table.basePrice} >= 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/*                                    Seats                                   */
/* -------------------------------------------------------------------------- */

export const seats = pgTable(
  "seats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    flightId: uuid("flight_id")
      .notNull()
      .references(() => flights.id, { onDelete: "cascade" }),
    /** Row + column, e.g. "12A". */
    seatNumber: varchar("seat_number", { length: 4 }).notNull(),
    class: seatClassEnum("class").notNull(),
    baggageAllowanceKg: integer("baggage_allowance_kg").notNull().default(0),
    extraBaggagePricePerKg: numeric("extra_baggage_price_per_kg", {
      precision: 10,
      scale: 2,
    })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("seats_flight_number_idx").on(table.flightId, table.seatNumber),
    index("seats_flight_class_idx").on(table.flightId, table.class),
    check("seats_baggage_allowance_check", sql`${table.baggageAllowanceKg} >= 0`),
    check("seats_extra_baggage_price_check", sql`${table.extraBaggagePricePerKg} >= 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/*                                  Bookings                                  */
/* -------------------------------------------------------------------------- */

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Passenger Name Record — the 6-character code shown to the customer. */
    pnr: varchar("pnr", { length: 6 }).notNull(),
    flightId: uuid("flight_id")
      .notNull()
      .references(() => flights.id, { onDelete: "restrict" }),
    /** Clerk user id, e.g. "user_2abc...". */
    userId: text("user_id").notNull(),
    totalPrice: numeric("total_price", { precision: 10, scale: 2 }).notNull(),
    status: bookingStatusEnum("status").notNull().default("PENDING"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    /**
     * Opaque secret behind the boarding pass QR code.
     *
     * Deliberately not the PNR. A PNR is six characters from a 32-symbol
     * alphabet, is printed on the ticket, quoted in emails and read aloud at
     * desks — fine as a customer-facing reference, far too weak to be the only
     * thing standing between a stranger and a passenger's name and seat. This
     * is 160 bits of CSPRNG output and appears nowhere a human would read it.
     *
     * Nullable because bookings made before this column existed have none;
     * those simply cannot be verified by scan until reissued.
     */
    verificationToken: varchar("verification_token", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("bookings_pnr_idx").on(table.pnr),
    // Partial-free unique index: Postgres allows many NULLs, so unpaid
    // bookings coexist while each PaymentIntent maps to at most one booking.
    uniqueIndex("bookings_payment_intent_idx").on(table.stripePaymentIntentId),
    // The scan path looks a booking up by this alone, so it must be unique
    // and indexed — a sequential scan per scan would not do at a gate.
    uniqueIndex("bookings_verification_token_idx").on(table.verificationToken),
    index("bookings_user_created_idx").on(table.userId, table.createdAt),
    index("bookings_flight_idx").on(table.flightId),
    check("bookings_total_price_check", sql`${table.totalPrice} >= 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/*                                 Passengers                                 */
/* -------------------------------------------------------------------------- */

export const passengers = pgTable(
  "passengers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    passportNumber: varchar("passport_number", { length: 20 }).notNull(),
    /** ISO 3166-1 alpha-2, uppercase — the passport's issuing country. */
    nationality: varchar("nationality", { length: 2 }),
    /**
     * Date only, no time or zone: a birthday is the same calendar date in
     * every timezone, and storing it as a timestamp would shift it across one.
     */
    dateOfBirth: date("date_of_birth"),
    /** Kilos purchased above the seat's included allowance. */
    extraBaggageKg: integer("extra_baggage_kg").notNull().default(0),
    selectedSeatId: uuid("selected_seat_id").references(() => seats.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One passenger per seat — this is the seat-locking guarantee.
    uniqueIndex("passengers_selected_seat_idx").on(table.selectedSeatId),
    index("passengers_booking_idx").on(table.bookingId),
    check("passengers_nationality_uppercase_check", sql`${table.nationality} IS NULL OR ${table.nationality} = upper(${table.nationality})`),
    check("passengers_extra_baggage_check", sql`${table.extraBaggageKg} >= 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/*                             Destination guides                             */
/* -------------------------------------------------------------------------- */

/** Matches OpenAI `text-embedding-3-small` (1536 dimensions). */
export const EMBEDDING_DIMENSIONS = 1536;

export const destinationGuides = pgTable(
  "destination_guides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    city: text("city").notNull(),
    country: text("country").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("destination_guides_embedding_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops")),
    index("destination_guides_city_idx").on(table.city, table.country),
  ],
);

/* -------------------------------------------------------------------------- */
/*                    Processed events (webhook idempotency)                  */
/* -------------------------------------------------------------------------- */

/**
 * Insert the Stripe event id inside the same transaction that applies the
 * event's side effects. A duplicate delivery hits the primary key and the
 * whole transaction rolls back, so the handler stays exactly-once.
 */
export const processedEvents = pgTable("processed_events", {
  id: text("stripe_event_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* -------------------------------------------------------------------------- */
/*                                  Relations                                 */
/* -------------------------------------------------------------------------- */

export const airportsRelations = relations(airports, ({ many }) => ({
  departingFlights: many(flights, { relationName: "origin" }),
  arrivingFlights: many(flights, { relationName: "destination" }),
}));

export const aircraftLayoutsRelations = relations(
  aircraftLayouts,
  ({ many }) => ({
    flights: many(flights),
  }),
);

export const flightsRelations = relations(flights, ({ one, many }) => ({
  origin: one(airports, {
    fields: [flights.originId],
    references: [airports.id],
    relationName: "origin",
  }),
  destination: one(airports, {
    fields: [flights.destinationId],
    references: [airports.id],
    relationName: "destination",
  }),
  aircraftLayout: one(aircraftLayouts, {
    fields: [flights.aircraftLayoutId],
    references: [aircraftLayouts.id],
  }),
  seats: many(seats),
  bookings: many(bookings),
}));

export const seatsRelations = relations(seats, ({ one }) => ({
  flight: one(flights, {
    fields: [seats.flightId],
    references: [flights.id],
  }),
  passenger: one(passengers),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  flight: one(flights, {
    fields: [bookings.flightId],
    references: [flights.id],
  }),
  passengers: many(passengers),
}));

export const passengersRelations = relations(passengers, ({ one }) => ({
  booking: one(bookings, {
    fields: [passengers.bookingId],
    references: [bookings.id],
  }),
  selectedSeat: one(seats, {
    fields: [passengers.selectedSeatId],
    references: [seats.id],
  }),
}));

/* -------------------------------------------------------------------------- */
/*                                Inferred types                              */
/* -------------------------------------------------------------------------- */

export type Airport = typeof airports.$inferSelect;
export type NewAirport = typeof airports.$inferInsert;

export type AircraftLayout = typeof aircraftLayouts.$inferSelect;
export type NewAircraftLayout = typeof aircraftLayouts.$inferInsert;

export type Flight = typeof flights.$inferSelect;
export type NewFlight = typeof flights.$inferInsert;

export type Seat = typeof seats.$inferSelect;
export type NewSeat = typeof seats.$inferInsert;

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;

export type Passenger = typeof passengers.$inferSelect;
export type NewPassenger = typeof passengers.$inferInsert;

export type DestinationGuide = typeof destinationGuides.$inferSelect;
export type NewDestinationGuide = typeof destinationGuides.$inferInsert;

export type ProcessedEvent = typeof processedEvents.$inferSelect;
export type NewProcessedEvent = typeof processedEvents.$inferInsert;

export type SeatClass = (typeof seatClassEnum.enumValues)[number];
export type BookingStatus = (typeof bookingStatusEnum.enumValues)[number];
