/**
 * Renders the confirmation email to a file so it can be opened and checked.
 *
 *   npm run qa:email -- <PNR>
 *
 * Uses the same code path the webhook does, so what lands here is what a
 * traveller receives — including the QR image URL, which points at the running
 * app rather than being inlined.
 */
import { writeFileSync } from "node:fs";
import { desc, eq } from "drizzle-orm";

import { db } from "../../db/index.js";
import { bookings } from "../../db/schema.js";
import { bookingConfirmationHtml, bookingConfirmationText } from "../../lib/email/booking-confirmation.js";
import { verifyByToken } from "../../lib/verification.js";

const wanted = (process.argv[2] ?? "").toUpperCase();
const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const [booking] = wanted
  ? await db.select().from(bookings).where(eq(bookings.pnr, wanted)).limit(1)
  : await db
      .select()
      .from(bookings)
      .where(eq(bookings.status, "CONFIRMED"))
      .orderBy(desc(bookings.createdAt))
      .limit(1);

if (!booking?.verificationToken) {
  console.error("no booking with a verification token");
  process.exit(1);
}

const result = await verifyByToken(booking.verificationToken);
if (result.outcome !== "found") {
  console.error("token did not verify");
  process.exit(1);
}

const html = bookingConfirmationHtml({
  pass: result.pass,
  qrSrc: `${origin}/api/boarding-pass/${booking.verificationToken}/qr`,
  passUrl: `${origin}/bookings/${booking.pnr}`,
  verifyUrl: `${origin}/verify/${booking.verificationToken}`,
});

const out = process.argv[3] ?? "/tmp/aeroflow-confirmation.html";
writeFileSync(out, html);
writeFileSync(out.replace(/\.html$/, ".txt"), bookingConfirmationText({
    pass: result.pass,
    passUrl: `${origin}/bookings/${booking.pnr}`,
    verifyUrl: `${origin}/verify/${booking.verificationToken}`,
  }));

console.log(`  ${booking.pnr} -> ${out}`);
console.log(`  html ${html.length} bytes`);
console.log(`  QR is an <img src>: ${/<img src="http[^"]+\/qr"/.test(html)}`);
console.log(`  no data: URI images: ${!html.includes("src=\"data:")}`);
console.log(`  no PNR inside the QR URL: ${!/\/qr"/.test(html) || !html.match(/boarding-pass\/[^/]+\/qr/)?.[0].includes(booking.pnr)}`);
process.exit(0);
