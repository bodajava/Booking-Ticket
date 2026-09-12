"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { AirportOption } from "@/lib/home/home-data";
import { CalendarIcon, SearchIcon, SwapIcon, UsersIcon } from "./home-icons";

/**
 * The booking search, floating over the hero.
 *
 * Everything it offers is real: the airport lists come from the catalogue, the
 * cabin options from the aircraft actually flying, and the result count is a
 * live query rather than a decorative number. Submitting hands the filters to
 * /flights as query parameters, so a search is a shareable URL.
 */

type Tab = "flight" | "hotel";

const CABINS = [
  { value: "", label: "All classes" },
  { value: "Economy", label: "Economy" },
  { value: "Business", label: "Business" },
];

export function SearchCard({
  airports,
  initialCount,
}: {
  airports: AirportOption[];
  initialCount: number;
}) {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("flight");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState("");
  const [cabin, setCabin] = useState("");
  const [passengers, setPassengers] = useState(1);
  const [count, setCount] = useState(initialCount);
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Keep the button's number honest as the filters change.
  useEffect(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (date) params.set("date", date);

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/flights/count?${params}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { count: number };
        setCount(body.count);
      } catch {
        // Offline: leave the last known number rather than showing zero.
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [from, to, date]);

  const submit = () => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (date) params.set("date", date);
    if (cabin) params.set("cabin", cabin);
    if (passengers > 1) params.set("passengers", String(passengers));
    router.push(`/flights${params.toString() ? `?${params}` : ""}`);
  };

  return (
    <div className="rounded-lg border border-hairline bg-stage-lift/95 p-4 shadow-card backdrop-blur sm:p-5">
      <div className="flex items-center gap-2">
        <TabButton active={tab === "flight"} onClick={() => setTab("flight")}>
          <PlaneGlyph /> Flight
        </TabButton>
        <TabButton active={tab === "hotel"} onClick={() => setTab("hotel")}>
          <BedGlyph /> Hotel partners
        </TabButton>
      </div>

      {tab === "hotel" ? (
        <p className="mt-5 rounded-md border border-divider bg-card p-4 text-[13px] leading-[1.6] text-bone-50">
          Hotel partners are not bookable here yet. Search a flight and we will show partner
          stays with your itinerary once they go live.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] lg:items-end">
          {/* Route */}
          <Field label="Route (origin → destination)">
            <div className="flex items-center gap-2">
              <AirportSelect
                id="home-from"
                srLabel="Origin airport"
                value={from}
                airports={airports}
                placeholder="From: All"
                onChange={setFrom}
              />
              <button
                type="button"
                aria-label="Swap origin and destination"
                onClick={() => {
                  setFrom(to);
                  setTo(from);
                }}
                className="flex h-11 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-bone-50 transition-colors duration-200 hover:text-bone"
              >
                <SwapIcon size={14} />
              </button>
              <AirportSelect
                id="home-to"
                srLabel="Destination airport"
                value={to}
                airports={airports}
                placeholder="To: All"
                onChange={setTo}
              />
            </div>
          </Field>

          {/* Departure date */}
          <Field label="Departure date">
            <div className="relative">
              <button
                type="button"
                onClick={() => setCalendarOpen((open) => !open)}
                aria-expanded={calendarOpen}
                aria-haspopup="dialog"
                className="flex h-11 w-full cursor-pointer items-center gap-2 rounded-md border border-hairline bg-card px-3 text-left text-[13px] text-bone transition-colors duration-200 hover:border-outline"
              >
                <CalendarIcon size={14} className="shrink-0 text-bone-50" />
                <span className={date ? "numeric" : "text-bone-50"}>
                  {date ? formatDate(date) : "Any date"}
                </span>
              </button>

              {calendarOpen ? (
                <Calendar
                  value={date}
                  onSelect={(next) => {
                    setDate(next);
                    setCalendarOpen(false);
                  }}
                  onClose={() => setCalendarOpen(false)}
                />
              ) : null}
            </div>
          </Field>

          {/* Cabin */}
          <Field label="Cabin class">
            <select
              aria-label="Cabin class"
              value={cabin}
              onChange={(e) => setCabin(e.target.value)}
              className="h-11 w-full rounded-md border border-hairline bg-card px-3 text-[13px] text-bone transition-colors duration-200 hover:border-outline focus:border-amber focus:outline-none"
            >
              {CABINS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          {/* Passengers */}
          <Field label="Passengers">
            <div className="flex h-11 items-center gap-2 rounded-md border border-hairline bg-card px-3">
              <UsersIcon size={14} className="shrink-0 text-bone-50" />
              <select
                aria-label="Number of passengers"
                value={passengers}
                onChange={(e) => setPassengers(Number(e.target.value))}
                className="w-full bg-transparent text-[13px] text-bone focus:outline-none"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} passenger{n > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </div>
          </Field>

          <button
            type="button"
            onClick={submit}
            className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-pill bg-bone px-6 text-[0.8125rem] font-semibold text-stage shadow-button transition-[filter] duration-200 hover:brightness-95"
          >
            <SearchIcon size={14} />
            Search ({count})
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="eyebrow mb-[6px] block">{label}</span>
      {children}
    </div>
  );
}

function AirportSelect({
  id,
  srLabel,
  value,
  airports,
  placeholder,
  onChange,
}: {
  id: string;
  srLabel: string;
  value: string;
  airports: AirportOption[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {srLabel}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full min-w-0 rounded-md border border-hairline bg-card px-3 text-[13px] text-bone transition-colors duration-200 hover:border-outline focus:border-amber focus:outline-none"
      >
        <option value="">{placeholder}</option>
        {airports.map((airport) => (
          <option key={airport.code} value={airport.code}>
            {airport.city} ({airport.code})
          </option>
        ))}
      </select>
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "flex cursor-pointer items-center gap-2 rounded-pill px-4 py-[9px] text-[13px] font-medium transition-colors duration-200",
        active ? "bg-bone text-stage" : "border border-hairline text-bone-50 hover:text-bone",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Calendar                                  */
/* -------------------------------------------------------------------------- */

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Month grid for the departure date.
 *
 * Dates are handled as plain `YYYY-MM-DD` strings in UTC throughout. Building
 * them from a local `Date` would shift the selected day by one for anyone west
 * of Greenwich, which is exactly the class of bug that puts someone on
 * yesterday's flight.
 */
function Calendar({
  value,
  onSelect,
  onClose,
}: {
  value: string;
  onSelect: (date: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const today = new Date();
  const [view, setView] = useState(() => {
    const base = value ? new Date(`${value}T00:00:00Z`) : today;
    return { year: base.getUTCFullYear(), month: base.getUTCMonth() };
  });

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const firstWeekday = new Date(Date.UTC(view.year, view.month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
  const todayIso = today.toISOString().slice(0, 10);

  const cells: Array<{ iso: string; day: number; outside: boolean }> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ iso: "", day: 0, outside: true });
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${view.year}-${String(view.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ iso, day, outside: false });
  }

  const shift = (delta: number) =>
    setView((current) => {
      const next = new Date(Date.UTC(current.year, current.month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Choose a departure date"
      className="absolute left-0 top-[calc(100%+8px)] z-30 w-[300px] rounded-lg border border-hairline bg-stage-lift p-4 shadow-card"
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => shift(-1)}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-pill text-bone-50 transition-colors duration-200 hover:bg-card hover:text-bone"
        >
          ‹
        </button>
        <p className="font-display text-[1.125rem] italic leading-none text-bone">
          {MONTHS[view.month]} {view.year}
        </p>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => shift(1)}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-pill text-bone-50 transition-colors duration-200 hover:bg-card hover:text-bone"
        >
          ›
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((day) => (
          <span key={day} className="eyebrow py-1 text-center">
            {day}
          </span>
        ))}

        {cells.map((cell, index) =>
          cell.outside ? (
            <span key={`pad-${index}`} />
          ) : (
            <button
              key={cell.iso}
              type="button"
              disabled={cell.iso < todayIso}
              aria-pressed={cell.iso === value}
              onClick={() => onSelect(cell.iso)}
              className={[
                "numeric flex h-9 cursor-pointer items-center justify-center rounded-md text-[12px] transition-colors duration-200",
                cell.iso === value
                  ? "bg-amber font-semibold text-stage"
                  : cell.iso === todayIso
                    ? "border border-amber/50 text-bone"
                    : "text-bone-50 hover:bg-card hover:text-bone",
                cell.iso < todayIso ? "cursor-not-allowed opacity-30 hover:bg-transparent" : "",
              ].join(" ")}
            >
              {cell.day}
            </button>
          ),
        )}
      </div>

      {value ? (
        <button
          type="button"
          onClick={() => onSelect("")}
          className="mt-3 w-full cursor-pointer rounded-pill border border-outline py-[9px] text-[12px] text-bone-50 transition-colors duration-200 hover:text-bone"
        >
          Clear date
        </button>
      ) : null}
    </div>
  );
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function PlaneGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" />
    </svg>
  );
}

function BedGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M3 18V7M3 12h18v6M7 12V9h5v3" />
    </svg>
  );
}
