import { MAX_EXTRA_BAGGAGE_KG } from "@/lib/pricing";

/**
 * One traveller's in-progress details.
 *
 * Kept as plain data, separate from the seat map's state, so switching between
 * passengers is a change of index rather than a re-render that could drop what
 * someone has typed. Everything here is a draft until checkout validates it
 * server-side — these rules exist to give fast feedback, not to be the thing
 * that keeps bad data out of a booking.
 */
export type PassengerDraft = {
  /** Stable across re-orders, so React keys and chips never swap identities. */
  id: string;
  fullName: string;
  passportNumber: string;
  /** ISO 3166-1 alpha-2. */
  nationality: string;
  /** YYYY-MM-DD. */
  dateOfBirth: string;
  seatId: string | null;
  extraBaggageKg: number;
};

export type PassengerErrors = Partial<
  Record<"fullName" | "passportNumber" | "nationality" | "dateOfBirth" | "seat", string>
>;

export function emptyPassenger(id: string): PassengerDraft {
  return {
    id,
    fullName: "",
    passportNumber: "",
    nationality: "",
    dateOfBirth: "",
    seatId: null,
    extraBaggageKg: 0,
  };
}

/** Mirrors `checkoutPassengerSchema` in actions.ts, message for message. */
export function validatePassenger(passenger: PassengerDraft): PassengerErrors {
  const errors: PassengerErrors = {};

  if (passenger.fullName.trim().length < 2) {
    errors.fullName = "Enter the passenger's full name as printed on their passport";
  }

  const passport = passenger.passportNumber.trim();
  if (passport.length < 4) {
    errors.passportNumber = "Enter a valid passport number";
  } else if (!/^[A-Za-z0-9]+$/.test(passport)) {
    errors.passportNumber = "Passport numbers are letters and digits only";
  }

  if (!/^[A-Za-z]{2}$/.test(passenger.nationality)) {
    errors.nationality = "Choose the country that issued the passport";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(passenger.dateOfBirth)) {
    errors.dateOfBirth = "Enter the date of birth";
  } else {
    const date = new Date(`${passenger.dateOfBirth}T00:00:00Z`);
    const now = Date.now();
    if (
      Number.isNaN(date.getTime()) ||
      date.getTime() >= now ||
      date.getTime() <= now - 130 * 365.25 * 864e5
    ) {
      errors.dateOfBirth = "Enter a valid date of birth";
    }
  }

  if (!passenger.seatId) {
    errors.seat = "Choose a seat for this passenger";
  }

  return errors;
}

export const isComplete = (errors: PassengerErrors) => Object.keys(errors).length === 0;

export function clampBaggage(kg: number): number {
  if (!Number.isFinite(kg)) return 0;
  return Math.min(Math.max(Math.round(kg), 0), MAX_EXTRA_BAGGAGE_KG);
}

/**
 * What still stands between the traveller and payment, in plain words.
 *
 * Returned as a list rather than a single message because a party of three
 * with two problems deserves to see both, not to fix one and discover the
 * other.
 */
export function blockingReasons(
  passengers: PassengerDraft[],
  errorsFor: (p: PassengerDraft) => PassengerErrors,
): string[] {
  const reasons: string[] = [];

  passengers.forEach((passenger, index) => {
    const errors = errorsFor(passenger);
    if (isComplete(errors)) return;

    const who = passenger.fullName.trim() || `Passenger ${index + 1}`;
    reasons.push(
      errors.seat
        ? `${who} still needs a seat`
        : `${who} still needs their details completed`,
    );
  });

  return reasons;
}
