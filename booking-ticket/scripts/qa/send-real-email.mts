/**
 * Sends one real confirmation email through the production path.
 *
 *   npm run qa:email-real -- <recipient> [PNR]
 *
 * Uses `sendBookingConfirmation` — the exact function the Stripe webhook calls
 * — against a real booking, so what lands in the inbox is what a traveller
 * would receive. Deliberately a separate, explicitly-invoked script rather than
 * part of the automated suite: the other email tests hit a local sink so they
 * never send anything to a real mailbox.
 */
import { desc, eq } from "drizzle-orm";

import { db } from "../../db/index.js";
import { bookings } from "../../db/schema.js";
import { sendBookingConfirmation } from "../../lib/email/send.js";
import { verifyByToken } from "../../lib/verification.js";

const recipient = process.argv[2];
const wanted = (process.argv[3] ?? "").toUpperCase();

if (!recipient?.includes("@")) {
  console.error("usage: npm run qa:email-real -- <recipient> [PNR]");
  process.exit(1);
}

const [booking] = wanted
  ? await db.select().from(bookings).where(eq(bookings.pnr, wanted)).limit(1)
  : await db
      .select()
      .from(bookings)
      .where(eq(bookings.status, "CONFIRMED"))
      .orderBy(desc(bookings.createdAt))
      .limit(1);

if (!booking?.verificationToken) {
  console.error("no confirmed booking with a verification token");
  process.exit(1);
}

const verified = await verifyByToken(booking.verificationToken);
if (verified.outcome !== "found") {
  console.error("token did not verify");
  process.exit(1);
}

console.log(`  booking   ${booking.pnr} — ${verified.pass.origin.city} to ${verified.pass.destination.city}`);
console.log(`  recipient ${recipient}`);
console.log(`  QR target ${process.env.NEXT_PUBLIC_APP_URL}/verify/${booking.verificationToken.slice(0, 6)}…`);

const result = await sendBookingConfirmation({
  to: recipient,
  pass: verified.pass,
  verificationToken: booking.verificationToken,
});

if (result.sent) {
  console.log(`\n  SENT — message id ${result.id}`);
  process.exit(0);
}

console.error(`\n  NOT SENT — ${result.reason}`);
process.exit(1);
