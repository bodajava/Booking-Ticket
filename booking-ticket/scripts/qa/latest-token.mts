/**
 * Prints the newest confirmed booking as `token<TAB>passengerName`, so browser
 * QA can assert the rendered page against the actual record rather than
 * against a guess at what a name looks like.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookings, passengers } from "../../db/schema.js";

const [booking] = await db
  .select({ id: bookings.id, pnr: bookings.pnr, token: bookings.verificationToken })
  .from(bookings)
  .where(eq(bookings.status, "CONFIRMED"))
  .orderBy(desc(bookings.createdAt))
  .limit(1);

if (!booking?.token) {
  console.error("no confirmed booking with a token");
  process.exit(1);
}

const [person] = await db
  .select({ fullName: passengers.fullName })
  .from(passengers)
  .where(eq(passengers.bookingId, booking.id))
  .limit(1);

console.log(`${booking.token}\t${person?.fullName ?? ""}\t${booking.pnr}`);
process.exit(0);
