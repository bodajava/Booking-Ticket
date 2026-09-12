import { z } from "zod";

import type { SeatClass } from "@/db/schema";

/**
 * Every price in this file is computed in integer cents and only formatted at
 * the edges. `numeric(10,2)` values arrive from Drizzle as decimal *strings*,
 * so parsing them into floats and multiplying would drift — 18.00 * 3 is not
 * reliably 54.00 in binary floating point.
 *
 * The client renders these numbers, but never produces them: the seat map
 * sends a seat id and a kilo count, and the server recomputes the total from
 * the database row before it reaches Stripe.
 */

/**
 * Fare uplift per cabin, applied to `flights.base_price`.
 *
 * The schema prices a flight, not a cabin — `flights.base_price` is a single
 * value and `seats` carries no fare column — so the Business/Economy
 * difference has to live somewhere. It lives here, as one named constant,
 * rather than being scattered through the UI. Changing the commercial rule is
 * a one-line edit; moving it into the database is a migration.
 */
export const CABIN_FARE_MULTIPLIER: Record<SeatClass, number> = {
  Economy: 1,
  Business: 2.5,
};

/** Most extra baggage a passenger can buy in one booking. */
export const MAX_EXTRA_BAGGAGE_KG = 32;

/** Baggage is sold whole-kilo; the stepper and the slider share this step. */
export const EXTRA_BAGGAGE_STEP_KG = 1;

export const CURRENCY = "usd";

/* -------------------------------------------------------------------------- */
/*                                    Money                                   */
/* -------------------------------------------------------------------------- */

/**
 * Parse a `numeric(10,2)` string into cents.
 *
 * Rounds rather than truncates so a value that arrives as "18.005" from a
 * wider numeric column cannot silently lose a cent.
 */
export function decimalToCents(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Not a numeric value: ${JSON.stringify(value)}`);
  }
  return Math.round(parsed * 100);
}

/** Cents back to the decimal string `numeric(10,2)` expects. */
export function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Cents to a display string, e.g. 45000 -> "$450.00". */
export function formatCents(cents: number, currency: string = CURRENCY): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/* -------------------------------------------------------------------------- */
/*                                   Quoting                                  */
/* -------------------------------------------------------------------------- */

export type QuoteInput = {
  /** `flights.base_price`, a decimal string. */
  basePrice: string;
  seatClass: SeatClass;
  /** `seats.extra_baggage_price_per_kg`, a decimal string. */
  extraBaggagePricePerKg: string;
  /** Kilos *above* the seat's included allowance. */
  extraBaggageKg: number;
};

export type Quote = {
  /** What every passenger on this flight pays before cabin and baggage. */
  baseFareCents: number;
  /** The cabin uplift, shown as its own line rather than folded into the fare. */
  seatSurchargeCents: number;
  /** baseFare + surcharge. */
  fareCents: number;
  baggageCents: number;
  totalCents: number;
  extraBaggageKg: number;
  /** Per-kilo rate in cents, so the UI can show "$18.00 / kg" without re-parsing. */
  perKgCents: number;
};

/**
 * The authoritative price for one seat plus its extra baggage.
 *
 * The cabin uplift is returned separately from the base fare because the
 * summary shows them as separate lines. A traveller looking at a Business
 * total is entitled to see *why* it differs from the headline fare, rather
 * than being handed one number that silently includes it.
 */
export function quoteSeat(input: QuoteInput): Quote {
  const extraBaggageKg = normalizeExtraBaggageKg(input.extraBaggageKg);
  const perKgCents = decimalToCents(input.extraBaggagePricePerKg);

  const baseFareCents = decimalToCents(input.basePrice);
  const fareCents = Math.round(baseFareCents * CABIN_FARE_MULTIPLIER[input.seatClass]);
  const seatSurchargeCents = fareCents - baseFareCents;
  const baggageCents = perKgCents * extraBaggageKg;

  return {
    baseFareCents,
    seatSurchargeCents,
    fareCents,
    baggageCents,
    totalCents: fareCents + baggageCents,
    extraBaggageKg,
    perKgCents,
  };
}

/* -------------------------------------------------------------------------- */
/*                            Whole-booking totals                            */
/* -------------------------------------------------------------------------- */

export type BookingTotals = {
  baseFareCents: number;
  seatSurchargeCents: number;
  baggageCents: number;
  grandTotalCents: number;
  passengerCount: number;
};

/** Sum a party's quotes into the figures the fare summary shows. */
export function sumQuotes(quotes: Quote[]): BookingTotals {
  return quotes.reduce<BookingTotals>(
    (totals, quote) => ({
      baseFareCents: totals.baseFareCents + quote.baseFareCents,
      seatSurchargeCents: totals.seatSurchargeCents + quote.seatSurchargeCents,
      baggageCents: totals.baggageCents + quote.baggageCents,
      grandTotalCents: totals.grandTotalCents + quote.totalCents,
      passengerCount: totals.passengerCount + 1,
    }),
    {
      baseFareCents: 0,
      seatSurchargeCents: 0,
      baggageCents: 0,
      grandTotalCents: 0,
      passengerCount: 0,
    },
  );
}

/**
 * Clamp a kilo count to something sellable.
 *
 * Deliberately total rather than throwing: a slider that arrives at 33kg from
 * a stale client should be quoted at 32kg, not crash the summary. Input that
 * is structurally wrong (a string, NaN) is rejected by the zod schema below
 * before it ever gets here.
 */
export function normalizeExtraBaggageKg(kg: number): number {
  if (!Number.isFinite(kg)) return 0;
  const stepped = Math.round(kg / EXTRA_BAGGAGE_STEP_KG) * EXTRA_BAGGAGE_STEP_KG;
  return Math.min(Math.max(stepped, 0), MAX_EXTRA_BAGGAGE_KG);
}

/** Wire-level validation for anything a client sends us. */
export const extraBaggageKgSchema = z
  .number()
  .int("Baggage is sold in whole kilos")
  .min(0, "Baggage cannot be negative")
  .max(MAX_EXTRA_BAGGAGE_KG, `Up to ${MAX_EXTRA_BAGGAGE_KG}kg of extra baggage`);

/** How many people one booking may cover. */
export const MAX_PASSENGERS = 4;
