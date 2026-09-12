/**
 * Seeds the flight catalogue: airports, aircraft layouts, flights, and the
 * seats those flights expose.
 *
 * Idempotent — every insert is ON CONFLICT DO NOTHING against the schema's
 * unique indexes, so re-running tops up missing rows instead of duplicating.
 *
 *   npm run db:seed              3 days of departures
 *   npm run db:seed -- --days=14
 *   npm run db:seed -- --reset   wipe catalogue + bookings first
 *
 * Destination guides are seeded separately by `npm run db:seed-guides`,
 * because embedding them costs money.
 */
import { sql } from "drizzle-orm";

import { db } from "../db/index.js";
import {
  aircraftLayouts, airports, bookings, flights, seats,
  type SeatConfiguration,
} from "../db/schema.js";
import { countSeats, generateSeats } from "../lib/seats.js";

const args = process.argv.slice(2);
const DAYS = Number(args.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 3);
const RESET = args.includes("--reset");

/* ------------------------------------------------------------------ data */

const AIRPORTS = [
  { code: "CAI", name: "Cairo International Airport", city: "Cairo", country: "Egypt" },
  { code: "DXB", name: "Dubai International Airport", city: "Dubai", country: "United Arab Emirates" },
  { code: "IST", name: "Istanbul Airport", city: "Istanbul", country: "Turkey" },
  { code: "NBO", name: "Jomo Kenyatta International Airport", city: "Nairobi", country: "Kenya" },
  { code: "BKK", name: "Suvarnabhumi Airport", city: "Bangkok", country: "Thailand" },
  { code: "LIS", name: "Humberto Delgado Airport", city: "Lisbon", country: "Portugal" },
  { code: "LHR", name: "Heathrow Airport", city: "London", country: "United Kingdom" },
  { code: "CDG", name: "Charles de Gaulle Airport", city: "Paris", country: "France" },
  { code: "JFK", name: "John F. Kennedy International Airport", city: "New York", country: "United States" },
  { code: "DOH", name: "Hamad International Airport", city: "Doha", country: "Qatar" },
  { code: "FRA", name: "Frankfurt Airport", city: "Frankfurt", country: "Germany" },
  { code: "AMS", name: "Amsterdam Airport Schiphol", city: "Amsterdam", country: "Netherlands" },
];

/** Row 13 is skipped throughout, and column I is never used — both standard. */
const LAYOUTS: Array<{ aircraftModel: string; seatConfiguration: SeatConfiguration }> = [
  {
    aircraftModel: "Airbus A320neo",
    seatConfiguration: { cabins: [
      { class: "Business", rowStart: 1, rowEnd: 3, columns: ["A", "C", "D", "F"], aislesAfter: ["C"] },
      { class: "Economy", rowStart: 14, rowEnd: 42, columns: ["A", "B", "C", "D", "E", "F"], aislesAfter: ["C"] },
    ] },
  },
  {
    aircraftModel: "Boeing 787-9 Dreamliner",
    seatConfiguration: { cabins: [
      { class: "Business", rowStart: 1, rowEnd: 8, columns: ["A", "C", "D", "G"], aislesAfter: ["A", "D"] },
      { class: "Economy", rowStart: 20, rowEnd: 46, columns: ["A", "B", "C", "D", "E", "F", "G", "H", "J"], aislesAfter: ["C", "F"] },
    ] },
  },
  {
    aircraftModel: "Airbus A350-900",
    seatConfiguration: { cabins: [
      { class: "Business", rowStart: 1, rowEnd: 9, columns: ["A", "C", "D", "G"], aislesAfter: ["A", "D"] },
      { class: "Economy", rowStart: 20, rowEnd: 52, columns: ["A", "B", "C", "D", "E", "F", "G", "H", "J"], aislesAfter: ["C", "F"] },
    ] },
  },
];

type Route = {
  flightNumber: string; origin: string; destination: string;
  departureHour: number; departureMinute: number;
  durationMinutes: number; basePrice: string; aircraft: string;
};

const ROUTES: Route[] = [
  { flightNumber: "MS985", origin: "CAI", destination: "DXB", departureHour: 8, departureMinute: 0, durationMinutes: 210, basePrice: "450.00", aircraft: "Airbus A320neo" },
  { flightNumber: "MS986", origin: "DXB", destination: "CAI", departureHour: 13, departureMinute: 30, durationMinutes: 240, basePrice: "450.00", aircraft: "Airbus A320neo" },
  { flightNumber: "TK694", origin: "IST", destination: "CAI", departureHour: 9, departureMinute: 15, durationMinutes: 125, basePrice: "320.00", aircraft: "Airbus A320neo" },
  { flightNumber: "TK695", origin: "CAI", destination: "IST", departureHour: 12, departureMinute: 20, durationMinutes: 135, basePrice: "320.00", aircraft: "Airbus A320neo" },
  { flightNumber: "TP1234", origin: "LIS", destination: "CAI", departureHour: 10, departureMinute: 0, durationMinutes: 310, basePrice: "540.00", aircraft: "Airbus A320neo" },
  { flightNumber: "BA779", origin: "LHR", destination: "IST", departureHour: 7, departureMinute: 45, durationMinutes: 230, basePrice: "410.00", aircraft: "Airbus A320neo" },
  { flightNumber: "EK927", origin: "DXB", destination: "NBO", departureHour: 4, departureMinute: 30, durationMinutes: 305, basePrice: "620.00", aircraft: "Boeing 787-9 Dreamliner" },
  { flightNumber: "EK928", origin: "NBO", destination: "DXB", departureHour: 10, departureMinute: 35, durationMinutes: 285, basePrice: "620.00", aircraft: "Boeing 787-9 Dreamliner" },
  { flightNumber: "TG505", origin: "BKK", destination: "DXB", departureHour: 1, departureMinute: 20, durationMinutes: 400, basePrice: "700.00", aircraft: "Boeing 787-9 Dreamliner" },
  { flightNumber: "KL643", origin: "AMS", destination: "NBO", departureHour: 21, departureMinute: 15, durationMinutes: 505, basePrice: "760.00", aircraft: "Boeing 787-9 Dreamliner" },
  { flightNumber: "QR8", origin: "DOH", destination: "LHR", departureHour: 2, departureMinute: 5, durationMinutes: 435, basePrice: "890.00", aircraft: "Airbus A350-900" },
  { flightNumber: "AF23", origin: "CDG", destination: "JFK", departureHour: 10, departureMinute: 30, durationMinutes: 500, basePrice: "980.00", aircraft: "Airbus A350-900" },
  { flightNumber: "LH500", origin: "FRA", destination: "JFK", departureHour: 13, departureMinute: 45, durationMinutes: 520, basePrice: "910.00", aircraft: "Airbus A350-900" },
];

/* --------------------------------------------------------------- helpers */

/** Postgres caps a statement at 65535 bind parameters; chunk well under it. */
async function insertInChunks<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

/* ------------------------------------------------------------------ seed */

if (RESET) {
  console.log("  --reset: deleting bookings, flights, layouts, airports (guides kept)");
  await db.delete(bookings);   // passengers cascade
  await db.delete(flights);    // seats cascade
  await db.delete(aircraftLayouts);
  await db.delete(airports);
}

await db.insert(airports).values(AIRPORTS).onConflictDoNothing();
const airportRows = await db.select().from(airports);
const airportByCode = new Map(airportRows.map((a) => [a.code, a]));
console.log(`  airports          ${airportRows.length}`);

await db.insert(aircraftLayouts).values(
  LAYOUTS.map((l) => ({ ...l, totalSeats: countSeats(l.seatConfiguration) })),
).onConflictDoNothing();
const layoutRows = await db.select().from(aircraftLayouts);
const layoutByModel = new Map(layoutRows.map((l) => [l.aircraftModel, l]));
for (const l of layoutRows) console.log(`  layout            ${l.aircraftModel.padEnd(24)} ${l.totalSeats} seats`);

// Departures start tomorrow at 00:00 UTC so seeded flights are always future-dated.
const day0 = new Date();
day0.setUTCHours(0, 0, 0, 0);
day0.setUTCDate(day0.getUTCDate() + 1);

let newFlights = 0, newSeats = 0, skipped = 0;

for (let day = 0; day < DAYS; day++) {
  for (const route of ROUTES) {
    const origin = airportByCode.get(route.origin);
    const destination = airportByCode.get(route.destination);
    const layout = layoutByModel.get(route.aircraft);
    if (!origin || !destination || !layout) throw new Error(`bad route ${route.flightNumber}`);

    const departureTime = new Date(day0);
    departureTime.setUTCDate(day0.getUTCDate() + day);
    departureTime.setUTCHours(route.departureHour, route.departureMinute, 0, 0);
    const arrivalTime = new Date(departureTime.getTime() + route.durationMinutes * 60_000);

    const [flight] = await db.insert(flights).values({
      flightNumber: route.flightNumber,
      originId: origin.id, destinationId: destination.id,
      aircraftLayoutId: layout.id,
      departureTime, arrivalTime, basePrice: route.basePrice,
    }).onConflictDoNothing().returning();

    if (!flight) { skipped++; continue; }   // already seeded for this departure
    newFlights++;

    const generated = generateSeats(layout.seatConfiguration);
    await insertInChunks(generated, 800, (chunk) =>
      db.insert(seats).values(chunk.map((s) => ({ ...s, flightId: flight.id }))).onConflictDoNothing(),
    );
    newSeats += generated.length;
  }
  process.stdout.write(`\r  flights           ${newFlights} created, ${newSeats} seats…`);
}

console.log(`\r  flights           ${newFlights} created${skipped ? `, ${skipped} already present` : ""}          `);
console.log(`  seats             ${newSeats} created`);

/* --------------------------------------------------------------- summary */

const totals = await db.execute(sql`
  SELECT (SELECT count(*) FROM airports) AS airports,
         (SELECT count(*) FROM aircraft_layouts) AS layouts,
         (SELECT count(*) FROM flights) AS flights,
         (SELECT count(*) FROM seats) AS seats,
         (SELECT count(*) FROM destination_guides) AS guides`);
/** `execute` yields `{ rows }` over the pool and a bare array over HTTP. */
type CountRow = Record<"airports" | "layouts" | "flights" | "seats" | "guides", string>;
const result = totals as unknown as { rows?: CountRow[] } & CountRow[];
const t: CountRow = result.rows?.[0] ?? result[0];
console.log(`\n  totals — airports=${t.airports} layouts=${t.layouts} flights=${t.flights} seats=${t.seats} guides=${t.guides}`);
process.exit(0);
