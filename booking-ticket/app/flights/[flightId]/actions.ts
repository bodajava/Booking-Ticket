"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { flights, seats } from "@/db/schema";
import { resolveReturnOrigin } from "@/lib/app-origin";
import { encodeCheckoutMetadata } from "@/lib/checkout-metadata";
import {
  CURRENCY,
  MAX_PASSENGERS,
  centsToDecimal,
  extraBaggageKgSchema,
  formatCents,
  quoteSeat,
  sumQuotes,
  type BookingTotals,
  type Quote,
} from "@/lib/pricing";
import { getBookedSeatIds } from "@/lib/seat-availability";
import { publishSeatEvent } from "@/lib/seat-events";
import { getOwnedHold, getUserHolds, holdSeat, releaseSeat } from "@/lib/seat-lock";
import { stripe } from "@/lib/stripe";

/**
 * Every mutation the booking flow can trigger.
 *
 * Server Actions are reachable by direct POST, not just through our own UI, so
 * each one re-establishes the same three facts from scratch: who is calling
 * (Clerk, server-side — never a client-supplied id), whether the seats are
 * really theirs (Redis, ownership-checked), and what it really costs
 * (Postgres, priced server-side). Nothing a caller sends is trusted beyond
 * identifying a row.
 *
 * Failures are returned, not thrown. A thrown Server Action error reaches the
 * browser as an opaque digest, which would leave the user staring at a seat map
 * with no idea why their click did nothing.
 */

/* -------------------------------------------------------------------------- */
/*                                   Results                                  */
/* -------------------------------------------------------------------------- */

export type SerializableQuote = Quote & {
  seatId: string;
  seatNumber: string;
  seatClass: string;
  allowanceKg: number;
};

export type SerializableTotals = BookingTotals & { currency: string };

export type HoldResult =
  | { ok: true; seatId: string; expiresAt: number; quote: SerializableQuote }
  /** Someone else holds or has bought it. The map should refresh. */
  | { ok: false; reason: "unavailable"; message: string }
  | { ok: false; reason: "unauthenticated"; message: string }
  | { ok: false; reason: "invalid"; message: string };

export type QuoteResult =
  | { ok: true; quotes: SerializableQuote[]; totals: SerializableTotals }
  | { ok: false; reason: "expired" | "invalid" | "unauthenticated"; message: string };

export type CheckoutResult =
  | { ok: true; url: string }
  /** A hold lapsed or was never ours — the traveller must pick again. */
  | { ok: false; reason: "expired"; message: string }
  | { ok: false; reason: "unavailable"; message: string }
  | { ok: false; reason: "invalid"; message: string }
  | { ok: false; reason: "unauthenticated"; message: string }
  | { ok: false; reason: "checkout_failed"; message: string };

const SIGN_IN_MESSAGE = "Sign in to choose a seat.";

/* -------------------------------------------------------------------------- */
/*                                   Schemas                                  */
/* -------------------------------------------------------------------------- */

const seatRefSchema = z.object({
  flightId: z.uuid(),
  seatId: z.uuid(),
});

/** Switching a passenger's seat releases only *that* seat, not the whole party. */
const holdRequestSchema = seatRefSchema.extend({
  replaceSeatId: z.uuid().nullable().optional(),
});

const partyLegSchema = z.object({
  seatId: z.uuid(),
  extraBaggageKg: extraBaggageKgSchema,
});

const quoteRequestSchema = z.object({
  flightId: z.uuid(),
  passengers: z.array(partyLegSchema).min(1).max(MAX_PASSENGERS),
});

/**
 * Identity as the airline needs it at the gate.
 *
 * Validated here as well as in the browser because a Server Action is a public
 * endpoint: the client-side checks are there to give fast feedback, not to be
 * the thing that keeps bad data out of a booking.
 */
const checkoutPassengerSchema = partyLegSchema.extend({
  fullName: z
    .string()
    .trim()
    .min(2, "Enter the passenger's full name as printed on their passport")
    .max(200),
  passportNumber: z
    .string()
    .trim()
    .min(4, "Enter a valid passport number")
    .max(20)
    .regex(/^[A-Za-z0-9]+$/, "Passport numbers are letters and digits only"),
  nationality: z
    .string()
    .trim()
    .length(2, "Choose the country that issued the passport")
    .regex(/^[A-Za-z]{2}$/, "Choose the country that issued the passport"),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date of birth as YYYY-MM-DD")
    .refine((value) => {
      const date = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) return false;
      // A booking for someone born tomorrow, or 130 years ago, is a typo.
      const now = Date.now();
      return date.getTime() < now && date.getTime() > now - 130 * 365.25 * 864e5;
    }, "Enter a valid date of birth"),
});

const checkoutRequestSchema = z.object({
  flightId: z.uuid(),
  passengers: z.array(checkoutPassengerSchema).min(1).max(MAX_PASSENGERS),
});

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

type PricedSeat = {
  seatId: string;
  seatNumber: string;
  class: "Economy" | "Business";
  baggageAllowanceKg: number;
  extraBaggagePricePerKg: string;
  basePrice: string;
  flightNumber: string;
};

/** The seat rows plus their flight's fare basis — the only pricing inputs we trust. */
async function loadSeatsForPricing(
  flightId: string,
  seatIds: string[],
): Promise<Map<string, PricedSeat>> {
  const rows = await db
    .select({
      seatId: seats.id,
      seatNumber: seats.seatNumber,
      class: seats.class,
      baggageAllowanceKg: seats.baggageAllowanceKg,
      extraBaggagePricePerKg: seats.extraBaggagePricePerKg,
      basePrice: flights.basePrice,
      flightNumber: flights.flightNumber,
    })
    .from(seats)
    .innerJoin(flights, eq(seats.flightId, flights.id))
    // Matching on both ids is the check that each seat is on *this* flight.
    .where(and(inArray(seats.id, seatIds), eq(seats.flightId, flightId)));

  return new Map(rows.map((row) => [row.seatId, row]));
}

function priceSeat(seat: PricedSeat, extraBaggageKg: number): SerializableQuote {
  return {
    ...quoteSeat({
      basePrice: seat.basePrice,
      seatClass: seat.class,
      extraBaggagePricePerKg: seat.extraBaggagePricePerKg,
      extraBaggageKg,
    }),
    seatId: seat.seatId,
    seatNumber: seat.seatNumber,
    seatClass: seat.class,
    allowanceKg: seat.baggageAllowanceKg,
  };
}

/* -------------------------------------------------------------------------- */
/*                                 holdSeat                                   */
/* -------------------------------------------------------------------------- */

/**
 * Take a 10-minute hold on a seat for one passenger in the party.
 *
 * The new seat is taken *before* the old one is given up, so a traveller who
 * clicks a seat someone else just took keeps the perfectly good seat they
 * already had. Holding two seats for the few milliseconds in between is the
 * cheaper cost. `replaceSeatId` is passed explicitly rather than inferred:
 * with a party of four in play, "release whatever this user holds" would drop
 * three other passengers' seats.
 */
export async function holdSeatAction(input: {
  flightId: string;
  seatId: string;
  replaceSeatId?: string | null;
}): Promise<HoldResult> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, reason: "unauthenticated", message: SIGN_IN_MESSAGE };
  }

  const parsed = holdRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalid", message: "That seat could not be found." };
  }
  const { flightId, seatId, replaceSeatId } = parsed.data;

  const seat = (await loadSeatsForPricing(flightId, [seatId])).get(seatId);
  if (!seat) {
    return { ok: false, reason: "invalid", message: "That seat is not on this flight." };
  }

  // A sold seat can still have a stale lock; Postgres is the final word.
  const booked = await getBookedSeatIds(flightId);
  if (booked.includes(seatId)) {
    return {
      ok: false,
      reason: "unavailable",
      message: "That seat has just been booked. Choose another.",
    };
  }

  const held = await holdSeat(flightId, seatId, userId);
  if (!held) {
    return {
      ok: false,
      reason: "unavailable",
      message: "Someone else is choosing that seat. Pick a different one.",
    };
  }

  // Every other browser watching this flight learns the seat is taken now,
  // without anyone reloading. The payload is the seat id only — who took it is
  // deliberately not on the wire.
  await publishSeatEvent(flightId, "held", [seatId]);

  if (replaceSeatId && replaceSeatId !== seatId) {
    if (await releaseSeat(flightId, replaceSeatId, userId)) {
      await publishSeatEvent(flightId, "released", [replaceSeatId]);
    }
  }

  // Read the expiry back rather than computing `now + 600s`: the countdown must
  // track the key that will actually expire, not our estimate of it.
  const hold = await getOwnedHold(flightId, seatId, userId);
  if (!hold) {
    return {
      ok: false,
      reason: "unavailable",
      message: "That seat was taken a moment ago. Choose another.",
    };
  }

  return {
    ok: true,
    seatId,
    expiresAt: hold.expiresAt,
    quote: priceSeat(seat, 0),
  };
}

/* -------------------------------------------------------------------------- */
/*                                releaseSeat                                 */
/* -------------------------------------------------------------------------- */

/** Give a seat back. Safe to call when the hold has already lapsed. */
export async function releaseSeatAction(input: {
  flightId: string;
  seatId: string;
}): Promise<{ ok: boolean }> {
  const { userId } = await auth();
  if (!userId) return { ok: false };

  const parsed = seatRefSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const released = await releaseSeat(parsed.data.flightId, parsed.data.seatId, userId);

  // Only announce a release we actually performed. `releaseSeat` is
  // ownership-safe and returns false when the hold was someone else's or had
  // already lapsed — publishing on those would tell every other browser a seat
  // is free when it is not.
  if (released) {
    await publishSeatEvent(parsed.data.flightId, "released", [parsed.data.seatId]);
  }

  return { ok: released };
}

/* -------------------------------------------------------------------------- */
/*                                   quote                                    */
/* -------------------------------------------------------------------------- */

/**
 * Re-price the whole party on the server.
 *
 * The baggage steppers update their own arithmetic instantly so the summary
 * never lags a click, then call this to have the server confirm it. The number
 * the traveller is asked to pay is always the one that comes back from here —
 * the optimistic figure is a preview, not a price.
 */
export async function quoteBookingAction(input: {
  flightId: string;
  passengers: Array<{ seatId: string; extraBaggageKg: number }>;
}): Promise<QuoteResult> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, reason: "unauthenticated", message: SIGN_IN_MESSAGE };
  }

  const parsed = quoteRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      message: parsed.error.issues[0]?.message ?? "That baggage amount is not available.",
    };
  }
  const { flightId, passengers } = parsed.data;

  // Every seat must still be ours, or the total would be for seats we cannot sell.
  const holds = new Set((await getUserHolds(flightId, userId)).map((h) => h.seatId));
  if (passengers.some((p) => !holds.has(p.seatId))) {
    return { ok: false, reason: "expired", message: "A seat hold has ended." };
  }

  const seatRows = await loadSeatsForPricing(
    flightId,
    passengers.map((p) => p.seatId),
  );

  const quotes: SerializableQuote[] = [];
  for (const passenger of passengers) {
    const seat = seatRows.get(passenger.seatId);
    if (!seat) {
      return { ok: false, reason: "invalid", message: "A seat is not on this flight." };
    }
    quotes.push(priceSeat(seat, passenger.extraBaggageKg));
  }

  return {
    ok: true,
    quotes,
    totals: { ...sumQuotes(quotes), currency: CURRENCY },
  };
}

/* -------------------------------------------------------------------------- */
/*                                  checkout                                  */
/* -------------------------------------------------------------------------- */

/**
 * Turn a held party into a Stripe Checkout Session.
 *
 * The order matters. Ownership of every lock is re-verified *before* a session
 * is created, so we never send a traveller to a payment page for a seat that
 * has since lapsed to someone else. The seats stay held in Redis throughout —
 * nothing is written to Postgres here. The booking only exists once the signed
 * `checkout.session.completed` webhook runs `fulfillCheckout`, which is also
 * where the holds are finally released.
 */
export async function startCheckoutAction(input: {
  flightId: string;
  passengers: Array<{
    seatId: string;
    extraBaggageKg: number;
    fullName: string;
    passportNumber: string;
    nationality: string;
    dateOfBirth: string;
  }>;
}): Promise<CheckoutResult> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, reason: "unauthenticated", message: SIGN_IN_MESSAGE };
  }

  const parsed = checkoutRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      message: parsed.error.issues[0]?.message ?? "Check the passenger details.",
    };
  }
  const { flightId, passengers } = parsed.data;

  const seatIds = passengers.map((p) => p.seatId);
  if (new Set(seatIds).size !== seatIds.length) {
    return {
      ok: false,
      reason: "invalid",
      message: "Two passengers cannot share one seat.",
    };
  }

  const holds = new Set((await getUserHolds(flightId, userId)).map((h) => h.seatId));
  const lapsed = seatIds.filter((id) => !holds.has(id));
  if (lapsed.length > 0) {
    return {
      ok: false,
      reason: "expired",
      message: "Your seat hold has ended. Choose seats again to continue.",
    };
  }

  const seatRows = await loadSeatsForPricing(flightId, seatIds);
  if (seatRows.size !== seatIds.length) {
    return { ok: false, reason: "invalid", message: "A seat is not on this flight." };
  }

  const booked = await getBookedSeatIds(flightId);
  if (seatIds.some((id) => booked.includes(id))) {
    return {
      ok: false,
      reason: "unavailable",
      message: "One of those seats has just been booked. Choose another.",
    };
  }

  const quotes = passengers.map((p) => priceSeat(seatRows.get(p.seatId)!, p.extraBaggageKg));
  const totals = sumQuotes(quotes);

  // Send the browser back to the origin it is actually on, not to a fixed
  // public URL. Session cookies are host-scoped, so returning a traveller who
  // signed in on localhost to a tunnel domain shows them a signed-out page
  // even though their session is untouched. Allowlisted — see lib/app-origin.
  const origin = await resolveReturnOrigin();
  if (!origin) {
    console.error(
      "[checkout] no trusted return origin — set NEXT_PUBLIC_APP_URL (and optionally APP_ALLOWED_ORIGINS)",
    );
    return {
      ok: false,
      reason: "checkout_failed",
      message: "Payments are unavailable right now. Try again shortly.",
    };
  }

  const flightNumber = seatRows.get(seatIds[0])!.flightNumber;

  /**
   * Pre-fill the payer's email from their account.
   *
   * Stripe asks for an email at checkout, and a traveller retyping one they
   * have already given us is a traveller who can mistype it — a confirmation
   * addressed to "gamil.com" is accepted by SMTP, never bounces back to us,
   * and simply never arrives. Seeding the field from the signed-in account
   * removes that whole class of failure; Stripe still lets them change it if
   * the ticket is for someone else.
   *
   * Best-effort: if Clerk is unreachable, checkout proceeds and Stripe
   * collects the address itself, exactly as before.
   */
  let customerEmail: string | undefined;
  try {
    const user = await currentUser();
    customerEmail = user?.primaryEmailAddress?.emailAddress ?? undefined;
  } catch (error) {
    console.warn(
      `[checkout] could not read the account email: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: userId,
        // Omitted rather than sent empty: Stripe rejects a blank customer_email.
        ...(customerEmail ? { customer_email: customerEmail } : {}),
        line_items: quotes.flatMap((quote, index) => {
          const passengerLabel = `Passenger ${index + 1} · seat ${quote.seatNumber}`;

          return [
            {
              quantity: 1,
              price_data: {
                currency: CURRENCY,
                // Fare and cabin uplift billed as one line per passenger, so
                // the Stripe receipt matches the summary line for line.
                unit_amount: quote.fareCents,
                product_data: {
                  name: `${flightNumber} · ${passengerLabel}`,
                  description:
                    quote.seatSurchargeCents > 0
                      ? `${quote.seatClass} · includes ${formatCents(quote.seatSurchargeCents)} cabin surcharge · ${quote.allowanceKg}kg baggage`
                      : `${quote.seatClass} · ${quote.allowanceKg}kg baggage included`,
                },
              },
            },
            // Billed per kilo so the receipt shows the same arithmetic the
            // summary did, rather than one opaque "extras" line.
            ...(quote.extraBaggageKg > 0
              ? [
                  {
                    quantity: quote.extraBaggageKg,
                    price_data: {
                      currency: CURRENCY,
                      unit_amount: quote.perKgCents,
                      product_data: {
                        name: `Extra baggage · seat ${quote.seatNumber}`,
                        description: `Per kilo above the ${quote.allowanceKg}kg included allowance`,
                      },
                    },
                  },
                ]
              : []),
          ];
        }),
        metadata: encodeCheckoutMetadata({
          flightId,
          userId,
          passengers: passengers.map((passenger) => ({
            fullName: passenger.fullName,
            passportNumber: passenger.passportNumber.toUpperCase(),
            nationality: passenger.nationality.toUpperCase(),
            dateOfBirth: passenger.dateOfBirth,
            seatId: passenger.seatId,
            extraBaggageKg: passenger.extraBaggageKg,
          })),
        }),
        success_url: `${origin}/bookings/confirmed?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/flights/${flightId}?checkout=cancelled`,
      },
      // Two rapid clicks on "Continue to payment" must not create two sessions.
      // Keyed on the exact party and price, so a genuine change makes a new one.
      {
        idempotencyKey: `checkout:${userId}:${seatIds.slice().sort().join(",")}:${totals.grandTotalCents}`,
      },
    );

    if (!session.url) {
      return {
        ok: false,
        reason: "checkout_failed",
        message: "Stripe did not return a payment page. Try again.",
      };
    }

    console.info(
      `[checkout] session ${session.id} — ${totals.passengerCount} passenger(s), ` +
        `${centsToDecimal(totals.grandTotalCents)} ${CURRENCY.toUpperCase()}`,
    );

    return { ok: true, url: session.url };
  } catch (error) {
    console.error("[checkout] Stripe session creation failed", error);
    return {
      ok: false,
      reason: "checkout_failed",
      message: "We could not open the payment page. Your seats are still held — try again.",
    };
  }
}
