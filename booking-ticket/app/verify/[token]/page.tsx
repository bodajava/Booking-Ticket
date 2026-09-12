import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";

import {
  allowScan,
  verifyByToken,
  type VerifiedPass,
  type VerifiedPassenger,
} from "@/lib/verification";
import { CheckIcon, CrossIcon, ClockIcon, LuggageIcon } from "@/app/flights/[flightId]/icons";

/**
 * Boarding-pass verification — the page a QR scan lands on.
 *
 * Public by design: whoever scans a boarding pass is a gate agent with a phone
 * and no account here, so requiring a login would make the feature useless.
 * The unguessable token in the URL is the entire access control, which is why
 * this page shows only what someone standing in front of the passenger needs
 * and nothing else — no passport number, no date of birth, no fare paid.
 *
 * Built mobile-first and rendered on the server. A scan happens on a phone,
 * often on airport wifi, and the answer has to be legible the instant the page
 * paints — so the verdict is server-rendered rather than fetched after
 * hydration, and there is no client JavaScript required to read it.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Boarding pass verification",
  robots: { index: false, follow: false },
};

export default async function VerifyPage({ params }: PageProps<"/verify/[token]">) {
  const { token } = await params;

  // Per-caller throttle. 160-bit tokens are not guessable, so this exists to
  // stop a script costing us a query per attempt rather than to keep anyone out.
  const headerList = await headers();
  const caller =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    "unknown";

  if (!(await allowScan(caller))) {
    return (
      <Shell>
        <StatusCard
          tone="warn"
          icon={<ClockIcon size={26} />}
          heading="Too many checks"
          detail="Wait a moment and scan again."
        />
      </Shell>
    );
  }

  const result = await verifyByToken(token);

  if (result.outcome !== "found") {
    return (
      <Shell>
        <StatusCard
          tone="invalid"
          icon={<CrossIcon size={26} />}
          heading="Not a valid pass"
          detail="This code does not match any booking. Check you scanned the whole code, or ask the passenger for their booking reference."
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <PassCard pass={result.pass} />
    </Shell>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Layout                                   */
/* -------------------------------------------------------------------------- */

/**
 * A self-contained, phone-first frame.
 *
 * `min-h-dvh` rather than `100vh`: on iOS Safari the older unit is measured
 * against the browser chrome's collapsed height, which pushes the verdict
 * under the address bar on exactly the devices this page is built for.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col bg-stage px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto flex w-full max-w-[520px] flex-1 flex-col">
        <header className="flex items-center justify-center gap-[10px]">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-hairline bg-card font-display text-[13px] leading-none text-bone">
            AF
          </span>
          <span className="font-display text-[1.125rem] tracking-[-0.02em] text-bone">
            AeroFlow
          </span>
        </header>

        <div className="mt-6 flex-1 sm:mt-8">{children}</div>

        <footer className="mt-8 text-center">
          <p className="text-[11px] leading-[1.5] text-bone-50">
            Verified against the live booking record.
          </p>
          <Link
            href="/"
            className="mt-3 inline-block text-[12px] text-bone-50 underline underline-offset-2 transition-colors duration-200 hover:text-bone"
          >
            aeroflow.com
          </Link>
        </footer>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Verdict                                  */
/* -------------------------------------------------------------------------- */

type Tone = "valid" | "invalid" | "warn";

const TONE: Record<Tone, { ring: string; chip: string; icon: string }> = {
  // Green is not in this design system, so "valid" is carried by the accent
  // plus a tick and the word itself — never by colour alone.
  valid: {
    ring: "border-amber/50",
    chip: "bg-amber text-stage",
    icon: "bg-amber text-stage",
  },
  invalid: {
    ring: "border-[#991B1B]",
    chip: "bg-[#991B1B] text-bone",
    icon: "bg-[#991B1B] text-bone",
  },
  warn: {
    ring: "border-outline",
    chip: "bg-card text-bone",
    icon: "bg-card text-bone-50",
  },
};

function StatusCard({
  tone,
  icon,
  heading,
  detail,
  children,
}: {
  tone: Tone;
  icon: React.ReactNode;
  heading: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      aria-live="polite"
      className={`rounded-lg border ${TONE[tone].ring} bg-stage-lift shadow-card`}
    >
      <div className="flex flex-col items-center px-5 py-8 text-center sm:px-8">
        <span
          className={`flex h-14 w-14 items-center justify-center rounded-pill ${TONE[tone].icon}`}
        >
          {icon}
        </span>
        <h1 className="mt-5 font-display text-[1.875rem] leading-[1.1] tracking-[-0.02em] text-bone sm:text-[2.25rem]">
          {heading}
        </h1>
        <p className="mt-3 max-w-[42ch] text-[13px] leading-[1.6] text-bone-50">{detail}</p>
      </div>
      {children}
    </section>
  );
}

function PassCard({ pass }: { pass: VerifiedPass }) {
  const tone: Tone = pass.status === "valid" ? "valid" : pass.status === "flown" ? "warn" : "invalid";

  const copy = {
    valid: {
      icon: <CheckIcon size={26} />,
      heading: "Valid boarding pass",
      detail: "This ticket is confirmed and good for travel.",
    },
    flown: {
      icon: <ClockIcon size={26} />,
      heading: "Flight already departed",
      detail: "This pass was valid, but the flight has landed.",
    },
    cancelled: {
      icon: <CrossIcon size={26} />,
      heading: "Booking cancelled",
      detail: "This ticket was cancelled and is not valid for travel.",
    },
  }[pass.status];

  return (
    <StatusCard tone={tone} icon={copy.icon} heading={copy.heading} detail={copy.detail}>
      <div className="border-t border-hairline px-5 py-6 sm:px-8">
        {/* Route: the one thing to read from arm's length. */}
        <div className="flex items-center justify-between gap-3">
          <Endpoint code={pass.origin.code} city={pass.origin.city} time={pass.departureTime} />
          <div className="flex flex-1 flex-col items-center gap-1">
            <span className="numeric text-[11px] text-bone-50">{pass.flightNumber}</span>
            <span aria-hidden="true" className="h-px w-full bg-hairline" />
            <span className="eyebrow">Direct</span>
          </div>
          <Endpoint
            code={pass.destination.code}
            city={pass.destination.city}
            time={pass.arrivalTime}
            align="right"
          />
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 border-t border-hairline pt-6">
          <Fact label="Booking reference" value={pass.pnr} mono />
          <Fact label="Flight" value={pass.flightNumber} mono />
          <Fact
            label="Departs"
            value={new Intl.DateTimeFormat("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            }).format(pass.departureTime)}
          />
          <Fact
            label="Passengers"
            value={String(pass.passengers.length)}
            mono
          />
        </dl>
      </div>

      <ul className="border-t border-hairline">
        {pass.passengers.map((person, index) => (
          <PassengerRow key={`${person.fullName}-${index}`} person={person} />
        ))}
      </ul>
    </StatusCard>
  );
}

function Endpoint({
  code,
  city,
  time,
  align = "left",
}: {
  code: string;
  city: string;
  time: Date;
  align?: "left" | "right";
}) {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(time);

  return (
    <div className={align === "right" ? "text-right" : ""}>
      <p className="numeric text-[1.5rem] leading-none text-bone sm:text-[1.75rem]">{code}</p>
      <p className="mt-[6px] truncate text-[12px] text-bone-50">{city}</p>
      <p className="numeric mt-1 text-[12px] text-bone">{formatted}</p>
    </div>
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

/**
 * One traveller.
 *
 * Seat and baggage sit beside the name because that is the whole job at a gate:
 * confirm the person, point them at a seat, and know what they are carrying.
 */
function PassengerRow({ person }: { person: VerifiedPassenger }) {
  const total = person.baggageAllowanceKg + person.extraBaggageKg;

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4 sm:px-8">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold text-bone">{person.fullName}</p>
        <p className="mt-1 flex items-center gap-[6px] text-[12px] text-bone-50">
          <LuggageIcon size={12} />
          <span className="numeric">{total}kg</span>
          {person.extraBaggageKg > 0 ? (
            <span className="numeric text-bone-50/80">
              ({person.baggageAllowanceKg} + {person.extraBaggageKg} extra)
            </span>
          ) : (
            <span>checked</span>
          )}
        </p>
      </div>

      {person.seatNumber ? (
        <div className="shrink-0 text-right">
          <span className="eyebrow block">Seat</span>
          <span className="numeric mt-[4px] block rounded-md border border-amber/40 bg-amber-soft px-3 py-[6px] text-[15px] font-semibold text-amber">
            {person.seatNumber}
          </span>
          {person.seatClass ? (
            <span className="eyebrow mt-[6px] block">{person.seatClass}</span>
          ) : null}
        </div>
      ) : (
        <span className="shrink-0 rounded-pill border border-outline px-3 py-[6px] text-[12px] text-bone-50">
          No seat
        </span>
      )}
    </li>
  );
}
