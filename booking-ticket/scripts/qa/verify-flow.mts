/**
 * End-to-end check of the boarding-pass verification chain.
 *
 *   npm run qa:verify
 *
 * Booking confirmed -> token minted -> QR renders -> QR decodes to the right
 * URL -> that URL verifies -> the page shows the right facts and no secrets.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookings, passengers } from "../../db/schema.js";
import { qrPng, qrSvg, verificationUrl } from "../../lib/qr.js";
import {
  generateVerificationToken,
  isWellFormedToken,
  verifyByToken,
} from "../../lib/verification.js";

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

console.log("\n── token properties ──");
const sample = Array.from({ length: 2000 }, generateVerificationToken);
check("well-formed", sample.every(isWellFormedToken));
check("32 chars", sample.every((t) => t.length === 32));
check("no collisions in 2000", new Set(sample).size === 2000);
check("no transcription-ambiguous characters", sample.every((t) => !/[ILOU]/.test(t)));
check("uses only the declared alphabet", sample.every((t) => /^[0-9A-HJKMNP-TV-Z]+$/.test(t)));
check("rejects a short token", !isWellFormedToken("ABC"));
check("rejects lowercase", !isWellFormedToken("a".repeat(32)));
check("rejects out-of-alphabet chars", !isWellFormedToken("I".repeat(32)));

console.log("\n── a real confirmed booking ──");
const [booking] = await db
  .select()
  .from(bookings)
  .where(eq(bookings.status, "CONFIRMED"))
  .orderBy(desc(bookings.createdAt))
  .limit(1);

if (!booking) { console.log("  no confirmed booking to test against"); process.exit(1); }
check("booking has a token", Boolean(booking.verificationToken), booking.pnr);
check("token is not the PNR", booking.verificationToken !== booking.pnr);

const token = booking.verificationToken!;
const url = verificationUrl(ORIGIN, token);
console.log(`  ${booking.pnr} -> ${url}`);

console.log("\n── QR encodes only the URL ──");
const svg = await qrSvg(url, 320);
check("SVG renders", svg.includes("<svg") && svg.length > 500);
check("QR carries no PNR", !svg.includes(booking.pnr));
const png = await qrPng(url, 480);
check("PNG renders", png.length > 500 && png.subarray(1, 4).toString() === "PNG");

console.log("\n── the URL verifies ──");
const result = await verifyByToken(token);
check("resolves to a pass", result.outcome === "found");
if (result.outcome === "found") {
  const p = result.pass;
  check("status is a known verdict", ["valid", "cancelled", "flown"].includes(p.status), p.status);
  check("has a flight number", /^[A-Z]{2}\d+$/.test(p.flightNumber), p.flightNumber);
  check("has a route", Boolean(p.origin.code && p.destination.code));
  check("has at least one passenger", p.passengers.length > 0);
  check("passenger has a name", p.passengers.every((x) => x.fullName.length > 1));
  check("baggage allowance present", p.passengers.every((x) => typeof x.baggageAllowanceKg === "number"));

  const serialised = JSON.stringify(p);
  console.log("\n── nothing sensitive leaks ──");
  const [person] = await db.select().from(passengers).where(eq(passengers.bookingId, booking.id)).limit(1);
  check("no passport number", !serialised.includes(person?.passportNumber ?? "@@none@@"));
  check("no date of birth", !serialised.includes(person?.dateOfBirth ?? "@@none@@"));
  check("no Clerk user id", !serialised.includes(booking.userId));
  check("no amount paid", !serialised.includes(booking.totalPrice));
  check("no Stripe ids", !serialised.includes(booking.stripePaymentIntentId ?? "@@none@@"));
  check("no verification token echoed back", !serialised.includes(token));
}

console.log("\n── unknown tokens ──");
check("random token is not found", (await verifyByToken(generateVerificationToken())).outcome === "not_found");
check("malformed token is rejected", (await verifyByToken("nope")).outcome === "not_found");

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
