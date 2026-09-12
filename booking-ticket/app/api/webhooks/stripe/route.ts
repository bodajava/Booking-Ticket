import type Stripe from "stripe";

import { checkoutMetadataSchema } from "@/lib/checkout-metadata";
import { fulfillCheckout, releaseHeldSeats } from "@/lib/fulfillment";
import { sendBookingConfirmation } from "@/lib/email/send";
import { getWebhookSecret, stripe, stripeAmountToDecimal } from "@/lib/stripe";
import { verifyByToken } from "@/lib/verification";

/** Signature verification needs Node crypto and the unparsed request body. */
export const runtime = "nodejs";

/**
 * Fulfilment is a Postgres transaction, a set of Redis releases and an SMTP
 * handshake. Timing out mid-way returns a non-2xx, which makes Stripe retry —
 * safe, because the handler is idempotent, but slow for the traveller waiting
 * on their confirmation.
 */
export const maxDuration = 60;

/**
 * Response conventions, which drive Stripe's retry behaviour:
 *
 *   400 — the request is not from Stripe, or is unusable. Never retried.
 *   200 — handled, or deliberately ignored. Stops redelivery.
 *   500 — transient failure on our side. Stripe retries with backoff.
 *
 * The only outcome that must return 500 is one where retrying could still
 * succeed. Returning 500 for a permanent problem just wedges the event queue.
 */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  // Must be the raw bytes: any reserialisation invalidates the signature.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      getWebhookSecret(),
    );
  } catch (error) {
    // Covers a forged signature and a stale timestamp outside the tolerance
    // window, which is what blocks replay attacks.
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`[stripe-webhook] rejected: ${message}`);
    return new Response(`Webhook signature verification failed: ${message}`, {
      status: 400,
    });
  }

  if (event.type !== "checkout.session.completed") {
    return Response.json({ received: true, ignored: event.type });
  }

  const session = event.data.object;

  // `checkout.session.completed` also fires for async payment methods that have
  // not settled. Only `paid` means the money is actually there.
  if (session.payment_status !== "paid") {
    return Response.json({
      received: true,
      ignored: `payment_status=${session.payment_status}`,
    });
  }

  const metadata = checkoutMetadataSchema.safeParse(session.metadata ?? {});

  if (!metadata.success) {
    // Unfixable by retrying — the session was created with bad metadata.
    console.error(
      `[stripe-webhook] ${event.id}: unusable metadata`,
      metadata.error.issues,
    );
    return new Response("Invalid checkout session metadata", { status: 400 });
  }

  if (session.amount_total === null) {
    console.error(`[stripe-webhook] ${event.id}: session has no amount_total`);
    return new Response("Checkout session has no amount_total", { status: 400 });
  }

  // Price comes from what Stripe charged, never from client-supplied metadata.
  const totalPrice = stripeAmountToDecimal(
    session.amount_total,
    session.currency ?? "usd",
  );

  try {
    const result = await fulfillCheckout({
      eventId: event.id,
      flightId: metadata.data.flightId,
      userId: metadata.data.userId,
      totalPrice,
      stripePaymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null),
      passengers: metadata.data.passengers,
    });

    switch (result.status) {
      case "duplicate":
        // Already fulfilled by an earlier delivery. Nothing was written.
        return Response.json({ received: true, status: "duplicate" });

      case "invalid_seats":
        console.error(
          `[stripe-webhook] ${event.id}: seats not on flight ${metadata.data.flightId}`,
          result.seatIds,
        );
        return new Response("Seats do not belong to this flight", {
          status: 400,
        });

      case "seats_unavailable":
        // Money was taken for seats someone else confirmed first. Retrying
        // cannot help, so acknowledge and escalate for a refund.
        console.error(
          `[stripe-webhook] ${event.id}: REFUND REQUIRED — payment_intent=${session.payment_intent} ` +
            `seats already booked: ${result.seatIds.join(", ")}`,
        );
        return Response.json({ received: true, status: "seats_unavailable" });

      case "created": {
        await releaseHeldSeats(
          metadata.data.flightId,
          result.seatIds,
          metadata.data.userId,
        );

        // Confirmation email with the boarding-pass QR code. Read back through
        // the same verification path a scanner uses, so the email can never
        // show details the scan would contradict.
        //
        // Awaited but never allowed to throw: Stripe retries a non-2xx, and a
        // retry re-enters fulfilment for a booking that already exists. The
        // ticket is valid whether or not the mail lands.
        const verified = await verifyByToken(result.verificationToken).catch(() => null);

        if (verified?.outcome === "found") {
          await sendBookingConfirmation({
            to: session.customer_details?.email ?? null,
            pass: verified.pass,
            verificationToken: result.verificationToken,
          });
        } else {
          console.error(
            `[stripe-webhook] ${event.id}: could not read back ${result.pnr} for email`,
          );
        }

        console.info(
          `[stripe-webhook] ${event.id}: booking ${result.pnr} confirmed`,
        );
        return Response.json({
          received: true,
          status: "created",
          pnr: result.pnr,
        });
      }
    }
  } catch (error) {
    // Transaction rolled back, so the event id was never recorded and the
    // retry will re-run cleanly.
    console.error(`[stripe-webhook] ${event.id}: fulfillment failed`, error);
    return new Response("Fulfillment failed", { status: 500 });
  }
}
