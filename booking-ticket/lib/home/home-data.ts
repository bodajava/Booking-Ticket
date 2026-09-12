import { and, asc, eq, gte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { airports, flights } from "@/db/schema";
import { CABIN_FARE_MULTIPLIER, decimalToCents } from "@/lib/pricing";
import { DESTINATIONS, type DestinationCopy } from "./destinations";

/**
 * Everything the landing page needs, read from the real catalogue.
 *
 * The cards look editorial, but the numbers on them are not: "from $420" is
 * the cheapest Economy fare actually on sale to that airport, and the search
 * button's count is the number of departures a traveller could book right now.
 * A marketing page that quotes a price the booking engine will not honour is
 * worse than one with no price at all.
 */

const origin = alias(airports, "home_origin");
const destination = alias(airports, "home_destination");

export type FeaturedDestination = DestinationCopy & {
  /** Cheapest Economy fare in cents, or `null` when nothing is scheduled. */
  fromCents: number | null;
  airportCode: string;
  country: string;
};

export type AirportOption = { code: string; city: string; name: string };

export type HomeData = {
  destinations: FeaturedDestination[];
  airports: AirportOption[];
  /** Bookable departures from now on — the number beside "Search". */
  flightCount: number;
};

export async function getHomeData(): Promise<HomeData> {
  const now = new Date();

  const [cheapest, airportRows, [counted]] = await Promise.all([
    // One row per arrival airport with its lowest base fare.
    db
      .select({
        code: destination.code,
        country: destination.country,
        minBasePrice: sql<string>`min(${flights.basePrice})`.as("min_base_price"),
      })
      .from(flights)
      .innerJoin(destination, eq(flights.destinationId, destination.id))
      .where(gte(flights.departureTime, now))
      .groupBy(destination.code, destination.country),

    db
      .select({ code: airports.code, city: airports.city, name: airports.name })
      .from(airports)
      .orderBy(asc(airports.city)),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(flights)
      .where(gte(flights.departureTime, now)),
  ]);

  const byCode = new Map(cheapest.map((row) => [row.code, row]));

  const destinations: FeaturedDestination[] = DESTINATIONS.map((copy) => {
    const real = byCode.get(copy.code);

    return {
      ...copy,
      airportCode: copy.code,
      country: real?.country ?? "",
      fromCents: real
        ? Math.round(decimalToCents(real.minBasePrice) * CABIN_FARE_MULTIPLIER.Economy)
        : null,
    };
  })
    // A card promising a city we do not fly to would be a lie.
    .filter((entry) => entry.fromCents !== null);

  return {
    destinations,
    airports: airportRows,
    flightCount: counted?.count ?? 0,
  };
}

/** Departures matching a route/date filter — powers the search button's count. */
export async function countMatchingFlights(filter: {
  originCode?: string;
  destinationCode?: string;
  date?: string;
}): Promise<number> {
  const conditions = [gte(flights.departureTime, new Date())];

  if (filter.originCode) conditions.push(eq(origin.code, filter.originCode));
  if (filter.destinationCode) conditions.push(eq(destination.code, filter.destinationCode));
  if (filter.date) {
    conditions.push(sql`(${flights.departureTime} AT TIME ZONE 'UTC')::date = ${filter.date}::date`);
  }

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(flights)
    .innerJoin(origin, eq(flights.originId, origin.id))
    .innerJoin(destination, eq(flights.destinationId, destination.id))
    .where(and(...conditions));

  return row?.count ?? 0;
}
