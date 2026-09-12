"use client";

import { EXTRA_BAGGAGE_STEP_KG, MAX_EXTRA_BAGGAGE_KG, formatCents } from "@/lib/pricing";
import { LuggageIcon } from "./icons";

/**
 * Extra baggage, priced from the selected seat.
 *
 * The rate is `seats.extra_baggage_price_per_kg` for the seat the user is
 * actually holding — Business and Economy carry different allowances *and*
 * different per-kilo rates, so this control cannot be rendered until a seat
 * exists. The arithmetic shown here is optimistic; the price that reaches
 * Stripe is recomputed from the same database row on the server.
 */
export function BaggageSelector({
  allowanceKg,
  perKgCents,
  extraKg,
  baggageCents,
  disabled,
  onChange,
  onStep,
}: {
  allowanceKg: number;
  perKgCents: number;
  extraKg: number;
  baggageCents: number;
  disabled: boolean;
  /** Absolute value — the slider always knows the number it wants. */
  onChange: (kg: number) => void;
  /**
   * Relative nudge. The steppers must not compute `extraKg + 1` themselves:
   * ten fast clicks all read the same pre-render `extraKg` and every one of
   * them resolves to 1kg. The parent applies the delta functionally instead.
   */
  onStep: (delta: number) => void;
}) {
  const clamp = (kg: number) => Math.min(Math.max(kg, 0), MAX_EXTRA_BAGGAGE_KG);

  return (
    <section aria-labelledby="baggage-heading" className="border-t border-hairline pt-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3
            id="baggage-heading"
            className="flex items-center gap-2 text-[13px] font-semibold text-bone"
          >
            <LuggageIcon size={14} />
            Baggage
          </h3>
          <p className="mt-1 text-[12px] leading-[1.5] text-bone-50">
            {allowanceKg}kg is included with this seat.
          </p>
        </div>
        <span className="numeric shrink-0 text-[11px] text-bone-50">
          {formatCents(perKgCents)}/kg
        </span>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <StepButton
          label="Remove a kilo of extra baggage"
          disabled={disabled || extraKg <= 0}
          onClick={() => onStep(-EXTRA_BAGGAGE_STEP_KG)}
        >
          −
        </StepButton>

        <label className="flex-1">
          <span className="sr-only">Extra baggage in kilos</span>
          <input
            type="range"
            min={0}
            max={MAX_EXTRA_BAGGAGE_KG}
            step={EXTRA_BAGGAGE_STEP_KG}
            value={extraKg}
            disabled={disabled}
            onChange={(event) => onChange(clamp(Number(event.target.value)))}
            aria-valuetext={`${extraKg} extra kilos, ${formatCents(baggageCents)}`}
            className="h-1 w-full cursor-pointer appearance-none rounded-pill bg-[rgba(236,230,220,0.14)] accent-amber disabled:cursor-not-allowed disabled:opacity-45"
          />
        </label>

        <StepButton
          label="Add a kilo of extra baggage"
          disabled={disabled || extraKg >= MAX_EXTRA_BAGGAGE_KG}
          onClick={() => onStep(EXTRA_BAGGAGE_STEP_KG)}
        >
          +
        </StepButton>
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <span className="numeric text-[13px] text-bone">
          {extraKg === 0 ? "No extra baggage" : `+${extraKg}kg extra`}
        </span>
        <span className="numeric text-[13px] text-bone-50">
          {extraKg === 0 ? "Included" : formatCents(baggageCents)}
        </span>
      </div>

      {extraKg > 0 ? (
        <p className="mt-1 text-[12px] text-bone-50">
          Total checked allowance {allowanceKg + extraKg}kg.
        </p>
      ) : null}
    </section>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-pill border border-outline bg-transparent text-[15px] font-medium text-bone transition-colors duration-200 hover:bg-card disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
