import type { SeatClass, SeatConfiguration } from "@/db/schema";

/**
 * Baggage entitlement per cabin. Extra-baggage pricing is per kilo over the
 * allowance and is stored as a decimal string to match `numeric(10,2)`.
 */
export const BAGGAGE_BY_CLASS: Record<
  SeatClass,
  { allowanceKg: number; extraPricePerKg: string }
> = {
  Business: { allowanceKg: 40, extraPricePerKg: "12.50" },
  Economy: { allowanceKg: 23, extraPricePerKg: "18.00" },
};

export type GeneratedSeat = {
  seatNumber: string;
  class: SeatClass;
  baggageAllowanceKg: number;
  extraBaggagePricePerKg: string;
};

/**
 * Expand an aircraft layout into the concrete seats for one flight.
 *
 * This is the operation `aircraft_layouts.seat_configuration` exists to
 * support: a cabin spanning rows 14-42 with columns A-F becomes 174 rows in
 * `seats`, numbered "14A" through "42F".
 */
export function generateSeats(config: SeatConfiguration): GeneratedSeat[] {
  const seats: GeneratedSeat[] = [];

  for (const cabin of config.cabins) {
    const baggage = BAGGAGE_BY_CLASS[cabin.class];

    for (let row = cabin.rowStart; row <= cabin.rowEnd; row++) {
      for (const column of cabin.columns) {
        seats.push({
          seatNumber: `${row}${column}`,
          class: cabin.class,
          baggageAllowanceKg: baggage.allowanceKg,
          extraBaggagePricePerKg: baggage.extraPricePerKg,
        });
      }
    }
  }

  return seats;
}

/** Seat count for a layout, without materialising every seat. */
export function countSeats(config: SeatConfiguration): number {
  return config.cabins.reduce(
    (total, cabin) =>
      total + (cabin.rowEnd - cabin.rowStart + 1) * cabin.columns.length,
    0,
  );
}
