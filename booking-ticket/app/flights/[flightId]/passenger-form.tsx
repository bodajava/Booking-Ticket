"use client";

import { EXTRA_BAGGAGE_STEP_KG, MAX_EXTRA_BAGGAGE_KG, formatCents } from "@/lib/pricing";
import { COUNTRIES } from "./countries";
import { LuggageIcon } from "./icons";
import type { PassengerDraft, PassengerErrors } from "./booking-state";

/**
 * Everything the airline needs about one traveller.
 *
 * Errors are shown only after a field has been touched or a checkout attempt
 * has been made, so the card does not greet someone with four red messages
 * before they have typed anything. Every input keeps a persistent visible
 * label — a placeholder disappears the moment someone types, which is exactly
 * when they most need to know what the field is.
 */
export function PassengerForm({
  index,
  passenger,
  errors,
  seatLabel,
  seatClass,
  allowanceKg,
  perKgCents,
  baggageCents,
  disabled,
  onChange,
  onStepBaggage,
  onBlurField,
}: {
  index: number;
  passenger: PassengerDraft;
  errors: PassengerErrors;
  seatLabel: string | null;
  seatClass: string | null;
  allowanceKg: number | null;
  perKgCents: number | null;
  baggageCents: number;
  disabled: boolean;
  onChange: (patch: Partial<PassengerDraft>) => void;
  onStepBaggage: (delta: number) => void;
  onBlurField: (field: keyof PassengerErrors) => void;
}) {
  return (
    <section
      aria-labelledby={`passenger-${index}-heading`}
      className="rounded-lg border border-hairline bg-stage-lift p-5 shadow-card sm:p-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
        <h2
          id={`passenger-${index}-heading`}
          className="font-display text-[1.5rem] leading-none tracking-[-0.012em] text-bone"
        >
          Passenger #{index + 1} details
        </h2>

        {seatLabel ? (
          <span className="flex items-center gap-2 rounded-pill border border-amber/40 bg-amber-soft px-3 py-[6px]">
            <span className="numeric text-[13px] font-semibold text-amber">{seatLabel}</span>
            <span className="eyebrow text-bone-50">{seatClass}</span>
          </span>
        ) : (
          <span className="rounded-pill border border-outline px-3 py-[6px] text-[12px] text-bone-50">
            No seat chosen
          </span>
        )}
      </header>

      <div className="mt-5 flex flex-col gap-4">
        <Field
          id={`p${index}-name`}
          label="Full legal name"
          hint="Exactly as printed on the passport"
          value={passenger.fullName}
          error={errors.fullName}
          disabled={disabled}
          autoComplete="off"
          placeholder="e.g. Nadia Haddad"
          onChange={(v) => onChange({ fullName: v })}
          onBlur={() => onBlurField("fullName")}
        />

        {/* Passport and issuing country sit together: they are one fact. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id={`p${index}-passport`}
            label="Passport number"
            value={passenger.passportNumber}
            error={errors.passportNumber}
            disabled={disabled}
            autoComplete="off"
            placeholder="A1234567"
            mono
            onChange={(v) => onChange({ passportNumber: v.toUpperCase() })}
            onBlur={() => onBlurField("passportNumber")}
          />

          <div>
            <label htmlFor={`p${index}-nationality`} className="eyebrow mb-[6px] block">
              Nationality
            </label>
            <select
              id={`p${index}-nationality`}
              value={passenger.nationality}
              disabled={disabled}
              aria-invalid={Boolean(errors.nationality)}
              aria-describedby={errors.nationality ? `p${index}-nationality-error` : undefined}
              onChange={(e) => onChange({ nationality: e.target.value })}
              onBlur={() => onBlurField("nationality")}
              className={inputClasses(Boolean(errors.nationality))}
            >
              <option value="">Select a country</option>
              {COUNTRIES.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </select>
            <FieldError id={`p${index}-nationality-error`} message={errors.nationality} />
          </div>
        </div>

        <div>
          <label htmlFor={`p${index}-dob`} className="eyebrow mb-[6px] block">
            Date of birth
          </label>
          <input
            id={`p${index}-dob`}
            type="date"
            value={passenger.dateOfBirth}
            disabled={disabled}
            max={new Date().toISOString().slice(0, 10)}
            aria-invalid={Boolean(errors.dateOfBirth)}
            aria-describedby={errors.dateOfBirth ? `p${index}-dob-error` : undefined}
            onChange={(e) => onChange({ dateOfBirth: e.target.value })}
            onBlur={() => onBlurField("dateOfBirth")}
            className={`${inputClasses(Boolean(errors.dateOfBirth))} numeric [color-scheme:dark]`}
          />
          <FieldError id={`p${index}-dob-error`} message={errors.dateOfBirth} />
        </div>
      </div>

      {/* Baggage belongs to the passenger, not the booking: each traveller
          carries their own allowance and buys their own extra kilos. */}
      <section
        aria-labelledby={`p${index}-baggage`}
        className="mt-6 border-t border-hairline pt-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3
              id={`p${index}-baggage`}
              className="flex items-center gap-2 text-[13px] font-semibold text-bone"
            >
              <LuggageIcon size={14} />
              Checked baggage
            </h3>
            <p className="mt-1 text-[12px] leading-[1.5] text-bone-50">
              {allowanceKg === null
                ? "Choose a seat to see the included allowance."
                : `${allowanceKg}kg included with this seat.`}
            </p>
          </div>
          {perKgCents !== null ? (
            <span className="numeric shrink-0 text-[11px] text-bone-50">
              {formatCents(perKgCents)}/kg extra
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex items-center gap-4">
          <StepButton
            label={`Remove a kilo for passenger ${index + 1}`}
            disabled={disabled || passenger.extraBaggageKg <= 0 || allowanceKg === null}
            onClick={() => onStepBaggage(-EXTRA_BAGGAGE_STEP_KG)}
          >
            −
          </StepButton>

          <div className="flex-1 text-center">
            <p className="numeric text-[19px] leading-none text-bone">
              {allowanceKg === null ? "—" : `${allowanceKg + passenger.extraBaggageKg}kg`}
            </p>
            <p className="mt-1 text-[12px] text-bone-50">
              {passenger.extraBaggageKg === 0
                ? "Included allowance"
                : `+${passenger.extraBaggageKg}kg · ${formatCents(baggageCents)}`}
            </p>
          </div>

          <StepButton
            label={`Add a kilo for passenger ${index + 1}`}
            disabled={
              disabled ||
              passenger.extraBaggageKg >= MAX_EXTRA_BAGGAGE_KG ||
              allowanceKg === null
            }
            onClick={() => onStepBaggage(EXTRA_BAGGAGE_STEP_KG)}
          >
            +
          </StepButton>
        </div>
      </section>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function inputClasses(hasError: boolean): string {
  return [
    "h-12 w-full rounded-md border bg-card px-3 text-[14px] text-bone",
    "transition-colors duration-200 placeholder:text-bone-50/60",
    "focus:outline-none disabled:cursor-not-allowed disabled:opacity-45",
    hasError
      ? "border-[#991B1B] focus:border-[#991B1B]"
      : "border-hairline hover:border-bone/40 focus:border-amber",
  ].join(" ");
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-[6px] text-[12px] leading-[1.4] text-[#e2a0a0]">
      {message}
    </p>
  );
}

function Field({
  id,
  label,
  hint,
  value,
  error,
  disabled,
  autoComplete,
  placeholder,
  mono,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  error?: string;
  disabled: boolean;
  autoComplete: string;
  placeholder: string;
  mono?: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="eyebrow mb-[6px] block">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        disabled={disabled}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={`${inputClasses(Boolean(error))} ${mono ? "numeric tracking-[0.04em]" : ""}`}
      />
      {error ? (
        <FieldError id={`${id}-error`} message={error} />
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-[6px] text-[12px] text-bone-50">
          {hint}
        </p>
      ) : null}
    </div>
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
      className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-pill border border-outline bg-transparent text-[17px] font-medium text-bone transition-colors duration-200 hover:bg-card disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
