import { auth } from "@clerk/nextjs/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { bookings, passengers } from "@/db/schema";
import { checkoutMetadataSchema } from "@/lib/checkout-metadata";
import { centsToDecimal, decimalToCents, formatCents } from "@/lib/pricing";
import { stripe } from "@/lib/stripe";
import { PendingRefresh } from "./pending-refresh";

/**
 * Where Stripe returns the traveller.
 *
 * This page only *reads*. The booking is created by the signed
 * `checkout.session.completed` webhook, which is the only thing that has
 * verified the payment — a success redirect can be forged by anyone who can
 * type a URL. So the page waits for the webhook's row to appear rather than
 * writing one, and says so plainly while it waits.
 */
export const dynamic = "force-dynamic";

export default async function ConfirmedPage({
  searchParams,
}: PageProps<"/bookings/confirmed">) {
  const { session_id: sessionId } = await searchParams;

  if (typeof sessionId !== "string" || sessionId.length === 0) {
    redirect("/flights");
  }

  const { userId } = await auth();

  // Carry the session id through sign-in. Losing it here would strand a
  // traveller who has already paid on a page that can no longer identify
  // their booking.
  if (!userId) {
    const returnTo = `/bookings/confirmed?session_id=${encodeURIComponent(sessionId)}`;
    redirect(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);
  }

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    // An unknown or malformed id — nothing to show, and nothing to leak.
    redirect("/flights");
  }

  // The session belongs to whoever created it. Anyone else asking gets nothing,
  // and is told nothing about whether the id was real.
  if (session.client_reference_id !== userId) {
    redirect("/flights");
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  // Primary lookup: the PaymentIntent the webhook recorded.
  let [booking] = paymentIntentId
    ? await db
        .select()
        .from(bookings)
        .where(
          and(eq(bookings.stripePaymentIntentId, paymentIntentId), eq(bookings.userId, userId)),
        )
        .limit(1)
    : [];

  // Fallback: find it by the seat this session bought.
  //
  // The webhook is what confirms a payment, and it has already run by the time
  // a booking exists — so a booking that exists must be shown even if the
  // Checkout Session we just fetched has not caught up and still reports no
  // PaymentIntent. A seat maps to at most one live booking (unique index on
  // `passengers.selected_seat_id`), so this is exact rather than a guess. Still
  // scoped to `userId`, so it can only ever surface the caller's own booking.
  if (!booking) {
    const metadata = checkoutMetadataSchema.safeParse(session.metadata ?? {});
    const seatIds = metadata.success ? metadata.data.passengers.map((p) => p.seatId) : [];

    if (seatIds.length > 0) {
      [booking] = await db
        .select({
          id: bookings.id,
          pnr: bookings.pnr,
          totalPrice: bookings.totalPrice,
          status: bookings.status,
          flightId: bookings.flightId,
          userId: bookings.userId,
          stripePaymentIntentId: bookings.stripePaymentIntentId,
          verificationToken: bookings.verificationToken,
          createdAt: bookings.createdAt,
          updatedAt: bookings.updatedAt,
        })
        .from(bookings)
        .innerJoin(passengers, eq(passengers.bookingId, bookings.id))
        .where(
          and(
            eq(bookings.userId, userId),
            inArray(passengers.selectedSeatId, seatIds),
            ne(bookings.status, "CANCELLED"),
          ),
        )
        .limit(1);
    }
  }

  // Stripe's own view of the payment, used only to choose between "we are
  // still issuing your ticket" and "nothing was charged". The booking row
  // above is what actually confirms a sale.
  const paid = session.payment_status === "paid";
  const awaitingWebhook = paid && !booking;

  return (
    <main className="mx-auto w-full max-w-[620px] flex-1 px-4 py-16 sm:px-8 sm:py-24">
      {awaitingWebhook ? <PendingRefresh /> : null}

      <span className="eyebrow">
        {booking ? "Confirmed" : paid ? "Payment received" : "Payment not completed"}
      </span>

      <h1 className="mt-3 font-display text-[2.75rem] italic leading-[1.04] tracking-[-0.02em] text-bone sm:text-[3.5rem]">
        {booking ? "You're booked" : paid ? "Issuing your ticket" : "Nothing was charged"}
      </h1>

      {booking ? (
        <div className="mt-8 rounded-lg border border-hairline bg-stage-lift p-6 shadow-card">
          <span className="eyebrow">Booking reference</span>
          <p className="numeric mt-2 text-[2rem] tracking-[0.08em] text-amber">{booking.pnr}</p>
          <dl className="mt-6 flex flex-col gap-2 border-t border-hairline pt-4 text-[13px]">
            <div className="flex items-baseline justify-between">
              <dt className="text-bone-50">Paid</dt>
              <dd className="numeric text-bone">
                {formatCents(decimalToCents(booking.totalPrice))}
              </dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-bone-50">Status</dt>
              <dd className="text-bone">{booking.status}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="mt-6 max-w-[60ch]">
          <p className="text-[15px] leading-[1.6] text-bone-50">
            {paid
              ? "Your payment went through. We're issuing the ticket now — your booking reference will appear here in a moment."
              : "This checkout was not completed, so nothing has been charged and no seat has been booked."}
          </p>

          {awaitingWebhook ? (
            <p
              className="numeric mt-4 flex items-center gap-2 text-[12px] text-bone-50"
              role="status"
              aria-live="polite"
            >
              <span
                aria-hidden="true"
                className="h-[5px] w-[5px] animate-pulse rounded-pill bg-amber"
              />
              {formatCents(
                session.amount_total ?? decimalToCents(centsToDecimal(0)),
                session.currency ?? "usd",
              )}{" "}
              paid · confirming
            </p>
          ) : null}
        </div>
      )}

      <Link
        href="/flights"
        className="mt-8 inline-flex items-center rounded-pill border border-outline px-[22px] py-[11px] text-[0.8125rem] font-medium text-bone transition-colors duration-200 hover:bg-card"
      >
        {booking ? "Book another flight" : "Back to flights"}
      </Link>
    </main>
  );
}
