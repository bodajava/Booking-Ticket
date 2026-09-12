"use client";

import { useEffect, useRef, useState } from "react";

import { SparkIcon } from "./home-icons";

/**
 * The travel concierge, wired to the existing /api/assistant route.
 *
 * That endpoint is read-only by design — it searches destination guides and
 * answers questions; it cannot hold a seat or take a payment. The panel says
 * so rather than implying it can book, and it requires sign-in because each
 * question costs an embedding call.
 */

type Message = { role: "user" | "assistant"; content: string };

export function AskAi({ isSignedIn }: { isSignedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, busy]);

  const send = async () => {
    const question = draft.trim();
    if (!question || busy) return;

    setDraft("");
    setError(null);
    setBusy(true);
    const next: Message[] = [...messages, { role: "user", content: question }];
    setMessages(next);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, history: messages.slice(-10) }),
      });

      if (response.status === 401) {
        setError("Sign in to ask about destinations.");
        return;
      }
      if (!response.ok) {
        setError("The concierge is unavailable right now. Try again shortly.");
        return;
      }

      const body = (await response.json()) as { answer?: string; message?: string };
      setMessages([
        ...next,
        { role: "assistant", content: body.answer ?? body.message ?? "No answer came back." },
      ]);
    } catch {
      setError("We could not reach the concierge. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="ask-ai-panel"
        className="fixed bottom-6 right-6 z-40 flex cursor-pointer items-center gap-2 rounded-pill border border-amber/40 bg-stage-lift px-[18px] py-[12px] text-[12px] font-semibold text-bone shadow-card transition-colors duration-200 hover:bg-card"
      >
        <SparkIcon size={14} className="text-amber" />
        Ask AI
      </button>

      {open ? (
        <div
          id="ask-ai-panel"
          role="dialog"
          aria-label="Travel concierge"
          className="fixed bottom-24 right-6 z-40 flex h-[440px] w-[min(360px,calc(100vw-3rem))] flex-col rounded-lg border border-hairline bg-stage-lift shadow-card"
        >
          <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <div>
              <p className="font-display text-[1.125rem] leading-none text-bone">Concierge</p>
              <p className="mt-1 text-[11px] text-bone-50">Asks about destinations, not bookings</p>
            </div>
            <button
              type="button"
              aria-label="Close concierge"
              onClick={() => setOpen(false)}
              className="cursor-pointer rounded-pill px-2 text-[16px] text-bone-50 hover:text-bone"
            >
              ×
            </button>
          </header>

          <div ref={logRef} className="flex-1 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <p className="text-[12px] leading-[1.6] text-bone-50">
                {isSignedIn
                  ? "Ask what a city is like in September, what to pack, or where to go for a short break."
                  : "Sign in to ask about destinations."}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {messages.map((message, index) => (
                  <li
                    key={index}
                    className={
                      message.role === "user"
                        ? "self-end rounded-lg rounded-br-sm bg-card px-3 py-2 text-[12px] leading-[1.6] text-bone"
                        : "rounded-lg rounded-bl-sm border border-hairline px-3 py-2 text-[12px] leading-[1.6] text-bone-50"
                    }
                  >
                    {message.content}
                  </li>
                ))}
              </ul>
            )}

            {busy ? <p className="mt-3 text-[12px] text-bone-50">Thinking…</p> : null}
            {error ? (
              <p role="alert" className="mt-3 text-[12px] text-[#e2a0a0]">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2 border-t border-hairline p-3">
            <label htmlFor="ask-ai-input" className="sr-only">
              Ask the concierge
            </label>
            <input
              id="ask-ai-input"
              value={draft}
              disabled={!isSignedIn || busy}
              placeholder={isSignedIn ? "Where should I go in September?" : "Sign in to ask"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
              }}
              className="h-10 flex-1 rounded-md border border-hairline bg-card px-3 text-[12px] text-bone placeholder:text-bone-50/60 focus:border-amber focus:outline-none disabled:opacity-45"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!isSignedIn || busy || draft.trim().length === 0}
              className="h-10 cursor-pointer rounded-pill bg-bone px-4 text-[12px] font-semibold text-stage disabled:cursor-not-allowed disabled:opacity-45"
            >
              Ask
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
