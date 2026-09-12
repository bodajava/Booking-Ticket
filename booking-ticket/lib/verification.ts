import { randomBytes } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { airports, bookings, flights, passengers, seats } from "@/db/schema";
import { redis } from "./redis";

/**
 * Boarding-pass verification.
 *
 * The scan path is deliberately the narrowest thing in the app: an unguessable
 * token in, a fixed set of gate-relevant facts out. It is reachable without a
 * session — a gate agent holding a phone at a QR code has no account here —
 * so the only access control is the secret itself, and everything the response
 * contains is chosen on the assumption that whoever scanned it is standing in
 * front of the passenger.
 *
 * What is deliberately *never* returned: passport number, date of birth, the
 * Clerk user id, the amount paid, the Stripe ids, and the email address. None
 * of those help anyone check a boarding pass, and all of them would be a leak.
 */

/**
 * Crockford base32 — I, L, O and U are omitted so the alphabet has no pair a
 * human or an OCR pass could confuse (0/O, 1/I/L). The token normally travels
 * inside a QR code and is never typed, but a support agent reading one off a
 * screen should not be the thing that breaks it.
 */
const TOKEN_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const TOKEN_LENGTH = 32;

/**
 * 32 symbols from a 32-character alphabet — 160 bits.
 *
 * Generated with rejection sampling rather than `% 32`. The alphabet happens
 * to divide 256 evenly so modulo would be unbiased here, but writing it this
 * way means the property does not silently break if the alphabet is ever
 * edited.
 */
export function generateVerificationToken(): string {
  let token = "";
  while (token.length < TOKEN_LENGTH) {
    for (const byte of randomBytes(TOKEN_LENGTH)) {
      if (byte >= 256 - (256 % TOKEN_ALPHABET.length)) continue;
      token += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
      if (token.length === TOKEN_LENGTH) break;
    }
  }
  return token;
}

export const isWellFormedToken = (value: string) =>
  value.length === TOKEN_LENGTH && [...value].every((c) => TOKEN_ALPHABET.includes(c));

/* -------------------------------------------------------------------------- */
/*                                   Result                                   */
/* -------------------------------------------------------------------------- */

export type VerifiedPassenger = {
  fullName: string;
  seatNumber: string | null;
  seatClass: string | null;
  /** Included allowance plus anything bought, in kilos. */
  baggageAllowanceKg: number;
  extraBaggageKg: number;
};

export type VerifiedPass = {
  status: "valid" | "cancelled" | "flown";
  pnr: string;
  flightNumber: string;
  origin: { code: string; city: string };
  destination: { code: string; city: string };
  departureTime: Date;
  arrivalTime: Date;
  aircraft: string | null;
  passengers: VerifiedPassenger[];
};

export type VerificationOutcome =
  | { outcome: "found"; pass: VerifiedPass }
  | { outcome: "not_found" }
  | { outcome: "rate_limited" };

/* -------------------------------------------------------------------------- */
/*                                Rate limiting                               */
/* -------------------------------------------------------------------------- */

const SCAN_WINDOW_SECONDS = 60;
const SCAN_LIMIT = 20;

/**
 * Blunt the only attack this endpoint has: guessing tokens.
 *
 * 160 bits is not brute-forceable, so this is defence in depth rather than the
 * primary control — it exists so a script hammering the route is stopped before
 * it costs us a database round trip each time. Keyed per caller, and failures
 * are ignored: if Redis is unreachable, verifying a real boarding pass still
 * has to work.
 */
export async function allowScan(callerKey: string): Promise<boolean> {
  try {
    const key = `verify:rate:${callerKey}`;
    const hits = await redis.incr(key);
    if (hits === 1) await redis.expire(key, SCAN_WINDOW_SECONDS);
    return hits <= SCAN_LIMIT;
  } catch {
    return true;
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Lookup                                   */
/* -------------------------------------------------------------------------- */

const origin = alias(airports, "verify_origin");
const destination = alias(airports, "verify_destination");

/**
 * Resolve a scanned token into the facts a gate agent needs.
 *
 * One query for the booking and its flight, one for the passengers on it.
 * A malformed token is rejected before touching the database at all.
 */
export async function verifyByToken(token: string): Promise<VerificationOutcome> {
  if (!isWellFormedToken(token)) return { outcome: "not_found" };

  const [row] = await db
    .select({
      bookingId: bookings.id,
      pnr: bookings.pnr,
      status: bookings.status,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      originCode: origin.code,
      originCity: origin.city,
      destinationCode: destination.code,
      destinationCity: destination.city,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .innerJoin(origin, eq(flights.originId, origin.id))
    .innerJoin(destination, eq(flights.destinationId, destination.id))
    .where(eq(bookings.verificationToken, token))
    .limit(1);

  if (!row) return { outcome: "not_found" };

  const people = await db
    .select({
      fullName: passengers.fullName,
      extraBaggageKg: passengers.extraBaggageKg,
      seatNumber: seats.seatNumber,
      seatClass: seats.class,
      baggageAllowanceKg: seats.baggageAllowanceKg,
    })
    .from(passengers)
    .leftJoin(seats, eq(passengers.selectedSeatId, seats.id))
    .where(eq(passengers.bookingId, row.bookingId));

  return {
    outcome: "found",
    pass: {
      status:
        row.status === "CANCELLED"
          ? "cancelled"
          : row.arrivalTime.getTime() < Date.now()
            ? "flown"
            : "valid",
      pnr: row.pnr,
      flightNumber: row.flightNumber,
      origin: { code: row.originCode, city: row.originCity },
      destination: { code: row.destinationCode, city: row.destinationCity },
      departureTime: row.departureTime,
      arrivalTime: row.arrivalTime,
      aircraft: null,
      passengers: people.map((person) => ({
        fullName: person.fullName,
        seatNumber: person.seatNumber,
        seatClass: person.seatClass,
        baggageAllowanceKg: person.baggageAllowanceKg ?? 0,
        extraBaggageKg: person.extraBaggageKg,
      })),
    },
  };
}

/** The token for a booking its owner is looking at, for the web boarding pass. */
export async function getOwnedVerificationToken(
  pnr: string,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ token: bookings.verificationToken })
    .from(bookings)
    .where(
      and(eq(bookings.pnr, pnr), eq(bookings.userId, userId), ne(bookings.status, "CANCELLED")),
    )
    .limit(1);

  return row?.token ?? null;
}
