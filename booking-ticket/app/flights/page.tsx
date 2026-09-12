import { and, asc, eq, gte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import Link from "next/link";

import { db } from "@/db";
import { aircraftLayouts, airports, flights } from "@/db/schema";
import { CABIN_FARE_MULTIPLIER, decimalToCents, formatCents } from "@/lib/pricing";

/** Departure boards go stale by the minute; never cache this. */
export const dynamic = "force-dynamic";

const origin = alias(airports, "origin_airports");
const destination = alias(airports, "destination_airports");

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export default async function FlightsPage({ searchParams }: PageProps<"/flights">) {
  // The landing-page search hands its filters over as query parameters, so a
  // search is a shareable URL rather than throwaway component state.
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };

  const from = one("from")?.toUpperCase();
  const to = one("to")?.toUpperCase();
  const date = one("date");
  const cabin = one("cabin");

  const conditions = [gte(flights.departureTime, new Date())];
  if (from && /^[A-Z]{3}$/.test(from)) conditions.push(eq(origin.code, from));
  if (to && /^[A-Z]{3}$/.test(to)) conditions.push(eq(destination.code, to));
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    conditions.push(sql`(${flights.departureTime} AT TIME ZONE 'UTC')::date = ${date}::date`);
  }

  const rows = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      basePrice: flights.basePrice,
      aircraftModel: aircraftLayouts.aircraftModel,
      originCode: origin.code,
      originCity: origin.city,
      destinationCode: destination.code,
      destinationCity: destination.city,
    })
    .from(flights)
    .innerJoin(origin, eq(flights.originId, origin.id))
    .innerJoin(destination, eq(flights.destinationId, destination.id))
    .leftJoin(aircraftLayouts, eq(flights.aircraftLayoutId, aircraftLayouts.id))
    .where(and(...conditions))
    .orderBy(asc(flights.departureTime))
    .limit(40);

  return (
    <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-10 sm:px-8 sm:py-14">
      <span className="eyebrow">Departures</span>
      <h1 className="mt-3 font-display text-[2.75rem] italic leading-[1.04] tracking-[-0.02em] text-bone sm:text-[3.5rem]">
        Where to next
      </h1>

      {from || to || date || cabin ? (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {[
            from ? `From ${from}` : null,
            to ? `To ${to}` : null,
            date ? `On ${date}` : null,
            cabin ? cabin : null,
          ]
            .filter((label): label is string => label !== null)
            .map((label) => (
              <span
                key={label}
                className="rounded-pill border border-amber/40 bg-amber-soft px-[14px] py-[7px] text-[12px] font-medium text-bone"
              >
                {label}
              </span>
            ))}
          <Link
            href="/flights"
            className="rounded-pill border border-outline px-[14px] py-[7px] text-[12px] text-bone-50 transition-colors duration-200 hover:text-bone"
          >
            Clear filters
          </Link>
        </div>
      ) : null}

      {rows.length === 0 ? (
        from || to || date ? (
          <p className="mt-10 text-[13px] leading-[1.6] text-bone-50">
            No departures match that search. Try another date or route, or{" "}
            <Link href="/flights" className="text-amber underline underline-offset-2">
              see every departure
            </Link>
            .
          </p>
        ) : (
          <p className="mt-10 text-[13px] leading-[1.6] text-bone-50">
            No departures are scheduled. Seed the catalogue with{" "}
            <code className="rounded-sm bg-[rgba(236,230,220,0.06)] px-1.5 py-0.5 font-mono text-[0.9em]">
              npm run db:seed
            </code>
            .
          </p>
        )
      ) : (
        <ul className="mt-10 flex flex-col">
          {rows.map((row) => {
            const fromCents = Math.round(
              decimalToCents(row.basePrice) * CABIN_FARE_MULTIPLIER.Economy,
            );
            const minutes = Math.round(
              (row.arrivalTime.getTime() - row.departureTime.getTime()) / 60_000,
            );

            return (
              <li key={row.id}>
                <Link
                  href={`/flights/${row.id}`}
                  className="group flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-hairline py-5 transition-colors duration-200 hover:bg-[rgba(217,122,44,0.06)]"
                >
                  <span className="numeric w-[68px] shrink-0 text-[12px] text-bone-50">
                    {row.flightNumber}
                  </span>

                  <span className="min-w-[210px] flex-1 text-[15px] text-bone">
                    {row.originCity}{" "}
                    <span className="text-bone-50" aria-hidden="true">
                      →
                    </span>{" "}
                    <span className="sr-only">to</span>
                    {row.destinationCity}
                    <span className="numeric ml-2 text-[11px] text-bone-50">
                      {row.originCode}–{row.destinationCode}
                    </span>
                  </span>

                  <span className="numeric text-[13px] text-bone">
                    {TIME.format(row.departureTime)}
                    <span className="text-bone-50"> – {TIME.format(row.arrivalTime)}</span>
                  </span>

                  <span className="numeric w-[70px] text-[12px] text-bone-50">
                    {Math.floor(minutes / 60)}h {String(minutes % 60).padStart(2, "0")}m
                  </span>

                  <span className="numeric w-[92px] text-[12px] text-bone-50">
                    {DATE.format(row.departureTime)}
                  </span>

                  <span className="numeric ml-auto text-[15px] text-bone">
                    {formatCents(fromCents)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
