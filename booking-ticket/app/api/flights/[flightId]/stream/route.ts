import { z } from "zod";

import {
  getAvailabilitySnapshot,
  snapshotsMatch,
  type AvailabilitySnapshot,
} from "@/lib/seat-availability";
import { parseSeatEvent, seatEventChannel } from "@/lib/seat-events";
import { redis } from "@/lib/redis";
import { getNextHoldExpiry } from "@/lib/seat-lock";

/**
 * Live seat availability for one flight, as Server-Sent Events.
 *
 * Transport: the browser holds one `EventSource`; this handler holds one Redis
 * pub/sub subscription. Holds, releases and confirmed bookings are *pushed* —
 * a Server Action on any instance publishes to Redis and every subscribed
 * instance forwards to its own connected browsers. There is no client polling
 * and no process-local fan-out.
 *
 * The one exception is hold expiry, which Redis cannot announce. That is
 * handled by waking at the next known deadline (read from the lock index,
 * which is scored by expiry) rather than on a blind interval, plus a slow
 * safety reconcile that also covers any pub/sub message we might have missed.
 * Both emit a full snapshot, so the client converges regardless of ordering.
 *
 * SSE rather than WebSockets because this traffic is strictly one-way and SSE
 * reconnects on its own; the browser's automatic retry is the recovery path.
 */
export const runtime = "nodejs";
/** Long-lived connection: never let a cache sit in front of it. */
export const dynamic = "force-dynamic";

/**
 * Hold the connection as long as the platform allows.
 *
 * A serverless function's default ceiling is measured in seconds, which for an
 * SSE stream means the seat map drops and reconnects continuously. Vercel caps
 * this to whatever the plan permits (60s on Hobby, up to 300s with Fluid
 * compute) rather than rejecting it, so asking for the maximum is safe.
 *
 * A cap is not a correctness problem either way: the client reconnects on its
 * own and the handler replies to every new connection with a fresh snapshot,
 * so a shorter ceiling costs reconnects, not accuracy.
 */
export const maxDuration = 300;

/** Catches a missed message even when nothing is due to expire. */
const SAFETY_RECONCILE_MS = 45_000;

/**
 * Proxies commonly idle out an SSE connection at 60s; stay well inside that.
 *
 * Sent as a named `ping` event rather than an SSE comment (`: ping`). Comments
 * keep proxies awake but are invisible to `EventSource`, so a client watching
 * for silence would never see them — and silence is exactly how a connection
 * that died without an error looks from the browser.
 */
const HEARTBEAT_MS = 15_000;

/** A hold expiring at T is only gone *after* T; look slightly past it. */
const EXPIRY_GRACE_MS = 750;

const flightIdSchema = z.uuid();

export async function GET(
  request: Request,
  context: RouteContext<"/api/flights/[flightId]/stream">,
) {
  const { flightId } = await context.params;

  if (!flightIdSchema.safeParse(flightId).success) {
    return new Response("Invalid flight id", { status: 400 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastSnapshot: AvailabilitySnapshot | null = null;
      let expiryTimer: ReturnType<typeof setTimeout> | undefined;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // The client vanished between the abort signal and this write.
          closed = true;
        }
      };

      /**
       * Read the authoritative state and push it if anything moved. This is the
       * convergence point for every uncertainty in the system: expiry, a
       * dropped message, an out-of-order delivery. Clients treat a snapshot as
       * a wholesale replacement, so it cannot be applied in the wrong order.
       */
      const reconcile = async (force = false) => {
        if (closed) return;
        try {
          const snapshot = await getAvailabilitySnapshot(flightId);
          if (force || !lastSnapshot || !snapshotsMatch(lastSnapshot, snapshot)) {
            lastSnapshot = snapshot;
            send("snapshot", snapshot);
          }
          scheduleExpiryWake();
        } catch (error) {
          console.error(`[seat-stream] reconcile failed for ${flightId}`, error);
        }
      };

      /** Sleep until the next hold is actually due to lapse — not a poll loop. */
      const scheduleExpiryWake = async () => {
        clearTimeout(expiryTimer);
        if (closed) return;

        try {
          const nextExpiry = await getNextHoldExpiry(flightId);
          if (nextExpiry === null) return; // Nothing held: no timer at all.

          const delay = Math.max(nextExpiry - Date.now() + EXPIRY_GRACE_MS, 250);
          expiryTimer = setTimeout(() => void reconcile(), delay);
        } catch (error) {
          console.error(`[seat-stream] expiry scheduling failed for ${flightId}`, error);
        }
      };

      // 1. Initial snapshot, so the client starts from authoritative state
      //    rather than trusting whatever the page was rendered with.
      await reconcile(true);

      // 2. Live push.
      const subscriber = redis.subscribe<unknown>([seatEventChannel(flightId)]);

      subscriber.on("message", ({ message }) => {
        const event = parseSeatEvent(message);
        if (!event) return;

        send("seat", event);

        // A new hold changes when the next expiry falls due.
        if (event.type === "held") void scheduleExpiryWake();
      });

      subscriber.on("error", (error) => {
        // Don't kill the stream: the client keeps its last good state and the
        // safety reconcile keeps it fresh until the subscription recovers.
        console.error(`[seat-stream] subscription error for ${flightId}`, error);
        send("degraded", { reason: "subscription_error" });
      });

      const heartbeat = setInterval(() => send("ping", { at: Date.now() }), HEARTBEAT_MS);

      const safety = setInterval(() => void reconcile(), SAFETY_RECONCILE_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearInterval(safety);
        clearTimeout(expiryTimer);
        subscriber.removeAllListeners();
        void subscriber.unsubscribe().catch(() => {});
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      // Nginx and friends buffer streamed responses by default, which would
      // hold events until the buffer fills.
      "X-Accel-Buffering": "no",
    },
  });
}
