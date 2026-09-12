"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import type { FlightView, SeatView } from "@/lib/flight-view";
import { MAX_PASSENGERS } from "@/lib/pricing";
import {
  holdSeatAction,
  quoteBookingAction,
  releaseSeatAction,
  startCheckoutAction,
  type SerializableQuote,
  type SerializableTotals,
} from "./actions";
import {
  blockingReasons as computeBlockingReasons,
  clampBaggage,
  emptyPassenger,
  isComplete,
  validatePassenger,
  type PassengerDraft,
  type PassengerErrors,
} from "./booking-state";
import { FareSummary } from "./fare-summary";
import { AlertIcon, ArrowRightIcon, CheckIcon, ClockIcon, CrossIcon, PlusIcon, TrashIcon } from "./icons";
import { PassengerForm } from "./passenger-form";
import { SeatMap } from "./seat-map";
import { useSeatAvailability, type ConnectionStatus } from "./use-seat-availability";

/**
 * The booking flow: choose seats, enter who is travelling, review, pay.
 *
 * Deliberately *not* a redirect-on-click flow. Clicking a seat takes the Redis
 * hold and nothing else — the traveller still has to enter details and see a
 * total before any money is involved. The hold is what buys them that time.
 *
 * Invariants worth protecting in review:
 *  1. A seat is only shown as chosen after Redis has confirmed the lock. There
 *     is no optimistic "selected" state, because a seat that looks taken and
 *     isn't is the one failure this whole design exists to prevent.
 *  2. Availability is never read from this component's own render. It streams
 *     in from `useSeatAvailability`, so a seat taken in someone else's browser
 *     repaints here without a reload — and without touching what anyone has
 *     typed, chosen for baggage, or reached in the flow.
 *  3. Each passenger's draft is keyed by a stable id, so switching between
 *     them is a change of index and never a remount that would drop input.
 */

type Notice = { tone: "error" | "info"; text: string };

/** Mobile walks the same flow as desktop, one stage at a time. */
type Step = "seats" | "details" | "review";

export function SeatSelection({
  flight,
  holdTtlMs,
  initialQuotes,
  isSignedIn,
}: {
  flight: FlightView;
  holdTtlMs: number;
  initialQuotes: SerializableQuote[];
  isSignedIn: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  // Live availability, pushed over SSE. Deliberately not derived from the
  // server render: that snapshot is only the first frame.
  const availability = useSeatAvailability(flight.id, flight.snapshot);

  // No useMemo/useCallback anywhere: Next 16 ships the React Compiler, which
  // memoizes automatically. Hand-written memoization made it bail out.
  const [passengers, setPassengers] = useState<PassengerDraft[]>(() => {
    // Rehydrate one draft per seat this traveller already holds, so a reload
    // mid-booking comes back with the party intact.
    const held = flight.holds;
    if (held.length === 0) return [emptyPassenger("p1")];
    return held.map((hold, index) => ({
      ...emptyPassenger(`p${index + 1}`),
      seatId: hold.seatId,
      extraBaggageKg: 0,
    }));
  });

  const [activeIndex, setActiveIndex] = useState(0);
  const [touched, setTouched] = useState<Record<string, Set<string>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [quotes, setQuotes] = useState<SerializableQuote[]>(initialQuotes);
  const [totals, setTotals] = useState<SerializableTotals | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingSeatId, setPendingSeatId] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [step, setStep] = useState<Step>("seats");

  const active = passengers[activeIndex] ?? passengers[0];

  /* ------------------------------ seat lookup ----------------------------- */

  const seatsById = new Map<string, SeatView>();
  for (const cabin of flight.cabins) {
    for (const row of cabin.rows) {
      for (const seat of row.seats) if (seat) seatsById.set(seat.id, seat);
    }
  }

  /** seatId -> 1-based passenger number, for the badge drawn on the seat. */
  const assignments = new Map<string, number>();
  passengers.forEach((passenger, index) => {
    if (passenger.seatId) assignments.set(passenger.seatId, index + 1);
  });

  const holdsBySeat = new Map(flight.holds.map((h) => [h.seatId, h.expiresAt]));
  const [expiries, setExpiries] = useState<Map<string, number>>(holdsBySeat);
  const earliestExpiry =
    passengers
      .map((p) => (p.seatId ? expiries.get(p.seatId) : undefined))
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => a - b)[0] ?? null;

  /* ------------------------------- validation ----------------------------- */

  const errorsFor = (passenger: PassengerDraft): PassengerErrors => {
    const all = validatePassenger(passenger);
    if (submitted) return all;

    // Before a checkout attempt, only complain about what has been touched.
    const seen = touched[passenger.id];
    if (!seen) return {};
    const visible: PassengerErrors = {};
    for (const [field, message] of Object.entries(all)) {
      if (seen.has(field)) visible[field as keyof PassengerErrors] = message;
    }
    return visible;
  };

  const blockingReasons = computeBlockingReasons(passengers, validatePassenger);

  /* --------------------------- optimistic pricing ------------------------- */

  // Shown instantly on every stepper click, then reconciled against the server
  // below. The server's number always wins if the two ever disagree.
  const optimisticQuotes: SerializableQuote[] = passengers.flatMap((passenger) => {
    if (!passenger.seatId) return [];
    const confirmed = quotes.find((q) => q.seatId === passenger.seatId);
    if (!confirmed) return [];
    const baggageCents = confirmed.perKgCents * passenger.extraBaggageKg;
    return [
      {
        ...confirmed,
        extraBaggageKg: passenger.extraBaggageKg,
        baggageCents,
        totalCents: confirmed.fareCents + baggageCents,
      },
    ];
  });

  const shownQuotes = optimisticQuotes;
  const shownTotals: SerializableTotals | null =
    shownQuotes.length === 0
      ? null
      : {
          baseFareCents: shownQuotes.reduce((n, q) => n + q.baseFareCents, 0),
          seatSurchargeCents: shownQuotes.reduce((n, q) => n + q.seatSurchargeCents, 0),
          baggageCents: shownQuotes.reduce((n, q) => n + q.baggageCents, 0),
          grandTotalCents: shownQuotes.reduce((n, q) => n + q.totalCents, 0),
          passengerCount: shownQuotes.length,
          currency: totals?.currency ?? "usd",
        };

  /* ------------------------------- lifecycle ------------------------------ */

  const clearAll = () => {
    setPassengers((current) => current.map((p) => ({ ...p, seatId: null, extraBaggageKg: 0 })));
    setQuotes([]);
    setTotals(null);
    setExpiries(new Map());
  };

  const handleExpiry = () => {
    clearAll();
    setNotice({
      tone: "info",
      text: "Your seat hold ended and the seats are available again. Choose seats to start over.",
    });
  };

  const expiryRef = useRef(handleExpiry);
  useEffect(() => {
    expiryRef.current = handleExpiry;
  });

  /* --------------------------- server re-quoting -------------------------- */

  const quoteRequestId = useRef(0);
  const legs = passengers
    .filter((p) => p.seatId)
    .map((p) => ({ seatId: p.seatId!, extraBaggageKg: p.extraBaggageKg }));
  const legKey = legs.map((l) => `${l.seatId}:${l.extraBaggageKg}`).join("|");

  useEffect(() => {
    // Rebuilt from the serialised key rather than captured from render, so the
    // effect's only dependency is the value that actually changes the price.
    const current = legKey
      .split("|")
      .filter(Boolean)
      .map((entry) => {
        const [seatId, kg] = entry.split(":");
        return { seatId, extraBaggageKg: Number(kg) };
      });

    if (current.length === 0) return;

    const requestId = ++quoteRequestId.current;

    // Debounced: holding down the stepper must not fire a request per click.
    const timer = setTimeout(async () => {
      const result = await quoteBookingAction({
        flightId: flight.id,
        passengers: current,
      }).catch(() => null);

      // A slower earlier request must never overwrite a newer answer.
      if (!result || requestId !== quoteRequestId.current) return;

      if (result.ok) {
        setQuotes(result.quotes);
        setTotals(result.totals);
      } else if (result.reason === "expired") {
        expiryRef.current();
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [legKey, flight.id]);

  /* -------------------------------- actions ------------------------------- */

  const patchActive = (patch: Partial<PassengerDraft>) => {
    setPassengers((current) =>
      current.map((p, i) => (i === activeIndex ? { ...p, ...patch } : p)),
    );
  };

  const markTouched = (field: string) => {
    setTouched((current) => {
      const next = { ...current };
      next[active.id] = new Set(next[active.id] ?? []).add(field);
      return next;
    });
  };

  const handleSelectSeat = (seat: SeatView) => {
    if (!isSignedIn) {
      setNotice({ tone: "info", text: "Sign in to choose a seat." });
      return;
    }
    // Guards both the double-click and the click-another-seat-mid-request race.
    if (pendingSeatId !== null || isCheckingOut) return;

    // Tapping a seat this party already has moves the assignment, it does not
    // book it twice.
    const heldByOther = passengers.findIndex(
      (p, i) => p.seatId === seat.id && i !== activeIndex,
    );
    if (heldByOther !== -1) {
      setActiveIndex(heldByOther);
      return;
    }
    if (active.seatId === seat.id) return;

    setPendingSeatId(seat.id);
    setNotice(null);

    const previous = active.seatId;

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof holdSeatAction>>;
      try {
        result = await holdSeatAction({
          flightId: flight.id,
          seatId: seat.id,
          replaceSeatId: previous,
        });
      } catch {
        setPendingSeatId(null);
        setNotice({
          tone: "error",
          text: "We could not reach the server. Check your connection and try again.",
        });
        return;
      }
      setPendingSeatId(null);

      if (!result.ok) {
        setNotice({ tone: "error", text: result.message });
        // The winning hold was published when it was taken, so the seat is
        // already repainting as unavailable from the live stream.
        return;
      }

      // Deliberately does NOT reset the baggage choice. The hold takes about a
      // second to confirm, and a traveller who taps a seat and immediately
      // adjusts their bags would have had that choice silently overwritten when
      // the response landed. Extra kilos are a quantity the passenger bought,
      // not a property of the seat — the included allowance and the per-kilo
      // rate change with the cabin, and the server re-quotes both.
      patchActive({ seatId: result.seatId });
      setQuotes((current) => [
        ...current.filter((q) => q.seatId !== previous && q.seatId !== result.seatId),
        result.quote,
      ]);
      setExpiries((current) => {
        const next = new Map(current);
        if (previous) next.delete(previous);
        next.set(result.seatId, result.expiresAt);
        return next;
      });
    });
  };

  const handleAddPassenger = () => {
    if (passengers.length >= MAX_PASSENGERS) return;
    const id = `p${Date.now()}`;
    setPassengers((current) => [...current, emptyPassenger(id)]);
    setActiveIndex(passengers.length);
    setNotice({ tone: "info", text: "Choose a seat for the new passenger." });
  };

  const handleRemovePassenger = (index: number) => {
    const victim = passengers[index];
    if (!victim || passengers.length === 1 || isCheckingOut) return;

    setPassengers((current) => current.filter((_, i) => i !== index));
    setActiveIndex((current) => (current >= index && current > 0 ? current - 1 : current));

    if (victim.seatId) {
      const seatId = victim.seatId;
      setQuotes((current) => current.filter((q) => q.seatId !== seatId));
      setExpiries((current) => {
        const next = new Map(current);
        next.delete(seatId);
        return next;
      });
      startTransition(async () => {
        await releaseSeatAction({ flightId: flight.id, seatId }).catch(() => {});
      });
    }
  };

  const handleReleaseActiveSeat = () => {
    if (!active.seatId || isCheckingOut) return;
    const seatId = active.seatId;
    patchActive({ seatId: null, extraBaggageKg: 0 });
    setQuotes((current) => current.filter((q) => q.seatId !== seatId));
    setExpiries((current) => {
      const next = new Map(current);
      next.delete(seatId);
      return next;
    });
    startTransition(async () => {
      await releaseSeatAction({ flightId: flight.id, seatId }).catch(() => {});
    });
  };

  const handleCheckout = () => {
    if (isCheckingOut) return;

    setSubmitted(true);
    if (blockingReasons.length > 0) {
      setNotice({ tone: "error", text: "Finish the highlighted details first." });
      const firstIncomplete = passengers.findIndex((p) => !isComplete(validatePassenger(p)));
      if (firstIncomplete !== -1) {
        setActiveIndex(firstIncomplete);
        setStep("details");
      }
      return;
    }

    setIsCheckingOut(true);
    setNotice(null);

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof startCheckoutAction>>;
      try {
        result = await startCheckoutAction({
          flightId: flight.id,
          passengers: passengers.map((p) => ({
            seatId: p.seatId!,
            extraBaggageKg: p.extraBaggageKg,
            fullName: p.fullName.trim(),
            passportNumber: p.passportNumber.trim(),
            nationality: p.nationality,
            dateOfBirth: p.dateOfBirth,
          })),
        });
      } catch {
        setIsCheckingOut(false);
        setNotice({
          tone: "error",
          text: "We could not reach the server. Your seats are still held — try again.",
        });
        return;
      }

      if (result.ok) {
        // Stays disabled through the navigation — re-enabling here would give
        // an impatient traveller a second session on the same seats.
        window.location.assign(result.url);
        return;
      }

      setIsCheckingOut(false);
      setNotice({ tone: "error", text: result.message });
      if (result.reason === "expired" || result.reason === "unavailable") clearAll();
    });
  };

  /* --------------------------------- derived ------------------------------- */

  const unavailableCount = new Set([...availability.booked, ...availability.held]).size;
  const availableCount = Math.max(flight.totalSeats - unavailableCount, 0);
  const activeSeat = active.seatId ? seatsById.get(active.seatId) : null;
  const activeQuote = shownQuotes.find((q) => q.seatId === active.seatId) ?? null;
  const seatsChosen = passengers.filter((p) => p.seatId).length;

  /* --------------------------------- render -------------------------------- */

  const noticeBlock = (
    <div aria-live="polite" role={notice?.tone === "error" ? "alert" : "status"}>
      {notice ? (
        <p
          className={[
            "flex items-start gap-2 rounded-md border p-3 text-[12px] leading-[1.5]",
            notice.tone === "error"
              ? "border-[#991B1B] bg-[rgba(153,27,27,0.12)] text-bone"
              : "border-divider bg-card text-bone-50",
          ].join(" ")}
        >
          <AlertIcon size={13} className="mt-[2px] shrink-0" />
          <span>{notice.text}</span>
        </p>
      ) : null}
    </div>
  );

  const chips = (
    <PassengerChips
      passengers={passengers}
      activeIndex={activeIndex}
      seatsById={seatsById}
      disabled={isCheckingOut}
      onSelect={setActiveIndex}
      onAdd={handleAddPassenger}
      onRemove={handleRemovePassenger}
    />
  );

  const detailsCard = isSignedIn ? (
    <PassengerForm
      key={active.id}
      index={activeIndex}
      passenger={active}
      errors={errorsFor(active)}
      seatLabel={activeSeat?.seatNumber ?? null}
      seatClass={activeSeat?.class ?? null}
      allowanceKg={activeQuote?.allowanceKg ?? null}
      perKgCents={activeQuote?.perKgCents ?? null}
      baggageCents={activeQuote?.baggageCents ?? 0}
      disabled={isCheckingOut}
      onChange={patchActive}
      onStepBaggage={(delta) =>
        patchActive({ extraBaggageKg: clampBaggage(active.extraBaggageKg + delta) })
      }
      onBlurField={markTouched}
    />
  ) : (
    <SignInCard />
  );

  const summaryCard = (
    <FareSummary
      quotes={shownQuotes}
      totals={shownTotals}
      passengerNames={passengers.filter((p) => p.seatId).map((p) => p.fullName)}
      holdExpiresAt={earliestExpiry}
      holdTotalMs={holdTtlMs}
      blockingReasons={isSignedIn ? blockingReasons : ["Sign in to book"]}
      isCheckingOut={isCheckingOut || isPending}
      onExpire={handleExpiry}
      onCheckout={handleCheckout}
    />
  );

  // One DOM tree for both breakpoints. Rendering a desktop layout *and* a
  // mobile layout would duplicate every seat button — 372 nodes for a 186-seat
  // aircraft, two elements sharing each `data-seat-id`, and two live regions
  // announcing the same thing. Visibility is CSS; the components exist once.
  const onlyOnStep = (target: Step) => (step === target ? "" : "hidden lg:block");

  return (
    <>
      {/* Mobile only: the same flow, one stage at a time. */}
      <div className="lg:hidden">
        <MobileSteps
          step={step}
          seatsChosen={seatsChosen}
          passengerCount={passengers.length}
          onStep={setStep}
        />
      </div>

      <div className="mt-5 grid gap-6 lg:mt-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-10">
        {/* Left: chips, legend, aircraft. */}
        <div className={`min-w-0 ${onlyOnStep("seats")}`}>
          {chips}
          <div className="mt-5 lg:mt-6">
            <Legend
              available={availableCount}
              total={flight.totalSeats}
              status={availability.status}
            />
          </div>
          <div className="mt-6">
            <SeatMap
              cabins={flight.cabins}
              booked={availability.booked}
              held={availability.held}
              assignments={assignments}
              pendingSeatId={pendingSeatId}
              disabled={!isSignedIn || isCheckingOut}
              onSelect={handleSelectSeat}
            />
          </div>

          {active.seatId ? (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={handleReleaseActiveSeat}
                disabled={isCheckingOut}
                className="cursor-pointer rounded-pill border border-outline px-[18px] py-[9px] text-[12px] font-medium text-bone-50 transition-colors duration-200 hover:bg-card hover:text-bone disabled:cursor-not-allowed disabled:opacity-45"
              >
                Release {activeSeat?.seatNumber} for passenger {activeIndex + 1}
              </button>
            </div>
          ) : null}

          <div className="mt-6 lg:hidden">
            <StepButton
              label="Next: passenger details"
              disabled={seatsChosen === 0}
              hint={seatsChosen === 0 ? "Choose a seat first" : undefined}
              onClick={() => setStep("details")}
            />
          </div>
        </div>

        {/* Right: who is travelling, then what it costs. */}
        <aside className="flex flex-col gap-5">
          <div className={notice ? "" : "hidden"}>{noticeBlock}</div>

          <div className={onlyOnStep("details")}>
            {/* Chips repeat on mobile only, where the left column is hidden. */}
            <div className="mb-5 lg:hidden">{chips}</div>
            {detailsCard}
            <div className="mt-5 lg:hidden">
              <StepButton label="Next: review and pay" disabled={false} onClick={() => setStep("review")} />
              <BackLink label="Back to the seat map" onClick={() => setStep("seats")} />
            </div>
          </div>

          <div className={onlyOnStep("review")}>
            {summaryCard}
            <div className="lg:hidden">
              <BackLink label="Back to passenger details" onClick={() => setStep("details")} />
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-4 w-full cursor-pointer text-center text-[12px] text-bone-50 underline underline-offset-2"
    >
      {label}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Pieces                                   */
/* -------------------------------------------------------------------------- */

/**
 * One chip per traveller, showing who they are and where they are sitting.
 *
 * Switching chips only changes `activeIndex` — every draft stays in the same
 * array, so names, passports, dates, baggage and seats are all preserved.
 */
function PassengerChips({
  passengers,
  activeIndex,
  seatsById,
  disabled,
  onSelect,
  onAdd,
  onRemove,
}: {
  passengers: PassengerDraft[];
  activeIndex: number;
  seatsById: Map<string, SeatView>;
  disabled: boolean;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Passengers">
        {passengers.map((passenger, index) => {
          const seat = passenger.seatId ? seatsById.get(passenger.seatId) : null;
          const isActive = index === activeIndex;

          return (
            <span key={passenger.id} className="relative">
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelect(index)}
                className={[
                  "flex items-center gap-2 rounded-pill border py-[9px] pl-[14px] transition-colors duration-200",
                  passengers.length > 1 ? "pr-[34px]" : "pr-[14px]",
                  isActive
                    ? "border-amber bg-amber-soft text-bone"
                    : "border-hairline bg-card text-bone-50 hover:border-outline hover:text-bone",
                ].join(" ")}
              >
                <span className="text-[13px] font-medium">
                  {passenger.fullName.trim() || `Passenger ${index + 1}`}
                </span>
                <span
                  className={`numeric rounded-pill px-2 py-[2px] text-[10px] ${
                    seat ? "bg-amber text-stage" : "bg-[rgba(236,230,220,0.08)] text-bone-50"
                  }`}
                >
                  {seat ? seat.seatNumber : "no seat"}
                </span>
              </button>

              {passengers.length > 1 ? (
                <button
                  type="button"
                  aria-label={`Remove passenger ${index + 1}`}
                  disabled={disabled}
                  onClick={() => onRemove(index)}
                  className="absolute right-[8px] top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-pill text-bone-50 transition-colors duration-200 hover:text-bone disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <TrashIcon size={12} />
                </button>
              ) : null}
            </span>
          );
        })}

        {passengers.length < MAX_PASSENGERS ? (
          <button
            type="button"
            onClick={onAdd}
            disabled={disabled}
            className="flex cursor-pointer items-center gap-[6px] rounded-pill border border-dashed border-outline px-[14px] py-[9px] text-[12px] font-medium text-bone-50 transition-colors duration-200 hover:border-bone/40 hover:text-bone disabled:cursor-not-allowed disabled:opacity-45"
          >
            <PlusIcon size={12} />
            Add passenger
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MobileSteps({
  step,
  seatsChosen,
  passengerCount,
  onStep,
}: {
  step: Step;
  seatsChosen: number;
  passengerCount: number;
  onStep: (step: Step) => void;
}) {
  const steps: Array<{ id: Step; label: string; enabled: boolean }> = [
    { id: "seats", label: "Seats", enabled: true },
    { id: "details", label: "Details", enabled: seatsChosen > 0 },
    { id: "review", label: "Review", enabled: seatsChosen > 0 },
  ];

  return (
    <ol className="flex items-center gap-2">
      {steps.map((entry, index) => (
        <li key={entry.id} className="flex flex-1 items-center gap-2">
          <button
            type="button"
            disabled={!entry.enabled}
            aria-current={step === entry.id ? "step" : undefined}
            onClick={() => onStep(entry.id)}
            className={[
              "flex-1 cursor-pointer rounded-pill border px-3 py-[10px] text-[12px] font-medium transition-colors duration-200",
              step === entry.id
                ? "border-amber bg-amber-soft text-bone"
                : "border-hairline bg-card text-bone-50",
              entry.enabled ? "" : "cursor-not-allowed opacity-45",
            ].join(" ")}
          >
            <span className="numeric mr-[6px] text-[10px]">{index + 1}</span>
            {entry.label}
            {entry.id === "seats" && seatsChosen > 0 ? (
              <span className="numeric ml-[6px] text-[10px] text-bone-50">
                {seatsChosen}/{passengerCount}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ol>
  );
}

function StepButton({
  label,
  disabled,
  hint,
  onClick,
}: {
  label: string;
  disabled: boolean;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-pill bg-bone px-[22px] py-[15px] text-[0.875rem] font-semibold text-stage shadow-button transition-[filter,opacity] duration-200 hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {label}
        <ArrowRightIcon size={14} />
      </button>
      {hint ? <p className="mt-2 text-center text-[12px] text-bone-50">{hint}</p> : null}
    </div>
  );
}

function SignInCard() {
  return (
    <section className="rounded-lg border border-hairline bg-stage-lift p-6 shadow-card">
      <h2 className="font-display text-[1.5rem] leading-none tracking-[-0.012em] text-bone">
        Passenger details
      </h2>
      <p className="mt-3 text-[13px] leading-[1.6] text-bone-50">
        Sign in to choose a seat. We hold it for ten minutes while you finish booking.
      </p>
      <Link
        href="/sign-in"
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-pill bg-bone px-[22px] py-[13px] text-[0.8125rem] font-semibold text-stage shadow-button transition-[filter] duration-200 hover:brightness-95"
      >
        Sign in
        <ArrowRightIcon size={13} />
      </Link>
    </section>
  );
}

function Legend({
  available,
  total,
  status,
}: {
  available: number;
  total: number;
  status: ConnectionStatus;
}) {
  // Swatches mirror `seatClasses` in seat-map.tsx exactly. If one changes and
  // the other does not, the legend starts lying about the map.
  const items = [
    { label: "Available", swatch: "border-hairline bg-[#2b2624]", icon: null },
    {
      label: "Your selection",
      swatch: "border-amber bg-amber text-stage",
      icon: <CheckIcon size={11} />,
    },
    {
      label: "Temporarily held",
      swatch:
        "border-divider bg-[#221d1a] text-bone-50 [background-image:repeating-linear-gradient(45deg,transparent_0_3px,rgba(236,230,220,0.11)_3px_6px)]",
      icon: <ClockIcon size={11} />,
    },
    {
      label: "Booked",
      swatch: "border-transparent bg-[#100d0b] text-bone-50/55",
      icon: <CrossIcon size={11} />,
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-hairline bg-stage-lift px-4 py-3">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`flex h-7 w-7 items-center justify-center rounded-[5px] border ${item.swatch}`}
          >
            {item.icon}
          </span>
          <span className="text-[12px] text-bone">{item.label}</span>
        </span>
      ))}
      <span className="ml-auto flex items-center gap-4">
        <span className="numeric text-[11px] text-bone-50">
          {available} of {total} open
        </span>
        <ConnectionBadge status={status} />
      </span>
    </div>
  );
}

/**
 * Quiet by design. When live updates are working there is nothing to say. It
 * only speaks up when the page has stopped receiving pushes — and when it has
 * fallen back to polling it says so, rather than implying updates are still
 * arriving instantly.
 */
function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  if (status === "live") {
    return (
      <span className="flex items-center gap-[6px]" title="Seat availability is live">
        <span aria-hidden="true" className="h-[5px] w-[5px] rounded-pill bg-amber" />
        <span className="eyebrow">Live</span>
      </span>
    );
  }

  const label =
    status === "polling"
      ? "Checking every few seconds"
      : status === "reconnecting"
        ? "Reconnecting…"
        : "Connecting…";

  return (
    <span className="flex items-center gap-[6px]" role="status" aria-live="polite">
      <span aria-hidden="true" className="h-[5px] w-[5px] animate-pulse rounded-pill bg-bone-50" />
      <span className="eyebrow">{label}</span>
    </span>
  );
}
