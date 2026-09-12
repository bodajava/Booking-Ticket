import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  throw new Error("STRIPE_SECRET_KEY is not set. Add it to .env.local");
}

/**
 * No explicit `apiVersion`: the SDK pins the version it was built against
 * (2026-08-26.dahlia), so the runtime payloads always match the TS types.
 */
export const stripe = new Stripe(secretKey);

export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set. Add it to .env.local");
  }
  return secret;
}

/**
 * Stripe reports amounts in the currency's minor unit, except for currencies
 * that have none. Dividing those by 100 would under-charge the booking by 100x.
 * @see https://docs.stripe.com/currencies#zero-decimal
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
  "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

/** Convert a Stripe amount into the decimal string `numeric(10,2)` expects. */
export function stripeAmountToDecimal(amount: number, currency: string): string {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase())
    ? amount.toFixed(2)
    : (amount / 100).toFixed(2);
}
