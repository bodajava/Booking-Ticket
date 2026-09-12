import { and, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { bookings, passengers } from "@/db/schema";
import { getLockedSeatsForFlight } from "./seat-lock";

/** Seat ids confirmed sold in Postgres. A cancelled booking frees its seat. */
export async function getBookedSeatIds(flightId: string): Promise<string[]> {
  const rows = await db
    .select({ seatId: passengers.selectedSeatId })
    .from(passengers)
    .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
    .where(and(eq(bookings.flightId, flightId), ne(bookings.status, "CANCELLED")));

  return rows.map((r) => r.seatId).filter((id): id is string => id !== null);
}

/**
 * The public availability of a flight's cabin.
 *
 * This is the shape every client reconciles against — the initial server
 * render, the reconnect fetch, and the periodic safety check in the live
 * stream all produce it from the same two authoritative sources. Nothing
 * user-identifying appears in it, because it is served to anyone who can see
 * the seat map.
 */
export type AvailabilitySnapshot = {
  /** Confirmed in Postgres. Permanent. */
  bookedSeatIds: string[];
  /** Live Redis holds, whoever owns them. Transient. */
  heldSeatIds: string[];
  /** Server clock when the snapshot was taken, in epoch milliseconds. */
  at: number;
};

export async function getAvailabilitySnapshot(
  flightId: string,
): Promise<AvailabilitySnapshot> {
  // Read together so the two halves describe the same instant as closely as
  // possible; a hold that becomes a booking in between is simply reported as
  // both, and `booked` wins when the client resolves seat state.
  const [bookedSeatIds, heldSeatIds] = await Promise.all([
    getBookedSeatIds(flightId),
    getLockedSeatsForFlight(flightId),
  ]);

  return { bookedSeatIds, heldSeatIds, at: Date.now() };
}

/** True when two snapshots describe the same availability, order-insensitively. */
export function snapshotsMatch(
  a: AvailabilitySnapshot,
  b: AvailabilitySnapshot,
): boolean {
  const same = (x: string[], y: string[]) =>
    x.length === y.length && new Set(x).size === new Set([...x, ...y]).size;

  return same(a.bookedSeatIds, b.bookedSeatIds) && same(a.heldSeatIds, b.heldSeatIds);
}
