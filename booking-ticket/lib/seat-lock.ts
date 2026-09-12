import { redis } from "./redis";

/**
 * Atomic seat holds, backed by Redis.
 *
 * Two keys per flight:
 *
 *   `seat:lock:{flightId}:{seatId}` -> userId, with a real Redis TTL.
 *       The authoritative record of who holds a seat. It expires on its own,
 *       so a crashed checkout can never strand a seat.
 *
 *   `seat:locks:{flightId}` -> sorted set of seatId scored by expiry (ms).
 *       A queryable index so the seat map can be drawn in one round trip
 *       instead of SCAN-ing the keyspace. Purely derived: if it were lost,
 *       holds would still be correct and only the UI would degrade.
 *
 * Every mutation runs inside a Lua script, so the read-then-write in
 * `holdSeat` cannot interleave with a competing request.
 */

/** How long a seat stays held while the user completes checkout. */
export const SEAT_HOLD_TTL_SECONDS = 600;

const SEAT_HOLD_TTL_MS = SEAT_HOLD_TTL_SECONDS * 1000;

/** Index outlives the longest hold it contains, so it is never dropped early. */
const INDEX_TTL_MS = SEAT_HOLD_TTL_MS + 60_000;

const lockKey = (flightId: string, seatId: string) =>
  `seat:lock:${flightId}:${seatId}`;

const indexKey = (flightId: string) => `seat:locks:${flightId}`;

/* -------------------------------------------------------------------------- */
/*                                Lua scripts                                 */
/* -------------------------------------------------------------------------- */

/**
 * Take the seat unless someone else holds it. Re-holding your own seat is
 * allowed and refreshes the TTL, so a page reload does not lose the seat.
 * Returns 1 when held, 0 when another user has it.
 */
const holdScript = redis.createScript<number>(`
  local lock_key  = KEYS[1]
  local index_key = KEYS[2]
  local user_id   = ARGV[1]
  local seat_id   = ARGV[2]
  local ttl_ms    = tonumber(ARGV[3])
  local now_ms    = tonumber(ARGV[4])

  local owner = redis.call('GET', lock_key)
  if owner and owner ~= user_id then
    return 0
  end

  redis.call('SET', lock_key, user_id, 'PX', ttl_ms)
  redis.call('ZADD', index_key, now_ms + ttl_ms, seat_id)
  redis.call('PEXPIRE', index_key, tonumber(ARGV[5]))
  return 1
`);

/**
 * Compare-and-delete: only the holder can release. Returns 1 when released,
 * 0 when the seat is unheld or held by someone else.
 */
const releaseScript = redis.createScript<number>(`
  local lock_key  = KEYS[1]
  local index_key = KEYS[2]
  local user_id   = ARGV[1]
  local seat_id   = ARGV[2]

  if redis.call('GET', lock_key) ~= user_id then
    return 0
  end

  redis.call('DEL', lock_key)
  redis.call('ZREM', index_key, seat_id)
  return 1
`);

/**
 * Drop members whose hold has lapsed, then return what remains. The purge
 * keeps the index bounded without a background job.
 */
const listScript = redis.createScript<string[]>(`
  local index_key = KEYS[1]
  local now_ms    = ARGV[1]

  redis.call('ZREMRANGEBYSCORE', index_key, '-inf', now_ms)
  return redis.call('ZRANGE', index_key, 0, -1)
`);

/* -------------------------------------------------------------------------- */
/*                                 Public API                                 */
/* -------------------------------------------------------------------------- */

/**
 * Hold `seatId` on `flightId` for `userId` for {@link SEAT_HOLD_TTL_SECONDS}.
 *
 * @returns `true` if the caller now holds the seat (including when they
 *   already held it, in which case the hold is extended), `false` if another
 *   user holds it.
 */
export async function holdSeat(
  flightId: string,
  seatId: string,
  userId: string,
): Promise<boolean> {
  const now = Date.now();

  const held = await holdScript.exec(
    [lockKey(flightId, seatId), indexKey(flightId)],
    [
      userId,
      seatId,
      String(SEAT_HOLD_TTL_MS),
      String(now),
      String(INDEX_TTL_MS),
    ],
  );

  return Number(held) === 1;
}

/**
 * Release `seatId` only if `userId` is the current holder.
 *
 * @returns `true` if this call released the seat, `false` if it was already
 *   free, already expired, or held by someone else.
 */
export async function releaseSeat(
  flightId: string,
  seatId: string,
  userId: string,
): Promise<boolean> {
  const released = await releaseScript.exec(
    [lockKey(flightId, seatId), indexKey(flightId)],
    [userId, seatId],
  );

  return Number(released) === 1;
}

/**
 * Every seat currently held on `flightId`, for rendering the seat map.
 *
 * Ownership is deliberately not returned — the map only needs to know which
 * seats are unavailable, and leaking user ids to other passengers would be a
 * privacy problem.
 */
export async function getLockedSeatsForFlight(
  flightId: string,
): Promise<string[]> {
  const seatIds = await listScript.exec([indexKey(flightId)], [
    String(Date.now()),
  ]);

  // Upstash deserializes responses, which can coerce id-shaped strings.
  // Normalising here keeps the return type honest.
  return (seatIds ?? []).map(String);
}

/* -------------------------------------------------------------------------- */
/*                          Reading back your own hold                        */
/* -------------------------------------------------------------------------- */

/**
 * Find the seat `userId` currently holds on `flightId`, with the real
 * remaining TTL.
 *
 * This is what makes the countdown survive a page reload. The client cannot be
 * trusted to remember when its own hold started — and must not be, since a
 * tampered timer would let a seat look held after Redis has already released
 * it. Every render asks Redis instead, and the number the browser counts down
 * from is always `PTTL` on the authoritative key.
 *
 * The scan walks the flight's lock index, which only ever contains seats with
 * a live hold (a handful during checkout), not the whole cabin. Purging
 * expired members first keeps that true. One round trip, one atomic script.
 */
export type SeatHold = {
  seatId: string;
  /** Epoch milliseconds. */
  expiresAt: number;
};

const userHoldScript = redis.createScript<[string, number] | null>(`
  local index_key = KEYS[1]
  local prefix    = ARGV[1]
  local user_id   = ARGV[2]
  local now_ms    = ARGV[3]

  redis.call('ZREMRANGEBYSCORE', index_key, '-inf', now_ms)
  local seat_ids = redis.call('ZRANGE', index_key, 0, -1)

  for i = 1, #seat_ids do
    local lock_key = prefix .. seat_ids[i]
    if redis.call('GET', lock_key) == user_id then
      local pttl = redis.call('PTTL', lock_key)
      if pttl > 0 then
        return { seat_ids[i], pttl }
      end
    end
  end

  return nil
`);

export async function getUserHold(
  flightId: string,
  userId: string,
): Promise<SeatHold | null> {
  const held = await userHoldScript.exec(
    [indexKey(flightId)],
    [`seat:lock:${flightId}:`, userId, String(Date.now())],
  );

  if (!held) return null;

  const [seatId, ttlMs] = held;
  return { seatId: String(seatId), expiresAt: Date.now() + Number(ttlMs) };
}

/**
 * Every seat `userId` holds on `flightId`.
 *
 * A party of four needs four simultaneous holds, so the single-hold read above
 * is not enough on its own. Same one-round-trip scan, returning a flat
 * `[seatId, ttl, seatId, ttl, …]` array because Lua cannot return a map.
 */
const userHoldsScript = redis.createScript<(string | number)[]>(`
  local index_key = KEYS[1]
  local prefix    = ARGV[1]
  local user_id   = ARGV[2]
  local now_ms    = ARGV[3]

  redis.call('ZREMRANGEBYSCORE', index_key, '-inf', now_ms)
  local seat_ids = redis.call('ZRANGE', index_key, 0, -1)

  local out = {}
  for i = 1, #seat_ids do
    local lock_key = prefix .. seat_ids[i]
    if redis.call('GET', lock_key) == user_id then
      local pttl = redis.call('PTTL', lock_key)
      if pttl > 0 then
        out[#out + 1] = seat_ids[i]
        out[#out + 1] = pttl
      end
    end
  end

  return out
`);

export async function getUserHolds(
  flightId: string,
  userId: string,
): Promise<SeatHold[]> {
  const flat = await userHoldsScript.exec(
    [indexKey(flightId)],
    [`seat:lock:${flightId}:`, userId, String(Date.now())],
  );

  const now = Date.now();
  const holds: SeatHold[] = [];

  for (let i = 0; i + 1 < (flat?.length ?? 0); i += 2) {
    holds.push({ seatId: String(flat![i]), expiresAt: now + Number(flat![i + 1]) });
  }

  return holds;
}

/**
 * The soonest expiry among a party's holds, or `null` when they hold nothing.
 *
 * The countdown shows one number for the whole booking, and the honest number
 * is the earliest — that is when the party stops being complete.
 */
export function earliestExpiry(holds: SeatHold[]): number | null {
  if (holds.length === 0) return null;
  return holds.reduce((min, hold) => Math.min(min, hold.expiresAt), Infinity);
}

/**
 * Remaining hold on one specific seat, but only for its owner.
 *
 * Returns `null` when the seat is unheld, expired, or held by someone else —
 * the three cases checkout must refuse, collapsed into one falsy answer so a
 * caller cannot accidentally treat "someone else has it" as success.
 */
export async function getOwnedHold(
  flightId: string,
  seatId: string,
  userId: string,
): Promise<SeatHold | null> {
  const key = lockKey(flightId, seatId);

  const [owner, ttlMs] = await Promise.all([
    redis.get<string>(key),
    redis.pttl(key),
  ]);

  if (owner === null || String(owner) !== userId || ttlMs <= 0) return null;

  return { seatId, expiresAt: Date.now() + ttlMs };
}

/**
 * When the soonest-expiring hold on `flightId` lapses, in epoch milliseconds,
 * or `null` when nothing is held.
 *
 * Key expiry is the one seat transition Redis cannot announce: a lock that
 * simply times out fires no message, and keyspace notifications are not
 * something this app can rely on being enabled. Rather than poll on a blind
 * interval, the live stream reads the next real deadline out of the index
 * (which is scored by expiry) and wakes up exactly then. With no holds
 * outstanding there is no timer at all.
 */
export async function getNextHoldExpiry(flightId: string): Promise<number | null> {
  const key = indexKey(flightId);

  await redis.zremrangebyscore(key, "-inf", Date.now());
  const next = await redis.zrange<(string | number)[]>(key, 0, 0, { withScores: true });

  // Shape is [member, score]; an empty index yields [].
  const score = next?.[1];
  return score === undefined ? null : Number(score);
}
