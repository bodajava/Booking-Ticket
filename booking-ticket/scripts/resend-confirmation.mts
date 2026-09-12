/**
 * Re-send a confirmation email for a booking that already exists.
 *
 *   npm run email:resend -- <PNR> [recipient]
 *   npm run email:resend -- --failed        # every booking, newest first
 *
 * Exists because a send can fail after the money is taken: an expired Gmail app
 * password, a network blip, a mailbox that was full. The booking is confirmed
 * either way — the ticket is valid — but the traveller has nothing in their
 * inbox, and until now there was no way to give it to them.
 *
 * The recipient is recovered from Stripe rather than stored on the booking.
 * `bookings` deliberately holds no email address: it is not needed to fly, and
 * not keeping it means it cannot leak. Stripe already has it from checkout, so
 * that is where it is read from when a resend is actually required.
 */
import { desc, eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { bookings } from "../db/schema.js";
import { sendBookingConfirmation } from "../lib/email/send.js";
import { stripe } from "../lib/stripe.js";
import { verifyByToken } from "../lib/verification.js";

/** The address the traveller paid with, from the Checkout Session. */
async function recoverRecipient(paymentIntentId: string | null): Promise<string | null> {
  if (!paymentIntentId) return null;

  try {
    const sessions = await stripe.checkout.sessions.list({
      payment_intent: paymentIntentId,
      limit: 1,
    });
    const fromSession = sessions.data[0]?.customer_details?.email;
    if (fromSession) return fromSession;

    // Older sessions expire out of that listing; the charge keeps the address.
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
    const charge = intent.latest_charge;
    if (charge && typeof charge !== "string") {
      return charge.billing_details?.email ?? charge.receipt_email ?? null;
    }
  } catch (error) {
    console.error(
      `  could not reach Stripe for ${paymentIntentId}: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }

  return null;
}

async function resend(pnr: string, override?: string): Promise<boolean> {
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.pnr, pnr.toUpperCase()))
    .limit(1);

  if (!booking) {
    console.error(`  ${pnr}: no such booking`);
    return false;
  }

  if (booking.status === "CANCELLED") {
    console.error(`  ${pnr}: cancelled — not sending a boarding pass`);
    return false;
  }

  if (!booking.verificationToken) {
    console.error(`  ${pnr}: no verification token; run "npm run db:backfill-tokens" first`);
    return false;
  }

  const verified = await verifyByToken(booking.verificationToken);
  if (verified.outcome !== "found") {
    console.error(`  ${pnr}: token did not verify`);
    return false;
  }

  const to = override ?? (await recoverRecipient(booking.stripePaymentIntentId));
  if (!to) {
    console.error(`  ${pnr}: no address on the Stripe record — pass one explicitly`);
    return false;
  }

  const result = await sendBookingConfirmation({
    to,
    pass: verified.pass,
    verificationToken: booking.verificationToken,
  });

  if (result.sent) {
    console.log(`  ${pnr} -> ${to}  SENT`);
    return true;
  }

  console.error(`  ${pnr} -> ${to}  NOT SENT (${result.reason})`);
  return false;
}

/* ---------------------------------- main ---------------------------------- */

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("usage: npm run email:resend -- <PNR> [recipient]");
  console.error("       npm run email:resend -- --failed");
  process.exit(1);
}

if (args[0] === "--failed") {
  const recent = await db
    .select({ pnr: bookings.pnr })
    .from(bookings)
    .where(eq(bookings.status, "CONFIRMED"))
    .orderBy(desc(bookings.createdAt))
    .limit(20);

  console.log(`\n  re-sending ${recent.length} confirmed booking(s)\n`);
  let sent = 0;
  for (const booking of recent) {
    if (await resend(booking.pnr)) sent++;
  }
  console.log(`\n  ${sent}/${recent.length} sent\n`);
  process.exit(sent === recent.length ? 0 : 1);
}

const ok = await resend(args[0], args[1]);
process.exit(ok ? 0 : 1);
