"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls for the booking while the webhook is still in flight.
 *
 * The success redirect and the webhook are independent: Stripe sends the
 * browser back the moment payment succeeds, which is often a beat before the
 * signed `checkout.session.completed` delivery has been processed. Rather than
 * ask the user to reload, re-render the page until the booking row appears.
 *
 * Deliberately bounded. If the webhook has not landed after a minute something
 * is wrong upstream, and spinning forever would just hide it.
 */
const INTERVAL_MS = 2500;
const MAX_ATTEMPTS = 24;

export function PendingRefresh() {
  const router = useRouter();

  useEffect(() => {
    let attempts = 0;
    const id = setInterval(() => {
      attempts += 1;
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(id);
        return;
      }
      router.refresh();
    }, INTERVAL_MS);

    return () => clearInterval(id);
  }, [router]);

  return null;
}
