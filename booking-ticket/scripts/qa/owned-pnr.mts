/** Newest confirmed booking belonging to a given Clerk user id. */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookings } from "../../db/schema.js";

const [row] = await db
  .select({ pnr: bookings.pnr })
  .from(bookings)
  .where(and(eq(bookings.userId, process.argv[2]), eq(bookings.status, "CONFIRMED")))
  .orderBy(desc(bookings.createdAt))
  .limit(1);

console.log(row?.pnr ?? "");
process.exit(row ? 0 : 1);
