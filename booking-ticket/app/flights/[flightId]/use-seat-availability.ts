"use client";

import { useEffect, useRef, useState } from "react";

import type { AvailabilitySnapshot } from "@/lib/seat-availability";
import type { SeatEvent } from "@/lib/seat-events";

/**
 * Live seat availability for one flight.
 *
 * Holds an `EventSource` against the flight's SSE route. Events are *pushed*
 * from the server — a hold taken in another browser arrives here without a
 * reload and without this hook asking for it.
 *
 * The design assumption is that the connection is unreliable and the event
 * order is not guaranteed, so correctness never depends on either:
 *
 *  - `snapshot` messages replace state wholesale and are always safe to apply.
 *  - `seat` messages are incremental and only ever *add* to a set, except
 *    `released`, which removes from `held` only. Applying a stale one cannot
 *    corrupt the picture for long because the server reconciles on a timer.
 *  - Reconnects, tab focus, and the polling fallback all re-fetch the
 *    authoritative snapshot rather than trying to replay what was missed.
 *
 * State lives here, deliberately separate from the booking form. An
 * availability update re-renders the seat map without touching the passenger
 * fields, the baggage choice, or where the user is in checkout.
 */

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "polling";

export type SeatAvailability = {
  booked: ReadonlySet<string>;
  held: ReadonlySet<string>;
  status: ConnectionStatus;
  /** Server clock of the last authoritative snapshot, epoch ms. */
  updatedAt: number;
};

/** How long a failing `EventSource` may flap before we fall back to polling. */
const SSE_FAILURE_LIMIT = 3;

/** Fallback cadence. Only ever used when SSE cannot be established at all. */
const POLL_INTERVAL_MS = 8000;

/**
 * How long the stream may go completely silent before we stop claiming it is
 * live. The server pings every 15s, so silence past this means the connection
 * died without telling the browser — a dropped Wi-Fi link or a proxy that
 * closed the socket without an error. Generous enough to survive one lost
 * ping, short enough that the badge is not lying for long.
 */
const SILENCE_LIMIT_MS = 40_000;

export function useSeatAvailability(
  flightId: string,
  initial: AvailabilitySnapshot,
): SeatAvailability {
  const [booked, setBooked] = useState<ReadonlySet<string>>(
    () => new Set(initial.bookedSeatIds),
  );
  const [held, setHeld] = useState<ReadonlySet<string>>(
    () => new Set(initial.heldSeatIds),
  );
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [updatedAt, setUpdatedAt] = useState(initial.at);

  // Guards against a slow in-flight fetch overwriting a newer snapshot.
  const latestAppliedAt = useRef(initial.at);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | undefined;
    let failures = 0;
    let lastMessageAt = Date.now();

    const applySnapshot = (snapshot: AvailabilitySnapshot) => {
      if (disposed) return;
      // Out-of-order arrival: an older snapshot must not undo a newer one.
      if (snapshot.at < latestAppliedAt.current) return;

      latestAppliedAt.current = snapshot.at;
      setBooked(new Set(snapshot.bookedSeatIds));
      setHeld(new Set(snapshot.heldSeatIds));
      setUpdatedAt(snapshot.at);
    };

    const applyEvent = (event: SeatEvent) => {
      if (disposed) return;
      const ids = event.seatIds;

      if (event.type === "booked") {
        setBooked((current) => new Set([...current, ...ids]));
        setHeld((current) => {
          const next = new Set(current);
          for (const id of ids) next.delete(id);
          return next;
        });
        return;
      }

      setHeld((current) => {
        const next = new Set(current);
        for (const id of ids) {
          if (event.type === "held") next.add(id);
          else next.delete(id);
        }
        return next;
      });
    };

    const fetchSnapshot = async () => {
      try {
        const response = await fetch(`/api/flights/${flightId}/availability`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        applySnapshot((await response.json()) as AvailabilitySnapshot);
      } catch {
        // Offline or navigating away. The next tick tries again.
      }
    };

    /**
     * Last resort. Reached only when `EventSource` repeatedly fails to open —
     * a proxy that strips streaming, say. This is polling, and the UI says so
     * rather than pretending the page is still receiving pushes.
     */
    const startPolling = () => {
      if (disposed || poll) return;
      setStatus("polling");
      void fetchSnapshot();
      poll = setInterval(() => void fetchSnapshot(), POLL_INTERVAL_MS);
    };

    const connect = () => {
      if (disposed) return;

      source = new EventSource(`/api/flights/${flightId}/stream`);

      const markAlive = () => {
        lastMessageAt = Date.now();
        failures = 0;
        setStatus((current) => (current === "polling" ? current : "live"));
      };

      source.addEventListener("open", () => {
        if (disposed) return;
        markAlive();
      });

      // Server keep-alive. Nothing to apply — its only job is proving the
      // connection is still carrying data.
      source.addEventListener("ping", markAlive);

      source.addEventListener("snapshot", (message) => {
        applySnapshot(JSON.parse((message as MessageEvent<string>).data));
        markAlive();
      });

      source.addEventListener("seat", (message) => {
        applyEvent(JSON.parse((message as MessageEvent<string>).data) as SeatEvent);
        markAlive();
      });

      // The server lost its Redis subscription but kept the connection open.
      // It still reconciles on a timer, so this is degraded, not dead.
      source.addEventListener("degraded", () => setStatus("reconnecting"));

      source.addEventListener("error", () => {
        if (disposed) return;
        setStatus("reconnecting");
        failures += 1;

        if (failures >= SSE_FAILURE_LIMIT) {
          source?.close();
          source = null;
          startPolling();
        }
        // Below the limit, EventSource retries on its own and the server sends
        // a fresh snapshot on every new connection.
      });
    };

    connect();

    /**
     * Catches the failure mode `EventSource` cannot report: a connection that
     * stops delivering without ever firing `error` — a dropped Wi-Fi link, or a
     * proxy that closed the socket silently. Without this the badge would keep
     * claiming "Live" over a dead stream.
     *
     * Only runs while the tab is visible: a backgrounded tab has its timers
     * throttled, which would otherwise look like silence on every return.
     */
    const watchdog = setInterval(() => {
      if (disposed || poll) return;
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastMessageAt < SILENCE_LIMIT_MS) return;

      setStatus("reconnecting");
      source?.close();
      source = null;
      failures = 0;
      lastMessageAt = Date.now();
      void fetchSnapshot();
      connect();
    }, 5000);

    const stopPolling = () => {
      clearInterval(poll);
      poll = undefined;
    };

    /**
     * Re-read authoritative state, and take any chance to get back onto the
     * push transport.
     *
     * The second half matters: without it, one bad patch of network would
     * strand the page on the polling fallback for the rest of the session,
     * still showing "checking every few seconds" long after SSE would have
     * worked again. A tab regaining focus or the browser regaining
     * connectivity is exactly the moment worth retrying.
     */
    const resync = () => {
      void fetchSnapshot();

      if (poll) {
        stopPolling();
        failures = 0;
        connect();
        return;
      }

      if (!source) {
        failures = 0;
        connect();
      }
    };

    // A backgrounded tab has its timers throttled and may have missed events
    // entirely. Coming back to the foreground re-reads authoritative state.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      resync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", resync);

    return () => {
      // Scoped to this flight: navigating away closes the stream rather than
      // leaving a subscription open against a cabin nobody is looking at.
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", resync);
      clearInterval(poll);
      clearInterval(watchdog);
      source?.close();
    };
  }, [flightId]);

  return { booked, held, status, updatedAt };
}
