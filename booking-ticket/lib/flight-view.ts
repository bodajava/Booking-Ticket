import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import type { Seat, SeatClass, SeatConfiguration } from "@/db/schema";
import { aircraftLayouts, airports, flights, seats } from "@/db/schema";
import { getAvailabilitySnapshot, type AvailabilitySnapshot } from "./seat-availability";
import { getUserHolds, type SeatHold } from "./seat-lock";

/**
 * Assembles everything one flight page needs, in one place.
 *
 * Note what a `SeatView` deliberately does *not* carry: its state. The cabin
 * shape is static for the life of the flight, but availability changes while
 * the page is open — another traveller takes a seat, a hold lapses, a booking
 * confirms. Baking a state into the server render would mean a reload was the
 * only way to see any of that. The shape is rendered once; availability
 * arrives as data and is resolved per render by `resolveSeatState`.
 */

export type SeatView = {
  id: string;
  seatNumber: string;
  row: number;
  column: string;
  class: SeatClass;
  baggageAllowanceKg: number;
  extraBaggagePricePerKg: string;
  isWindow: boolean;
  isAisle: boolean;
};

export type CabinRow = {
  row: number;
  /** Aligned index-for-index to `CabinView.columns`; `null` is a gap. */
  seats: (SeatView | null)[];
};

export type CabinView = {
  class: SeatClass;
  columns: string[];
  /** Columns with an aisle immediately to their right. */
  aislesAfter: string[];
  rows: CabinRow[];
  baggageAllowanceKg: number;
};

export type FlightView = {
  id: string;
  flightNumber: string;
  departureTime: Date;
  arrivalTime: Date;
  basePrice: string;
  aircraftModel: string | null;
  origin: { code: string; city: string; name: string };
  destination: { code: string; city: string; name: string };
  cabins: CabinView[];
  /**
   * The signed-in traveller's live holds, straight from Redis `PTTL`.
   * A party of four holds four seats, so this is a list.
   */
  holds: SeatHold[];
  /**
   * Availability at render time. The client uses it to paint the first frame,
   * then replaces it wholesale with what the live stream sends.
   */
  snapshot: AvailabilitySnapshot;
  totalSeats: number;
};

/* -------------------------------------------------------------------------- */
/*                                   Queries                                  */
/* -------------------------------------------------------------------------- */

// `flights` joins `airports` twice, so each side needs its own alias.
const originAirports = alias(airports, "origin_airports");
const destinationAirports = alias(airports, "destination_airports");

/**
 * Load one flight as the seat map sees it.
 *
 * `userId` is the *server's* idea of who is asking — never a client-supplied
 * value — so the "selected" state cannot be painted onto someone else's hold.
 * Returns `null` when the flight does not exist, which the page turns into a
 * 404 rather than an empty cabin.
 */
export async function getFlightView(
  flightId: string,
  userId: string | null,
): Promise<FlightView | null> {
  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      basePrice: flights.basePrice,
      seatConfiguration: aircraftLayouts.seatConfiguration,
      aircraftModel: aircraftLayouts.aircraftModel,
      originCode: originAirports.code,
      originCity: originAirports.city,
      originName: originAirports.name,
      destinationCode: destinationAirports.code,
      destinationCity: destinationAirports.city,
      destinationName: destinationAirports.name,
    })
    .from(flights)
    .innerJoin(originAirports, eq(flights.originId, originAirports.id))
    .innerJoin(destinationAirports, eq(flights.destinationId, destinationAirports.id))
    .leftJoin(aircraftLayouts, eq(flights.aircraftLayoutId, aircraftLayouts.id))
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) return null;

  const [seatRows, snapshot, holds] = await Promise.all([
    db.select().from(seats).where(eq(seats.flightId, flightId)).orderBy(asc(seats.seatNumber)),
    getAvailabilitySnapshot(flightId),
    userId ? getUserHolds(flightId, userId) : Promise.resolve([]),
  ]);

  const cabins = buildCabins({ configuration: flight.seatConfiguration, seatRows });

  const totalSeats = cabins
    .flatMap((c) => c.rows.flatMap((r) => r.seats))
    .filter((s): s is SeatView => s !== null).length;

  return {
    id: flight.id,
    flightNumber: flight.flightNumber,
    departureTime: flight.departureTime,
    arrivalTime: flight.arrivalTime,
    basePrice: flight.basePrice,
    aircraftModel: flight.aircraftModel,
    origin: { code: flight.originCode, city: flight.originCity, name: flight.originName },
    destination: {
      code: flight.destinationCode,
      city: flight.destinationCity,
      name: flight.destinationName,
    },
    cabins,
    holds,
    snapshot,
    totalSeats,
  };
}

/* -------------------------------------------------------------------------- */
/*                              Cabin assembly                                */
/* -------------------------------------------------------------------------- */

/**
 * Fold the flat `seats` rows back into the grid `seat_configuration` describes.
 *
 * The database stores seats as an unordered bag keyed by seat number; the cabin
 * shape — which columns exist, where the aisles fall, which rows are skipped —
 * only exists in the layout JSON. Walking the layout (rather than the seat
 * rows) is what makes a missing seat render as a gap in the fuselage instead of
 * silently collapsing the row and shifting every seat left of it.
 */
function buildCabins(input: {
  configuration: SeatConfiguration | null;
  seatRows: Seat[];
}): CabinView[] {
  const { configuration, seatRows } = input;
  if (!configuration) return [];

  const byNumber = new Map(seatRows.map((s) => [s.seatNumber, s]));

  return configuration.cabins.map((cabin) => {
    const columns = cabin.columns;
    const aislesAfter = cabin.aislesAfter ?? [];
    const firstColumn = columns[0];
    const lastColumn = columns[columns.length - 1];

    // A seat is on an aisle if it sits either side of one.
    const aisleColumns = new Set<string>();
    for (const column of aislesAfter) {
      const index = columns.indexOf(column);
      if (index === -1) continue;
      aisleColumns.add(column);
      const next = columns[index + 1];
      if (next) aisleColumns.add(next);
    }

    const rows: CabinRow[] = [];
    for (let row = cabin.rowStart; row <= cabin.rowEnd; row++) {
      rows.push({
        row,
        seats: columns.map((column) => {
          const seat = byNumber.get(`${row}${column}`);
          if (!seat) return null;

          return {
            id: seat.id,
            seatNumber: seat.seatNumber,
            row,
            column,
            class: seat.class,
            baggageAllowanceKg: seat.baggageAllowanceKg,
            extraBaggagePricePerKg: seat.extraBaggagePricePerKg,
            isWindow: column === firstColumn || column === lastColumn,
            isAisle: aisleColumns.has(column),
          } satisfies SeatView;
        }),
      });
    }

    return {
      class: cabin.class,
      columns,
      aislesAfter,
      rows,
      // Every seat in a cabin carries the same allowance (see lib/seats.ts),
      // so the first real seat is representative for the cabin header.
      baggageAllowanceKg:
        rows.flatMap((r) => r.seats).find((s) => s !== null)?.baggageAllowanceKg ?? 0,
    } satisfies CabinView;
  });
}

