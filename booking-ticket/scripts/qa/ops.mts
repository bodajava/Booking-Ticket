/** QA helpers driven from the two-session realtime test. */
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { seats } from "../../db/schema.js";
import { redis } from "../../lib/redis.js";
import { getLockedSeatsForFlight } from "../../lib/seat-lock.js";
import { fulfillCheckout, releaseHeldSeats } from "../../lib/fulfillment.js";
import { publishSeatEvent } from "../../lib/seat-events.js";
import { getBookedSeatIds } from "../../lib/seat-availability.js";

const FID = process.env.QA_FLIGHT ?? "7da3695c-304d-443d-85e0-d98f45d73e5d";
const [op, arg] = process.argv.slice(2);

/** A seat nobody has bought yet, so repeat runs do not collide. */
const firstUnbookedSeat = async () => {
  const booked = new Set(await getBookedSeatIds(FID));
  const held = new Set(await getLockedSeatsForFlight(FID));
  const all = await db.select().from(seats).where(eq(seats.flightId, FID));
  return all
    .filter((s) => s.class === "Economy" && !booked.has(s.id) && !held.has(s.id))
    .sort((a, b) => a.seatNumber.localeCompare(b.seatNumber))
    .at(-1);
};

const seatByNumber = async (n: string) => {
  const [s] = await db.select().from(seats).where(and(eq(seats.flightId, FID), eq(seats.seatNumber, n)));
  return s;
};

if (op === "holdshort") {
  /**
   * Create a genuinely short-lived hold, written exactly the way `holdSeat`
   * writes one: lock key TTL and index score set together to the same instant,
   * then the same "held" event the Server Action publishes.
   *
   * This is the honest way to exercise expiry. Shortening an existing hold
   * after the fact does not work — the live stream already scheduled its wake
   * from the original deadline, and production never moves a deadline.
   */
  const s = await seatByNumber(arg);
  const ttlMs = Number(process.argv[4] ?? 6000);
  const expiresAt = Date.now() + ttlMs;
  await redis.set(`seat:lock:${FID}:${s!.id}`, "user_qa_shortlived", { px: ttlMs });
  await redis.zadd(`seat:locks:${FID}`, { score: expiresAt, member: s!.id });
  await publishSeatEvent(FID, "held", [s!.id]);
  console.log(`short hold ${arg} (${s!.id}) for ${ttlMs}ms`);
} else if (op === "expire") {
  // Collapse a live hold so expiry happens now instead of in 10 minutes.
  //
  // Both halves must move together. `holdSeat` writes the lock key's TTL and
  // the index's expiry score in one script; shortening only the key would
  // leave the index claiming the seat is held for another ten minutes, which
  // is not a state production can produce and would make this a bogus test.
  const s = await seatByNumber(arg);
  const ttl = Number(process.argv[4] ?? 12000);
  const expiresAt = Date.now() + ttl;
  await redis.pexpire(`seat:lock:${FID}:${s!.id}`, ttl);
  await redis.zadd(`seat:locks:${FID}`, { score: expiresAt, member: s!.id });
  console.log(`expiring ${arg} (${s!.id}) at ${expiresAt}`);
} else if (op === "book") {
  // The exact path the Stripe webhook takes on a confirmed payment.
  const s = arg ? await seatByNumber(arg) : await firstUnbookedSeat();
  const result = await fulfillCheckout({
    eventId: `evt_qa_rt_${Date.now()}`,
    flightId: FID,
    userId: "user_qa_realtime",
    totalPrice: "700.00",
    stripePaymentIntentId: `pi_qa_rt_${Date.now()}`,
    passengers: [{ fullName: "Realtime QA", passportNumber: `Z${Date.now() % 1000000}`, seatId: s!.id }],
  });
  if (result.status === "created") await releaseHeldSeats(FID, result.seatIds, "user_qa_realtime");
  console.log(`book ${s!.seatNumber} -> ${result.status}`);
  console.log(`SEAT=${s!.seatNumber}`);
} else if (op === "urls") {
  const { stripe } = await import("../../lib/stripe.js");
  const s2 = await stripe.checkout.sessions.retrieve(arg);
  console.log(`success_url ${s2.success_url}`);
  console.log(`cancel_url ${s2.cancel_url}`);
} else if (op === "webhook") {
  /**
   * Deliver the `checkout.session.completed` event Stripe would send for a
   * real session, correctly signed. Card entry cannot be driven headlessly
   * (Stripe's fields are cross-origin iframes behind hCaptcha), so this stands
   * in for the payment step only — signature verification, metadata parsing,
   * the fulfillment transaction and the hold release are all the real code.
   */
  const { createHmac } = await import("node:crypto");
  const { stripe } = await import("../../lib/stripe.js");
  const session = await stripe.checkout.sessions.retrieve(arg);
  const event = {
    id: `evt_qa_${Date.now()}`,
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: Math.floor(Date.now() / 1000),
    type: "checkout.session.completed",
    data: { object: { ...session, payment_status: "paid", status: "complete",
                      payment_intent: `pi_qa_${Date.now()}` } },
  };
  const payload = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET!).update(`${ts}.${payload}`).digest("hex");
  const res = await fetch("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${ts},v1=${sig}` },
    body: payload,
  });
  console.log(`webhook -> ${res.status} ${await res.text()}`);
} else if (op === "clear") {
  const held = await getLockedSeatsForFlight(FID);
  for (const id of held) await redis.del(`seat:lock:${FID}:${id}`);
  await redis.del(`seat:locks:${FID}`);
  console.log(`cleared ${held.length} hold(s)`);
}
process.exit(0);
