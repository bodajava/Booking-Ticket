import { z } from "zod";

import { MAX_PASSENGERS } from "./pricing";

/**
 * The contract between Checkout Session creation and the webhook.
 *
 * Stripe caps each metadata *value* at 500 characters but allows up to 50
 * keys, so a party travels as one key per passenger rather than one JSON blob
 * for all of them. Packing four passengers — each with a name, passport,
 * nationality, date of birth, seat id and baggage figure — into a single value
 * would overflow that cap, and the previous single-key encoding threw rather
 * than truncate. One key each keeps every field intact with room to spare.
 *
 * Field names are single letters for the same reason: this is a wire format
 * read only by the webhook, and the space saved is space a passenger's name
 * can use.
 */

const STRIPE_METADATA_VALUE_LIMIT = 500;

/** ISO 8601 calendar date, no time component. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Not a real date");

export const passengerMetadataSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  passportNumber: z.string().trim().min(1).max(20),
  /** ISO 3166-1 alpha-2, uppercase. */
  nationality: z.string().trim().length(2).regex(/^[A-Z]{2}$/).optional(),
  dateOfBirth: isoDateSchema.optional(),
  seatId: z.uuid(),
  extraBaggageKg: z.number().int().min(0).max(99).default(0),
});

export type PassengerMetadata = z.infer<typeof passengerMetadataSchema>;

/** The compact on-the-wire shape. */
const wirePassengerSchema = z.object({
  n: z.string().trim().min(1).max(200),
  p: z.string().trim().min(1).max(20),
  c: z.string().trim().length(2).optional(),
  d: isoDateSchema.optional(),
  s: z.uuid(),
  b: z.number().int().min(0).max(99).optional(),
});

function toWire(passenger: PassengerMetadata) {
  return {
    n: passenger.fullName,
    p: passenger.passportNumber,
    ...(passenger.nationality ? { c: passenger.nationality } : {}),
    ...(passenger.dateOfBirth ? { d: passenger.dateOfBirth } : {}),
    s: passenger.seatId,
    ...(passenger.extraBaggageKg ? { b: passenger.extraBaggageKg } : {}),
  };
}

function fromWire(wire: z.infer<typeof wirePassengerSchema>): PassengerMetadata {
  return {
    fullName: wire.n,
    passportNumber: wire.p,
    nationality: wire.c,
    dateOfBirth: wire.d,
    seatId: wire.s,
    extraBaggageKg: wire.b ?? 0,
  };
}

/**
 * Parse the metadata Stripe hands back.
 *
 * Also accepts the older single-`passengers` encoding, so a session created
 * before this change still fulfils correctly if its webhook arrives after the
 * deploy. Dropping that would mean silently failing to issue a ticket someone
 * has already paid for.
 */
export const checkoutMetadataSchema = z
  .object({
    flightId: z.uuid(),
    userId: z.string().trim().min(1),
  })
  .catchall(z.string())
  .transform((raw, ctx) => {
    const passengers: PassengerMetadata[] = [];

    const fail = (message: string) => {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    };

    const legacy = raw["passengers"];
    if (typeof legacy === "string") {
      try {
        const parsed = z
          .array(
            z.object({
              fullName: z.string(),
              passportNumber: z.string(),
              seatId: z.uuid(),
              extraBaggageKg: z.number().int().min(0).max(99).optional(),
            }),
          )
          .min(1)
          .parse(JSON.parse(legacy));

        for (const entry of parsed) {
          passengers.push({ ...entry, extraBaggageKg: entry.extraBaggageKg ?? 0 });
        }
      } catch {
        return fail("legacy passengers value is not usable");
      }
    } else {
      const count = Number(raw["passengerCount"]);
      if (!Number.isInteger(count) || count < 1 || count > MAX_PASSENGERS) {
        return fail("passengerCount is missing or out of range");
      }

      for (let index = 0; index < count; index++) {
        const value = raw[`p${index}`];
        if (typeof value !== "string") return fail(`passenger p${index} is missing`);

        try {
          passengers.push(fromWire(wirePassengerSchema.parse(JSON.parse(value))));
        } catch {
          return fail(`passenger p${index} is not usable`);
        }
      }
    }

    // Two passengers on one seat would trip the unique index mid-transaction.
    const seatIds = new Set(passengers.map((p) => p.seatId));
    if (seatIds.size !== passengers.length) return fail("duplicate seat in passengers");

    return { flightId: raw.flightId, userId: raw.userId, passengers };
  });

export type CheckoutMetadata = z.infer<typeof checkoutMetadataSchema>;

/**
 * Build the metadata object to attach to a Checkout Session.
 *
 * Fails loudly at session-creation time if any value would be truncated by
 * Stripe — far better than discovering it in the webhook after taking money.
 */
export function encodeCheckoutMetadata(input: {
  flightId: string;
  userId: string;
  passengers: PassengerMetadata[];
}): Record<string, string> {
  if (input.passengers.length < 1 || input.passengers.length > MAX_PASSENGERS) {
    throw new Error(`A booking covers 1-${MAX_PASSENGERS} passengers`);
  }

  const metadata: Record<string, string> = {
    flightId: input.flightId,
    userId: input.userId,
    passengerCount: String(input.passengers.length),
  };

  input.passengers.forEach((passenger, index) => {
    const encoded = JSON.stringify(toWire(passenger));

    if (encoded.length > STRIPE_METADATA_VALUE_LIMIT) {
      throw new Error(
        `Passenger ${index + 1} encodes to ${encoded.length} chars, over Stripe's ` +
          `${STRIPE_METADATA_VALUE_LIMIT} limit.`,
      );
    }

    metadata[`p${index}`] = encoded;
  });

  return metadata;
}
