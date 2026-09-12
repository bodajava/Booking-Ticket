import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getFlightView } from "@/lib/flight-view";
import { quoteSeat } from "@/lib/pricing";
import { SEAT_HOLD_TTL_SECONDS } from "@/lib/seat-lock";
import type { SerializableQuote } from "./actions";
import { SeatSelection } from "./seat-selection";

/**
 * Seat selection for one flight.
 *
 * Rendered per request, never cached: the cabin mixes Redis holds that expire
 * on their own clock with Postgres bookings that can land at any moment, so a
 * cached seat map would be wrong almost immediately.
 */
export const dynamic = "force-dynamic";

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

export default async function FlightPage({ params }: PageProps<"/flights/[flightId]">) {
  const { flightId } = await params;
  const { userId } = await auth();

  const flight = await getFlightView(flightId, userId);
  if (!flight) notFound();

  // If holds survived a reload, the summary needs the same fares the actions
  // would have quoted. Recomputed here from each seat's own row rather than
  // trusting anything the browser kept.
  const seatsById = new Map(
    flight.cabins
      .flatMap((c) => c.rows.flatMap((r) => r.seats))
      .filter((s) => s !== null)
      .map((s) => [s!.id, s!]),
  );

  const initialQuotes: SerializableQuote[] = flight.holds.flatMap((hold) => {
    const seat = seatsById.get(hold.seatId);
    if (!seat) return [];

    return [
      {
        ...quoteSeat({
          basePrice: flight.basePrice,
          seatClass: seat.class,
          extraBaggagePricePerKg: seat.extraBaggagePricePerKg,
          extraBaggageKg: 0,
        }),
        seatId: seat.id,
        seatNumber: seat.seatNumber,
        seatClass: seat.class,
        allowanceKg: seat.baggageAllowanceKg,
      },
    ];
  });

  const durationMinutes = Math.round(
    (flight.arrivalTime.getTime() - flight.departureTime.getTime()) / 60_000,
  );

  return (
    <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-10 sm:px-8 sm:py-14">
      <Link
        href="/flights"
        className="text-[12px] font-medium text-bone-50 transition-colors duration-200 hover:text-bone"
      >
        ← All flights
      </Link>

      <header className="mt-5 border-b border-hairline pb-8">
        <span className="eyebrow">
          {flight.flightNumber}
          {flight.aircraftModel ? ` · ${flight.aircraftModel}` : ""}
        </span>

        {/* DESIGN.MD §3: the display face, italic, is the brand's voice. The
            route is the one thing on this page worth setting at that size. */}
        <h1 className="mt-3 font-display text-[2.75rem] italic leading-[1.04] tracking-[-0.02em] text-bone sm:text-[3.5rem]">
          {flight.origin.city} to {flight.destination.city}
        </h1>

        <div className="mt-5 flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <Fact label={flight.origin.code} value={TIME.format(flight.departureTime)} />
          <Fact label={flight.destination.code} value={TIME.format(flight.arrivalTime)} />
          <Fact
            label="Duration"
            value={`${Math.floor(durationMinutes / 60)}h ${String(durationMinutes % 60).padStart(2, "0")}m`}
          />
          <Fact label="Departs" value={DATE.format(flight.departureTime)} />
        </div>
      </header>

      <div className="mt-10">
        <SeatSelection
          flight={flight}
          holdTtlMs={SEAT_HOLD_TTL_SECONDS * 1000}
          initialQuotes={initialQuotes}
          isSignedIn={Boolean(userId)}
        />
      </div>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="eyebrow">{label}</span>
      <p className="numeric mt-1 text-[15px] text-bone">{value}</p>
    </div>
  );
}
