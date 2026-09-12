import { and, eq, inArray, ne } from "drizzle-orm";

import { db } from "@/db";
import { bookings, passengers, processedEvents, seats } from "@/db/schema";
import { generatePnr } from "./pnr";
import { publishSeatEvent } from "./seat-events";
import { generateVerificationToken } from "./verification";
import { releaseSeat } from "./seat-lock";

/** PNR space is ~1e9; a collision twice in a row is already vanishingly rare. */
const PNR_MAX_ATTEMPTS = 5;

export type PassengerInput = {
  fullName: string;
  passportNumber: string;
  /** ISO 3166-1 alpha-2, uppercase. Optional for legacy sessions. */
  nationality?: string;
  /** YYYY-MM-DD. Optional for legacy sessions. */
  dateOfBirth?: string;
  seatId: string;
  extraBaggageKg?: number;
};

export type FulfillmentInput = {
  /** Stripe event id — the idempotency key for this whole operation. */
  eventId: string;
  flightId: string;
  userId: string;
  /** Decimal string, taken from what Stripe actually charged. */
  totalPrice: string;
  stripePaymentIntentId: string | null;
  passengers: PassengerInput[];
};

export type FulfillmentResult =
  | {
      status: "created";
      bookingId: string;
      pnr: string;
      seatIds: string[];
      /** Secret behind the boarding-pass QR code, for the confirmation email. */
      verificationToken: string;
    }
  | { status: "duplicate" }
  /** Seat ids that do not exist on this flight — malformed or tampered metadata. */
  | { status: "invalid_seats"; seatIds: string[] }
  /** Someone else confirmed these seats first. Charge needs refunding. */
  | { status: "seats_unavailable"; seatIds: string[] };

/**
 * Turn a paid checkout into a confirmed booking, exactly once.
 *
 * Everything below runs in one transaction, so a failure at any step leaves no
 * partial booking behind. The Stripe event id is claimed first: a replayed
 * delivery loses the race on the primary key and exits without writing.
 */
export async function fulfillCheckout(
  input: FulfillmentInput,
): Promise<FulfillmentResult> {
  return db.transaction(async (tx) => {
    // 1. Claim the event. `DO NOTHING` returns no row when the id is already
    //    present, which *is* the "have we processed this?" check — doing it as
    //    a separate SELECT would leave a window for two concurrent deliveries
    //    to both pass.
    const claimed = await tx
      .insert(processedEvents)
      .values({ id: input.eventId })
      .onConflictDoNothing()
      .returning({ id: processedEvents.id });

    if (claimed.length === 0) {
      return { status: "duplicate" };
    }

    const seatIds = input.passengers.map((p) => p.seatId);

    // 2. Every seat must actually belong to the flight being booked. Metadata
    //    arrives from Stripe but originates client-side, so it is untrusted.
    const validSeats = await tx
      .select({ id: seats.id })
      .from(seats)
      .where(and(eq(seats.flightId, input.flightId), inArray(seats.id, seatIds)));

    if (validSeats.length !== seatIds.length) {
      const found = new Set(validSeats.map((s) => s.id));
      return {
        status: "invalid_seats",
        seatIds: seatIds.filter((id) => !found.has(id)),
      };
    }

    // 3. Reject seats already held by a live booking. The unique index on
    //    `passengers.selected_seat_id` is the real guarantee; this check exists
    //    to return a clean result instead of a constraint violation.
    const taken = await tx
      .select({ seatId: passengers.selectedSeatId })
      .from(passengers)
      .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
      .where(
        and(
          inArray(passengers.selectedSeatId, seatIds),
          ne(bookings.status, "CANCELLED"),
        ),
      );

    if (taken.length > 0) {
      return {
        status: "seats_unavailable",
        seatIds: taken.map((t) => t.seatId!),
      };
    }

    // 4. Create the booking. `DO NOTHING` on a PNR collision keeps the
    //    transaction alive so we can simply try another code.
    let booking: typeof bookings.$inferSelect | undefined;

    for (let attempt = 0; attempt < PNR_MAX_ATTEMPTS && !booking; attempt++) {
      const [row] = await tx
        .insert(bookings)
        .values({
          pnr: generatePnr(),
          // Minted inside the same transaction that creates the booking, so a
          // confirmed booking can never exist without a scannable pass.
          verificationToken: generateVerificationToken(),
          flightId: input.flightId,
          userId: input.userId,
          totalPrice: input.totalPrice,
          status: "CONFIRMED",
          stripePaymentIntentId: input.stripePaymentIntentId,
        })
        .onConflictDoNothing({ target: bookings.pnr })
        .returning();

      booking = row;
    }

    if (!booking) {
      throw new Error(
        `Could not allocate a unique PNR after ${PNR_MAX_ATTEMPTS} attempts`,
      );
    }

    // 5. Passengers, each pinned to their seat.
    await tx.insert(passengers).values(
      input.passengers.map((p) => ({
        bookingId: booking!.id,
        fullName: p.fullName,
        passportNumber: p.passportNumber,
        nationality: p.nationality?.toUpperCase() ?? null,
        dateOfBirth: p.dateOfBirth ?? null,
        extraBaggageKg: p.extraBaggageKg ?? 0,
        selectedSeatId: p.seatId,
      })),
    );

    return {
      status: "created",
      bookingId: booking.id,
      pnr: booking.pnr,
      seatIds,
      verificationToken: booking.verificationToken!,
    };
  });
}

/**
 * Drop the Redis holds once the booking is durable.
 *
 * Deliberately *after* the transaction commits, not inside it. Redis cannot
 * participate in a Postgres transaction, so releasing mid-transaction would
 * free the seat before the booking is durable — and could not be undone on
 * rollback. Failures here are logged, never thrown: the seat is now
 * permanently ours in Postgres, and a stale hold expires on its own.
 */
export async function releaseHeldSeats(
  flightId: string,
  seatIds: string[],
  userId: string,
): Promise<void> {
  // Announce the sale before dropping the holds. Between the two, other
  // viewers see the seat as held rather than briefly as available — the
  // pessimistic order is the safe one.
  await publishSeatEvent(flightId, "booked", seatIds);

  await Promise.all(
    seatIds.map(async (seatId) => {
      try {
        await releaseSeat(flightId, seatId, userId);
      } catch (error) {
        console.error(
          `[fulfillment] failed to release seat hold ${flightId}/${seatId}`,
          error,
        );
      }
    }),
  );
}
