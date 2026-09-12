/**
 * Integration check for lib/seat-lock.ts against the real Upstash database.
 *
 *   npm run check:locks
 *
 * Covers the concurrency guarantees the booking flow depends on: mutual
 * exclusion between two users, TTL refresh on re-hold, ownership-safe release,
 * and the index/PTTL reads that drive the seat map and the countdown. Uses a
 * throwaway flight id, so it is safe to run against a live database.
 */
import {
  getLockedSeatsForFlight, getOwnedHold, getUserHold, holdSeat, releaseSeat,
} from "../lib/seat-lock.js";

const F = "test-flight-" + Date.now();
const A = "seat-A", B = "seat-B";
const alice = "user_alice", bob = "user_bob";
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

check("alice holds A", await holdSeat(F, A, alice) === true);
check("bob cannot take A", await holdSeat(F, A, bob) === false);
check("alice re-holds A (refresh)", await holdSeat(F, A, alice) === true);

const h = await getUserHold(F, alice);
check("getUserHold finds A", h?.seatId === A, JSON.stringify(h));
const ttl = h ? h.expiresAt - Date.now() : 0;
check("TTL within 10min window", ttl > 594_000 && ttl <= 600_000, `ttl=${ttl}`);

check("getUserHold(bob) is null", await getUserHold(F, bob) === null);
check("getOwnedHold(alice,A) set", (await getOwnedHold(F, A, alice))?.seatId === A);
check("getOwnedHold(bob,A) null", await getOwnedHold(F, A, bob) === null);
check("getOwnedHold unheld seat null", await getOwnedHold(F, B, alice) === null);

check("bob holds B", await holdSeat(F, B, bob) === true);
const locked = await getLockedSeatsForFlight(F);
check("index lists both", locked.length === 2 && locked.includes(A) && locked.includes(B), JSON.stringify(locked));
check("getUserHold(bob) now finds B", (await getUserHold(F, bob))?.seatId === B);

check("bob cannot release A", await releaseSeat(F, A, bob) === false);
check("alice releases A", await releaseSeat(F, A, alice) === true);
check("getUserHold(alice) null after release", await getUserHold(F, alice) === null);
check("index now only B", (await getLockedSeatsForFlight(F)).length === 1);

await releaseSeat(F, B, bob);
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
