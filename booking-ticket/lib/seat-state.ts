/**
 * How a seat's visual state is decided, in one pure function shared by the
 * server render and the live client.
 *
 * It has to be shared. The page renders an initial state on the server, then
 * the browser recomputes it every time an availability event lands; if the two
 * used different rules the map would flicker between them on the first update.
 */

export type SeatState = "available" | "held" | "booked" | "selected";

/**
 * Precedence: booked > selected > held > available.
 *
 * `booked` outranks everything because a confirmed booking has been paid for.
 * A stale lock over a sold seat must never render as bookable, and the sale
 * must win even over the caller's own hold — if your hold somehow overlaps a
 * seat that sold, the seat is gone and the UI should say so.
 */
export function resolveSeatState(
  seatId: string,
  booked: ReadonlySet<string>,
  held: ReadonlySet<string>,
  mySeatId: string | null,
): SeatState {
  if (booked.has(seatId)) return "booked";
  if (seatId === mySeatId) return "selected";
  if (held.has(seatId)) return "held";
  return "available";
}
