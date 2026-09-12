/**
 * Give bookings made before the QR feature a scannable token.
 *
 *   npm run db:backfill-tokens
 *
 * Idempotent — only touches rows where the column is still null, so it is safe
 * to run repeatedly and safe to run again after a partial failure.
 */
import { eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookings } from "../db/schema.js";
import { generateVerificationToken } from "../lib/verification.js";

const pending = await db
  .select({ id: bookings.id, pnr: bookings.pnr })
  .from(bookings)
  .where(isNull(bookings.verificationToken));

if (pending.length === 0) {
  console.log("  every booking already has a verification token");
} else {
  // One token per row, matched by primary key. Updating on the `is null`
  // predicate instead would write the same token to every remaining row and
  // trip the unique index on the second one.
  for (const booking of pending) {
    await db
      .update(bookings)
      .set({ verificationToken: generateVerificationToken() })
      .where(eq(bookings.id, booking.id));
  }
  console.log(`  backfilled ${pending.length} booking(s): ${pending.map((b) => b.pnr).join(", ")}`);
}
process.exit(0);
