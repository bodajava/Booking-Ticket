import { redis } from "./redis";

/**
 * Cross-instance seat availability events, over Upstash Redis pub/sub.
 *
 * Why pub/sub and not an in-process EventEmitter: a broadcast that lives in one
 * Node process only reaches the browsers connected to *that* process. The moment
 * the app runs on more than one instance — which is the normal case on any
 * serverless or autoscaled deployment — half the viewers stop receiving updates
 * and nobody notices until two people book the same seat. Redis is already the
 * lock's source of truth and is shared by every instance, so it is also the
 * right place for the fan-out.
 *
 * Payloads carry seat ids and nothing else. These messages reach every browser
 * watching the flight, including signed-out ones, so a user id or passenger
 * name in here would be a data leak. Who holds a seat is deliberately not
 * knowable from the stream — only *that* it is held.
 */

export const SEAT_EVENT_CHANNEL_PREFIX = "seat:events:";

export const seatEventChannel = (flightId: string) =>
  `${SEAT_EVENT_CHANNEL_PREFIX}${flightId}`;

export type SeatEventType = "held" | "released" | "booked";

export type SeatEvent = {
  type: SeatEventType;
  /** Always a list, so a multi-seat booking is one message rather than N. */
  seatIds: string[];
  /** Publisher clock, for debugging only — never used for ordering. */
  at: number;
};

/**
 * Announce a change to a flight's seat availability.
 *
 * Fire-and-forget by design: a booking must not fail because the notification
 * bus is unreachable. Subscribers reconcile against the authoritative snapshot
 * on connect and on a timer, so a dropped message costs latency, not accuracy.
 */
export async function publishSeatEvent(
  flightId: string,
  type: SeatEventType,
  seatIds: string[],
): Promise<void> {
  if (seatIds.length === 0) return;

  try {
    await redis.publish(seatEventChannel(flightId), {
      type,
      seatIds,
      at: Date.now(),
    } satisfies SeatEvent);
  } catch (error) {
    console.error(`[seat-events] publish ${type} failed for ${flightId}`, error);
  }
}

/**
 * Narrow an untrusted pub/sub payload into a `SeatEvent`.
 *
 * Upstash deserializes JSON for us, but the channel is shared infrastructure:
 * anything that can reach the Redis database can put a message on it. Shape is
 * checked before the value is allowed anywhere near a client.
 */
export function parseSeatEvent(message: unknown): SeatEvent | null {
  if (typeof message !== "object" || message === null) return null;

  const candidate = message as Partial<SeatEvent>;
  if (
    candidate.type !== "held" &&
    candidate.type !== "released" &&
    candidate.type !== "booked"
  ) {
    return null;
  }

  if (!Array.isArray(candidate.seatIds)) return null;
  const seatIds = candidate.seatIds.filter((id): id is string => typeof id === "string");
  if (seatIds.length === 0) return null;

  return { type: candidate.type, seatIds, at: Number(candidate.at) || Date.now() };
}
