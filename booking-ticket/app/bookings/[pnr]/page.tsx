import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { db } from "@/db";
import { airports, bookings, flights, passengers, seats } from "@/db/schema";
import { getDefaultAppOrigin } from "@/lib/app-origin";
import { formatCents } from "@/lib/pricing";
import { decimalToCents } from "@/lib/pricing";
import { qrSvg, verificationUrl } from "@/lib/qr";
import { LuggageIcon } from "@/app/flights/[flightId]/icons";

/**
 * The customer's boarding pass.
 *
 * Unlike the verification page this one *is* behind a session and scoped to the
 * owner — it shows the booking to the person who paid for it, so it can carry
 * the full record. The QR code on it is the same code the confirmation email
 * carries, and scanning it lands on the public verification page.
 */
export const dynamic = "force-dynamic";

const origin = alias(airports, "pass_origin");
const destination = alias(airports, "pass_destination");

export default async function BoardingPassPage({ params }: PageProps<"/bookings/[pnr]">) {
  const { pnr } = await params;
  const { userId } = await auth();

  if (!userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(`/bookings/${pnr}`)}`);
  }

  const [row] = await db
    .select({
      id: bookings.id,
      pnr: bookings.pnr,
      status: bookings.status,
      totalPrice: bookings.totalPrice,
      verificationToken: bookings.verificationToken,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      originCode: origin.code,
      originCity: origin.city,
      destinationCode: destination.code,
      destinationCity: destination.city,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .innerJoin(origin, eq(flights.originId, origin.id))
    .innerJoin(destination, eq(flights.destinationId, destination.id))
    // Ownership is part of the query, not a check afterwards: there is no code
    // path here that can read someone else's booking and then decide not to.
    .where(and(eq(bookings.pnr, pnr.toUpperCase()), eq(bookings.userId, userId)))
    .limit(1);

  if (!row) notFound();

  const travellers = await db
    .select({
      fullName: passengers.fullName,
      extraBaggageKg: passengers.extraBaggageKg,
      seatNumber: seats.seatNumber,
      seatClass: seats.class,
      baggageAllowanceKg: seats.baggageAllowanceKg,
    })
    .from(passengers)
    .leftJoin(seats, eq(passengers.selectedSeatId, seats.id))
    .where(eq(passengers.bookingId, row.id));

  const appOrigin = getDefaultAppOrigin();
  const qr =
    row.verificationToken && appOrigin
      ? await qrSvg(verificationUrl(appOrigin, row.verificationToken), 320)
      : null;

  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  return (
    <main className="mx-auto w-full max-w-[560px] flex-1 px-4 py-10 sm:px-6 sm:py-14">
      <Link
        href="/flights"
        className="text-[12px] font-medium text-bone-50 transition-colors duration-200 hover:text-bone"
      >
        ← All flights
      </Link>

      <span className="eyebrow mt-6 block">Boarding pass</span>
      <h1 className="mt-3 font-display text-[2.25rem] italic leading-[1.04] tracking-[-0.02em] text-bone sm:text-[2.75rem]">
        {row.originCity} to {row.destinationCity}
      </h1>

      <section className="mt-8 overflow-hidden rounded-lg border border-hairline bg-stage-lift shadow-card">
        <div className="flex items-center justify-between gap-3 px-5 py-5 sm:px-7">
          <div>
            <p className="numeric text-[1.75rem] leading-none text-bone">{row.originCode}</p>
            <p className="mt-[6px] text-[12px] text-bone-50">{time.format(row.departureTime)}</p>
          </div>
          <div className="flex flex-1 flex-col items-center gap-1">
            <span className="numeric text-[11px] text-bone-50">{row.flightNumber}</span>
            <span aria-hidden="true" className="h-px w-full bg-hairline" />
          </div>
          <div className="text-right">
            <p className="numeric text-[1.75rem] leading-none text-bone">
              {row.destinationCode}
            </p>
            <p className="mt-[6px] text-[12px] text-bone-50">{time.format(row.arrivalTime)}</p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 border-t border-hairline px-5 py-6 sm:px-7">
          <Fact label="Booking reference" value={row.pnr} mono />
          <Fact label="Status" value={row.status} />
          <Fact label="Departs" value={date.format(row.departureTime)} />
          <Fact label="Paid" value={formatCents(decimalToCents(row.totalPrice))} mono />
        </dl>

        <ul className="border-t border-hairline">
          {travellers.map((person, index) => (
            <li
              key={`${person.fullName}-${index}`}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4 sm:px-7"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-bone">{person.fullName}</p>
                <p className="mt-1 flex items-center gap-[6px] text-[12px] text-bone-50">
                  <LuggageIcon size={12} />
                  <span className="numeric">
                    {(person.baggageAllowanceKg ?? 0) + person.extraBaggageKg}kg
                  </span>
                  checked
                </p>
              </div>
              {person.seatNumber ? (
                <span className="numeric shrink-0 rounded-md border border-amber/40 bg-amber-soft px-3 py-[6px] text-[15px] font-semibold text-amber">
                  {person.seatNumber}
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        {/* The scannable half. A perforation line sells the "tear here" idea
            that every paper boarding pass has, and separates the record above
            from the thing an agent actually points a phone at. */}
        <div className="relative border-t border-dashed border-divider px-5 py-8 sm:px-7">
          <span
            aria-hidden="true"
            className="absolute -left-3 -top-3 h-6 w-6 rounded-pill bg-stage"
          />
          <span
            aria-hidden="true"
            className="absolute -right-3 -top-3 h-6 w-6 rounded-pill bg-stage"
          />

          {qr ? (
            <div className="flex flex-col items-center">
              <div
                data-boarding-pass-qr
                className="w-full max-w-[260px] overflow-hidden rounded-md bg-bone p-3 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
                // Rendered server-side by the `qrcode` library from our own
                // token; no user input reaches this markup.
                dangerouslySetInnerHTML={{ __html: qr }}
              />
              <p className="mt-4 max-w-[36ch] text-center text-[12px] leading-[1.6] text-bone-50">
                Show this at the gate. Scanning it confirms the ticket without
                revealing your personal details.
              </p>
            </div>
          ) : (
            <p className="text-center text-[12px] leading-[1.6] text-bone-50">
              This booking predates scannable passes. Quote reference{" "}
              <span className="numeric text-bone">{row.pnr}</span> at the desk.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className={`mt-[6px] break-words text-[14px] text-bone ${mono ? "numeric" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
