"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The hold countdown.
 *
 * DESIGN.MD §6 specifies a `thin-bars` chart — 3px bars, 6px gaps, no
 * gridlines, one highlighted bar — and describes it as the now-playing
 * waveform. A seat hold is the same idea: one thing is live, and it is running
 * out. The bars drain right-to-left and the playhead is the single amber
 * highlight, so the meter speaks the system's chart voice rather than being a
 * generic progress bar bolted on.
 *
 * `expiresAt` is an absolute epoch time that came from Redis `PTTL`, not a
 * duration counted in the browser. That is what makes the timer survive a
 * reload and stay honest: a tab left open for an hour renders as expired, not
 * as "9:58 remaining".
 *
 * The parent remounts this with `key={expiresAt}`, so a new hold starts from a
 * fresh initial state instead of needing a reset write on every prop change.
 */

const BAR_COUNT = 36;

export function HoldTimer({
  expiresAt,
  totalMs,
  onExpire,
}: {
  expiresAt: number;
  totalMs: number;
  onExpire: () => void;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Date.now()));

  // Latest-callback ref, written in an effect rather than during render, so the
  // one-second interval never has to be torn down just because the parent
  // re-rendered with a new closure.
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    const id = setInterval(() => {
      const left = Math.max(0, expiresAt - Date.now());
      setRemaining(left);
      if (left === 0) {
        clearInterval(id);
        onExpireRef.current();
      }
    }, 1000);

    return () => clearInterval(id);
  }, [expiresAt]);

  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const fraction = totalMs > 0 ? Math.max(0, Math.min(1, remaining / totalMs)) : 0;
  const litBars = Math.ceil(fraction * BAR_COUNT);
  const isFinalMinute = remaining > 0 && remaining <= 60_000;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="eyebrow">Seat held for</span>
        {/* aria-live is off deliberately: announcing every tick would make a
            screen reader unusable. The progressbar below carries the value. */}
        <span className="numeric text-[13px] font-medium text-bone" aria-live="off">
          {minutes}:{String(seconds).padStart(2, "0")}
        </span>
      </div>

      <div
        className="mt-2 flex h-5 items-end gap-[3px]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalMs / 1000)}
        aria-valuenow={totalSeconds}
        aria-valuetext={`${minutes} minutes ${seconds} seconds left to complete this booking`}
      >
        {Array.from({ length: BAR_COUNT }, (_, index) => {
          const lit = index < litBars;
          const isPlayhead = index === litBars - 1;
          return (
            <span
              key={index}
              className="w-[3px] rounded-[1px] transition-[height,background-color] duration-200 ease-[var(--ease-standard)]"
              style={{
                height: isPlayhead ? "20px" : lit ? "13px" : "7px",
                backgroundColor: lit ? "var(--color-amber)" : "rgba(236,230,220,0.22)",
                opacity: lit && !isPlayhead ? 0.75 : 1,
              }}
            />
          );
        })}
      </div>

      <p className="mt-2 text-[12px] leading-[1.5] text-bone-50">
        {isFinalMinute
          ? "Less than a minute left. Finish now or the seat is released."
          : "We are keeping this seat for you while you finish."}
      </p>
    </div>
  );
}
