"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { PHOTO_FILTER, PHOTO_WASH, unsplashUrl } from "@/lib/home/destinations";
import type { FeaturedDestination } from "@/lib/home/home-data";
import { formatCents } from "@/lib/pricing";
import { HeartIcon, PinIcon, StarIcon, TagIcon } from "./home-icons";

/**
 * Travelers Spot — the destination cards.
 *
 * The "from" price on each card is the real cheapest fare on sale to that
 * airport, so tapping a card and landing on a higher number would be a bug,
 * not a disclaimer. Saving a destination is per-browser only; there is no
 * favourites table yet, and pretending otherwise would lose someone's list.
 */

type Filter = "popular" | "near" | "offers";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "popular", label: "Popular" },
  { id: "near", label: "Near me" },
  { id: "offers", label: "Special offers" },
];

export function DestinationGrid({
  destinations,
  nearbyCode,
}: {
  destinations: FeaturedDestination[];
  /** Airport nearest the viewer, if the catalogue suggests one. */
  nearbyCode: string | null;
}) {
  const [filter, setFilter] = useState<Filter>("popular");
  const [saved, setSaved] = useState<Set<string>>(new Set());

  // One tidy row of four. A fifth card orphaned on its own line reads as a
  // layout mistake rather than an editorial choice; the rest are one tap away.
  const matching = destinations.filter((entry) => {
    if (filter === "offers") return entry.discount !== null;
    if (filter === "near") return nearbyCode ? entry.airportCode !== nearbyCode : true;
    return entry.tags.includes("popular");
  });
  const shown = matching.slice(0, 4);

  return (
    <section aria-labelledby="travelers-spot" className="mt-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2
            id="travelers-spot"
            className="font-display text-[2.25rem] italic leading-[1.04] tracking-[-0.02em] text-bone sm:text-[2.75rem]"
          >
            Travelers Spot
          </h2>
          <p className="mt-2 max-w-[52ch] text-[14px] leading-[1.6] text-bone-50">
            Handpicked destinations we fly to directly, priced from the cheapest seat on sale
            today.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Destination filter">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={filter === entry.id}
              onClick={() => setFilter(entry.id)}
              className={[
                "cursor-pointer rounded-pill px-4 py-[9px] text-[12px] font-medium transition-colors duration-200",
                filter === entry.id
                  ? "bg-bone text-stage"
                  : "border border-hairline text-bone-50 hover:border-outline hover:text-bone",
              ].join(" ")}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="mt-10 text-[13px] text-bone-50">
          Nothing on offer to those destinations right now. Try another filter.
        </p>
      ) : (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {shown.map((entry) => {
            const isSaved = saved.has(entry.airportCode);

            return (
              <li key={entry.airportCode}>
                <div className="group relative overflow-hidden rounded-lg border border-hairline bg-stage-lift shadow-card">
                  <Link
                    href={`/flights?to=${entry.airportCode}`}
                    className="block focus-visible:outline-none"
                    aria-label={`Flights to ${entry.city} from ${entry.fromCents !== null ? formatCents(entry.fromCents) : "—"}`}
                  >
                    <div className="relative aspect-[4/5] w-full">
                      {/* A warm block behind the photo, so a slow or blocked
                          image degrades to something on-brand instead of a
                          white flash. */}
                      <div className="absolute inset-0 bg-[linear-gradient(160deg,#2f2723,#15110e)]" />
                      <Image
                        src={unsplashUrl(entry.photo, 640)}
                        alt=""
                        fill
                        sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                        className={`object-cover ${PHOTO_FILTER} transition-transform duration-[320ms] ease-[var(--ease-standard)] group-hover:scale-[1.03]`}
                      />
                      {/* Scrim: the text below sits on the photo and has to stay
                          readable whatever the photograph happens to be. */}
                      <div className={PHOTO_WASH} />
                      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(21,17,14,0.97)_0%,rgba(21,17,14,0.88)_28%,rgba(21,17,14,0.42)_58%,rgba(21,17,14,0.34)_100%)]" />

                      <div className="absolute inset-x-0 bottom-0 p-4">
                        <h3 className="font-display text-[1.25rem] leading-[1.15] tracking-[-0.012em] text-bone">
                          {entry.title}
                        </h3>

                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="flex items-center gap-[5px] text-[11px] text-bone-50">
                            <PinIcon size={11} />
                            {entry.city}, {entry.airportCode}
                          </span>
                          <span className="flex items-center gap-[4px] text-[11px] text-bone">
                            <StarIcon size={10} className="text-amber" />
                            <span className="numeric">{entry.rating.toFixed(1)}</span>
                          </span>
                        </div>

                        <p className="mt-3 border-t border-hairline pt-3">
                          <span className="eyebrow">From</span>{" "}
                          <span className="numeric ml-1 text-[15px] font-semibold text-bone">
                            {entry.fromCents !== null ? formatCents(entry.fromCents) : "—"}
                          </span>
                        </p>
                      </div>
                    </div>
                  </Link>

                  {entry.discount !== null ? (
                    <span className="pointer-events-none absolute left-3 top-3 flex items-center gap-[5px] rounded-pill bg-amber px-[10px] py-[5px] text-[10px] font-semibold text-stage">
                      <TagIcon size={10} />
                      {entry.discount}% off
                    </span>
                  ) : null}

                  <button
                    type="button"
                    aria-label={`${isSaved ? "Remove" : "Save"} ${entry.city}`}
                    aria-pressed={isSaved}
                    onClick={() =>
                      setSaved((current) => {
                        const next = new Set(current);
                        if (next.has(entry.airportCode)) next.delete(entry.airportCode);
                        else next.add(entry.airportCode);
                        return next;
                      })
                    }
                    className={[
                      "absolute right-3 top-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-pill border backdrop-blur transition-colors duration-200",
                      isSaved
                        ? "border-amber bg-amber text-stage"
                        : "border-hairline bg-stage/60 text-bone hover:bg-stage/80",
                    ].join(" ")}
                  >
                    <HeartIcon size={14} filled={isSaved} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {matching.length > shown.length ? (
        <div className="mt-8 flex justify-center">
          <Link
            href="/flights"
            className="rounded-pill border border-outline px-[22px] py-[11px] text-[0.8125rem] font-medium text-bone transition-colors duration-200 hover:bg-card"
          >
            View all {matching.length} destinations
          </Link>
        </div>
      ) : null}
    </section>
  );
}
