"use client";

import { CURRENCY, formatCents } from "@/lib/pricing";
import type { SerializableQuote, SerializableTotals } from "./actions";
import { AlertIcon, ArrowRightIcon } from "./icons";
import { HoldTimer } from "./hold-timer";

/**
 * What the traveller is being asked to pay, and why.
 *
 * Every line is server-computed. The base fare, the cabin surcharge and the
 * baggage are shown separately rather than as one total because a Business
 * passenger is entitled to see what the uplift actually is, and because a
 * summary that only shows a grand total gives someone no way to spot a mistake
 * before paying.
 */
export function FareSummary({
  quotes,
  totals,
  passengerNames,
  holdExpiresAt,
  holdTotalMs,
  blockingReasons,
  isCheckingOut,
  onExpire,
  onCheckout,
}: {
  quotes: SerializableQuote[];
  totals: SerializableTotals | null;
  passengerNames: string[];
  holdExpiresAt: number | null;
  holdTotalMs: number;
  blockingReasons: string[];
  isCheckingOut: boolean;
  onExpire: () => void;
  onCheckout: () => void;
}) {
  const ready = blockingReasons.length === 0 && quotes.length > 0 && totals !== null;

  return (
    <section
      aria-labelledby="fare-summary-heading"
      className="rounded-lg border border-hairline bg-stage-lift p-5 shadow-card sm:p-6"
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-4">
        <h2
          id="fare-summary-heading"
          className="font-display text-[1.5rem] leading-none tracking-[-0.012em] text-bone"
        >
          Fare summary
        </h2>
        <span className="eyebrow">{CURRENCY.toUpperCase()}</span>
      </div>

      {/* The countdown lives here rather than over the form, so it can never
          cover a field someone is typing into. */}
      {holdExpiresAt !== null ? (
        <div className="mt-4">
          <HoldTimer
            key={holdExpiresAt}
            expiresAt={holdExpiresAt}
            totalMs={holdTotalMs}
            onExpire={onExpire}
          />
        </div>
      ) : null}

      {quotes.length === 0 ? (
        <p className="mt-5 text-[13px] leading-[1.6] text-bone-50">
          Choose a seat to see the fare.
        </p>
      ) : (
        <>
          <ul className="mt-5 flex flex-col gap-4">
            {quotes.map((quote, index) => (
              <li key={quote.seatId} className="border-b border-hairline pb-4 last:border-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-semibold text-bone">
                    {passengerNames[index]?.trim() || `Passenger ${index + 1}`}
                  </span>
                  <span className="numeric text-[11px] text-bone-50">
                    {quote.seatNumber} · {quote.seatClass}
                  </span>
                </div>

                <dl className="mt-2 flex flex-col gap-[6px] text-[13px]">
                  <Line label="Base fare" value={formatCents(quote.baseFareCents)} />
                  {quote.seatSurchargeCents > 0 ? (
                    <Line
                      label={`${quote.seatClass} seat surcharge`}
                      value={formatCents(quote.seatSurchargeCents)}
                    />
                  ) : null}
                  {quote.extraBaggageKg > 0 ? (
                    <Line
                      label={`Extra baggage · ${quote.extraBaggageKg}kg`}
                      value={formatCents(quote.baggageCents)}
                    />
                  ) : (
                    <Line label="Checked baggage" value={`${quote.allowanceKg}kg included`} muted />
                  )}
                </dl>
              </li>
            ))}
          </ul>

          {totals ? (
            <dl className="mt-5 flex flex-col gap-[6px] border-t border-hairline pt-4 text-[13px]">
              <Line
                label={`Base fares · ${totals.passengerCount} ${totals.passengerCount === 1 ? "passenger" : "passengers"}`}
                value={formatCents(totals.baseFareCents)}
              />
              {totals.seatSurchargeCents > 0 ? (
                <Line label="Seat surcharges" value={formatCents(totals.seatSurchargeCents)} />
              ) : null}
              {totals.baggageCents > 0 ? (
                <Line label="Extra baggage" value={formatCents(totals.baggageCents)} />
              ) : null}

              <div className="mt-3 flex items-baseline justify-between border-t border-hairline pt-4">
                <dt className="text-[14px] font-semibold text-bone">Total</dt>
                <dd className="numeric text-[22px] font-semibold text-bone">
                  {formatCents(totals.grandTotalCents)}
                  <span className="eyebrow ml-2">{totals.currency.toUpperCase()}</span>
                </dd>
              </div>
            </dl>
          ) : null}
        </>
      )}

      {/* Say what is missing *before* the button is reached for, not after. */}
      {blockingReasons.length > 0 ? (
        <div
          role="status"
          aria-live="polite"
          className="mt-5 rounded-md border border-divider bg-card p-3"
        >
          <p className="flex items-center gap-2 text-[12px] font-semibold text-bone">
            <AlertIcon size={13} />
            Before you pay
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {blockingReasons.map((reason) => (
              <li key={reason} className="text-[12px] leading-[1.5] text-bone-50">
                {reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onCheckout}
        disabled={!ready || isCheckingOut}
        className="mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-pill bg-bone px-[22px] py-[15px] text-[0.875rem] font-semibold text-stage shadow-button transition-[filter,opacity] duration-200 hover:brightness-95 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45"
      >
        {isCheckingOut ? "Opening payment…" : "Continue to payment"}
        {isCheckingOut ? null : <ArrowRightIcon size={14} />}
      </button>

      <p className="mt-3 text-center text-[11px] leading-[1.5] text-bone-50">
        You pay on Stripe&apos;s secure page. Your seats stay held until then.
      </p>
    </section>
  );
}

function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-bone-50">{label}</dt>
      <dd className={`numeric ${muted ? "text-bone-50" : "text-bone"}`}>{value}</dd>
    </div>
  );
}
