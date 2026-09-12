import { auth, currentUser } from "@clerk/nextjs/server";
import Image from "next/image";
import Link from "next/link";

import { AskAi } from "./(home)/ask-ai";
import { DestinationGrid } from "./(home)/destination-grid";
import { BellIcon, MailIcon, SearchIcon } from "./(home)/home-icons";
import { SearchCard } from "./(home)/search-card";
import { HERO_PHOTO, PHOTO_FILTER, PHOTO_WASH, unsplashUrl } from "@/lib/home/destinations";
import { getHomeData } from "@/lib/home/home-data";

/** The catalogue moves as flights sell and depart, so never cache this. */
export const dynamic = "force-dynamic";

export default async function Home() {
  const { userId } = await auth();
  const [{ destinations, airports, flightCount }, user] = await Promise.all([
    getHomeData(),
    userId ? currentUser() : Promise.resolve(null),
  ]);

  const memberName = user?.firstName ?? user?.username ?? "AeroFlow Member";
  const initials = (user?.firstName?.[0] ?? "A") + (user?.lastName?.[0] ?? "F");

  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-[1280px] px-4 pb-24 sm:px-8">
        {/* Member bar: quick search on the left, account on the right. */}
        <div className="flex flex-wrap items-center gap-4 border-b border-hairline py-4">
          <form action="/flights" className="relative min-w-0 flex-1 sm:max-w-[420px]">
            <label htmlFor="quick-search" className="sr-only">
              Search flights
            </label>
            <SearchIcon
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bone-50"
            />
            <input
              id="quick-search"
              name="q"
              type="search"
              placeholder="Search flights, destinations, or airport codes…"
              className="h-11 w-full rounded-pill border border-hairline bg-card pl-9 pr-4 text-[13px] text-bone placeholder:text-bone-50/70 focus:border-amber focus:outline-none"
            />
          </form>

          <div className="ml-auto flex items-center gap-3">
            <IconButton label="Notifications">
              <BellIcon size={15} />
            </IconButton>
            <IconButton label="Messages">
              <MailIcon size={15} />
            </IconButton>

            {userId ? (
              <span className="flex items-center gap-[10px] pl-1">
                <span className="flex h-9 w-9 items-center justify-center rounded-pill bg-amber text-[12px] font-semibold text-stage">
                  {initials.toUpperCase()}
                </span>
                <span className="hidden leading-none sm:block">
                  <span className="block text-[13px] font-medium text-bone">{memberName}</span>
                  <span className="eyebrow mt-[3px] block">Carrier Direct</span>
                </span>
              </span>
            ) : (
              <Link
                href="/sign-in"
                className="hidden rounded-pill border border-outline px-4 py-[9px] text-[12px] font-medium text-bone transition-colors duration-200 hover:bg-card sm:block"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>

        {/* Hero */}
        <section className="relative mt-8">
          <div className="relative overflow-hidden rounded-lg border border-hairline">
            <div className="relative aspect-[21/9] min-h-[320px] w-full">
              <div className="absolute inset-0 bg-[linear-gradient(160deg,#2f2723,#15110e)]" />
              <Image
                src={unsplashUrl(HERO_PHOTO, 1920)}
                alt=""
                fill
                priority
                sizes="(min-width: 1280px) 1216px, 100vw"
                className={`object-cover ${PHOTO_FILTER}`}
              />
              <div className={PHOTO_WASH} />
              {/* The headline sits on the photograph, so the scrim has to carry
                  its contrast rather than hope the sky is dark that day. A
                  radial pool behind the text plus a vertical fade to the search
                  card keeps body copy above 4.5:1 on any frame. */}
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_50%_30%,rgba(21,17,14,0.86),transparent_75%)]" />
              <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(21,17,14,0.62),rgba(21,17,14,0.42)_38%,rgba(21,17,14,0.96))]" />

              <div className="absolute inset-x-0 top-[16%] px-6 text-center">
                <h1 className="font-display text-[2.75rem] italic leading-[0.98] tracking-[-0.025em] text-bone sm:text-[4rem] lg:text-[5rem]">
                  Your Trip Starts Here
                </h1>
                <p className="mx-auto mt-4 max-w-[62ch] text-[14px] leading-[1.6] text-bone/85 sm:text-[15px]">
                  Book a flight, pick your exact seat, and add checked bags — with live seat
                  availability, so what you see is what is actually free.
                </p>
              </div>
            </div>
          </div>

          {/* The search card overlaps the hero's lower edge. */}
          <div className="relative z-20 -mt-16 px-2 sm:-mt-20 sm:px-6 lg:px-10">
            <SearchCard airports={airports} initialCount={flightCount} />
          </div>
        </section>

        <DestinationGrid destinations={destinations} nearbyCode={null} />

        {/* Sections the top navigation points at. */}
        <section id="fleet" className="mt-20 grid gap-5 sm:grid-cols-3">
          {[
            {
              title: "Pick the exact seat",
              body: "Every seat on the aircraft, drawn to the real cabin layout. Choose a window, an aisle, or the front row.",
            },
            {
              title: "Held while you decide",
              body: "Your seat is reserved for ten minutes once you choose it, so nobody can take it while you enter passenger details.",
            },
            {
              title: "Bags priced upfront",
              body: "Extra checked baggage is priced per kilo before you pay, not added as a surprise at the airport.",
            },
          ].map((item) => (
            <article
              key={item.title}
              className="rounded-lg border border-hairline bg-stage-lift p-6 shadow-card"
            >
              <h3 className="font-display text-[1.375rem] leading-none tracking-[-0.012em] text-bone">
                {item.title}
              </h3>
              <p className="mt-3 text-[13px] leading-[1.6] text-bone-50">{item.body}</p>
            </article>
          ))}
        </section>

        <section
          id="offers"
          className="mt-20 flex flex-wrap items-center justify-between gap-6 rounded-lg border border-hairline bg-stage-lift p-8 shadow-card"
        >
          <div>
            <span className="eyebrow">Special offers</span>
            <h2
              id="why"
              className="mt-3 font-display text-[2rem] italic leading-[1.04] tracking-[-0.02em] text-bone"
            >
              {destinations.filter((d) => d.discount !== null).length} routes on promotion
            </h2>
            <p className="mt-2 max-w-[46ch] text-[13px] leading-[1.6] text-bone-50">
              Direct flights only. One airline, one fare, no connections to miss.
            </p>
          </div>
          <Link
            href="/flights"
            className="rounded-pill bg-bone px-[22px] py-[13px] text-[0.8125rem] font-semibold text-stage shadow-button transition-[filter] duration-200 hover:brightness-95"
          >
            See all {flightCount} departures
          </Link>
        </section>
      </div>

      <AskAi isSignedIn={Boolean(userId)} />
    </main>
  );
}

function IconButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-pill border border-hairline text-bone-50 transition-colors duration-200 hover:border-outline hover:text-bone"
    >
      {children}
    </button>
  );
}
