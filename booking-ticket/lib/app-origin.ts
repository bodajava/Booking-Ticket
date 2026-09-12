import { headers } from "next/headers";

/**
 * Where the browser should be sent back to after an external redirect.
 *
 * This exists because a payment redirect leaves our origin and comes back, and
 * "back" has to mean *the same origin the user signed in on*. Session cookies
 * are host-scoped: a user who signs in at `http://localhost:3000` has no
 * session at `https://something.ngrok-free.dev`, so returning them to the
 * wrong host renders a signed-out page even though their session is perfectly
 * intact. Hard-coding one public URL breaks whichever origin is not it.
 *
 * The request's own origin is used when — and only when — it appears in an
 * explicit allowlist. `Origin` and `Host` are attacker-controllable, and an
 * unvalidated one here would let a third party point our Stripe redirect at
 * their domain. Anything unrecognised falls back to the configured default.
 *
 * Configuration:
 *   NEXT_PUBLIC_APP_URL   the default browser origin (also the fallback)
 *   APP_ALLOWED_ORIGINS   comma-separated origins the browser may return to
 *
 * The public tunnel used for *webhook delivery* is deliberately not read here.
 * Stripe reaches the server directly and carries no browser session; that URL
 * belongs in the Stripe dashboard, not in a browser redirect.
 */

/** Scheme + host + port, lowercased, no trailing slash. `null` when unusable. */
function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** The default origin, and the only one used when nothing else is trusted. */
export function getDefaultAppOrigin(): string | null {
  return normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL);
}

/**
 * Every origin the browser is permitted to be redirected back to.
 *
 * The default origin is always included, so a deployment that sets only
 * `NEXT_PUBLIC_APP_URL` keeps working with no extra configuration.
 */
export function getAllowedOrigins(): string[] {
  const configured = (process.env.APP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => normalizeOrigin(entry))
    .filter((entry): entry is string => entry !== null);

  const fallback = getDefaultAppOrigin();
  const all = fallback ? [fallback, ...configured] : configured;

  return [...new Set(all)];
}

/**
 * The origin this request came from, if we trust it.
 *
 * Server Actions are POSTed with an `Origin` header, which is the accurate
 * signal for "which site is the user actually on". `x-forwarded-host` is only
 * consulted as a fallback for proxied setups, and both are checked against the
 * allowlist before being believed.
 */
export async function resolveReturnOrigin(): Promise<string | null> {
  const headerList = await headers();

  const forwardedHost = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const forwardedProto = headerList.get("x-forwarded-proto");

  return pickReturnOrigin(
    [
      headerList.get("origin"),
      forwardedHost
        ? `${forwardedProto ?? (forwardedHost.startsWith("localhost") ? "http" : "https")}://${forwardedHost}`
        : null,
    ],
    getAllowedOrigins(),
  );
}

/**
 * The decision itself, separated from reading headers so it can be tested
 * directly — including the case that matters most, where a request claims an
 * origin nobody configured.
 *
 * Candidates are tried in order of trustworthiness. The first that appears in
 * `allowed` wins; anything else is ignored in favour of the default. A
 * spoofed `Origin` therefore cannot steer the redirect anywhere new — the
 * worst it can do is get the user sent to the app's own configured origin.
 */
export function pickReturnOrigin(
  candidates: Array<string | null | undefined>,
  allowed: string[],
): string | null {
  if (allowed.length === 0) return null;

  for (const candidate of candidates) {
    const origin = normalizeOrigin(candidate);
    if (origin && allowed.includes(origin)) return origin;
  }

  // Not on the list. Falling back is safer than honouring it, but it is worth
  // saying out loud — in local development this is usually a missing entry in
  // APP_ALLOWED_ORIGINS rather than anything hostile.
  const attempted = candidates.map(normalizeOrigin).find((o) => o !== null);
  if (attempted) {
    console.warn(
      `[app-origin] request origin ${attempted} is not in APP_ALLOWED_ORIGINS; ` +
        `falling back to ${allowed[0]}`,
    );
  }

  return allowed[0];
}
