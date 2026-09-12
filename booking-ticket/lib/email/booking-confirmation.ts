import type { VerifiedPass } from "@/lib/verification";

/**
 * The confirmation email's HTML.
 *
 * Written to 2005 email rules, not 2026 web ones: tables for layout, inline
 * styles only, no flexbox, no grid, no custom properties, no web fonts. Outlook
 * renders through Word's engine and silently drops all of the above, and this
 * is the one message a traveller keeps and re-opens at the airport.
 *
 * The QR code is an `<img>` pointing at our own endpoint rather than an inline
 * data URI, because Gmail and Outlook strip `data:` sources — the code would
 * simply not appear for most recipients.
 */
export function bookingConfirmationHtml(input: {
  pass: VerifiedPass;
  /**
   * What the `<img>` points at.
   *
   * Normally `cid:...`, referencing an inline attachment. Mail clients block
   * remote images by default, and a boarding pass that needs the traveller to
   * tap "load images" before it works is a boarding pass that fails at the
   * gate. An inline part renders immediately, offline, with no fetch — and
   * without the app needing to be publicly reachable at all.
   *
   * A plain https URL also works here, for anywhere a hosted image is wanted.
   * A `data:` URI does not: Gmail and Outlook strip those.
   */
  qrSrc: string;
  passUrl: string;
  /** Same destination the QR encodes, as a tappable link. */
  verifyUrl: string;
}): string {
  const { pass, qrSrc, passUrl, verifyUrl } = input;

  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:6px 0;color:#8a8278;font:400 12px/1.4 Arial,sans-serif;">${escapeHtml(label)}</td>
      <td align="right" style="padding:6px 0;color:#ece6dc;font:700 13px/1.4 Arial,sans-serif;">${escapeHtml(value)}</td>
    </tr>`;

  const travellers = pass.passengers
    .map(
      (person) => `
      <tr>
        <td style="padding:10px 0;border-top:1px solid rgba(236,230,220,0.10);">
          <div style="color:#ece6dc;font:700 14px/1.4 Arial,sans-serif;">${escapeHtml(person.fullName)}</div>
          <div style="color:#8a8278;font:400 12px/1.5 Arial,sans-serif;margin-top:3px;">
            ${person.seatNumber ? `Seat ${escapeHtml(person.seatNumber)}` : "No seat assigned"}
            ${person.seatClass ? ` &middot; ${escapeHtml(person.seatClass)}` : ""}
            &middot; ${person.baggageAllowanceKg + person.extraBaggageKg}kg checked
          </div>
        </td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your AeroFlow booking ${escapeHtml(pass.pnr)}</title>
</head>
<body style="margin:0;padding:0;background:#15110e;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
  ${escapeHtml(pass.flightNumber)} to ${escapeHtml(pass.destination.city)} &middot; reference ${escapeHtml(pass.pnr)}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#15110e;">
<tr><td align="center" style="padding:32px 16px;">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

    <tr><td align="center" style="padding-bottom:24px;">
      <span style="color:#ece6dc;font:400 20px/1 Georgia,serif;letter-spacing:-0.02em;">AeroFlow</span>
    </td></tr>

    <tr><td style="background:#1c1815;border:1px solid rgba(236,230,220,0.08);border-radius:10px;padding:28px 24px;">

      <div style="color:#8a8278;font:400 11px/1 Arial,sans-serif;letter-spacing:0.10em;text-transform:uppercase;">You're booked</div>
      <div style="color:#ece6dc;font:400 28px/1.15 Georgia,serif;margin-top:10px;">
        ${escapeHtml(pass.origin.city)} to ${escapeHtml(pass.destination.city)}
      </div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;">
        <tr>
          <td style="color:#ece6dc;font:400 26px/1 Arial,sans-serif;">${escapeHtml(pass.origin.code)}</td>
          <td align="center" style="color:#8a8278;font:400 12px/1 Arial,sans-serif;">&rarr;</td>
          <td align="right" style="color:#ece6dc;font:400 26px/1 Arial,sans-serif;">${escapeHtml(pass.destination.code)}</td>
        </tr>
        <tr>
          <td style="color:#8a8278;font:400 12px/1.4 Arial,sans-serif;padding-top:6px;">${time.format(pass.departureTime)}</td>
          <td></td>
          <td align="right" style="color:#8a8278;font:400 12px/1.4 Arial,sans-serif;padding-top:6px;">${time.format(pass.arrivalTime)}</td>
        </tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:1px solid rgba(236,230,220,0.10);padding-top:8px;">
        ${row("Booking reference", pass.pnr)}
        ${row("Flight", pass.flightNumber)}
        ${row("Departs", date.format(pass.departureTime))}
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
        ${travellers}
      </table>

      <!-- Boarding pass QR -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;border-top:1px dashed rgba(236,230,220,0.16);">
        <tr><td align="center" style="padding-top:26px;">
          <img src="${escapeAttr(qrSrc)}" width="200" height="200" alt="Boarding pass code for reference ${escapeAttr(pass.pnr)}" style="display:block;border:0;border-radius:8px;background:#ece6dc;padding:10px;">
          <div style="color:#8a8278;font:400 12px/1.6 Arial,sans-serif;margin-top:14px;max-width:320px;">
            Show this code at the gate. Scanning it confirms your ticket without revealing your personal details.
          </div>
          <!-- Images are blocked by default in most mail clients, so the same
               destination is offered as plain text. Without this the pass is
               unusable for anyone who never taps "show images". -->
          <div style="color:#8a8278;font:400 12px/1.6 Arial,sans-serif;margin-top:12px;">
            Code not showing?
            <a href="${escapeAttr(verifyUrl)}" style="color:#d97a2c;text-decoration:underline;">Open the verification page</a>
          </div>
        </td></tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
        <tr><td align="center">
          <a href="${escapeAttr(passUrl)}" style="display:inline-block;background:#ece6dc;color:#15110e;font:700 13px/1 Arial,sans-serif;text-decoration:none;padding:14px 26px;border-radius:999px;">
            Open your boarding pass
          </a>
        </td></tr>
      </table>

    </td></tr>

    <tr><td align="center" style="padding-top:20px;color:#8a8278;font:400 11px/1.6 Arial,sans-serif;">
      Keep this email — it is your boarding pass.
    </td></tr>

  </table>

</td></tr>
</table>
</body>
</html>`;
}

/** Plain-text alternative, for clients that refuse HTML and for spam scoring. */
export function bookingConfirmationText(input: {
  pass: VerifiedPass;
  passUrl: string;
  verifyUrl: string;
}): string {
  const { pass, passUrl, verifyUrl } = input;
  const lines = [
    `You're booked — ${pass.origin.city} to ${pass.destination.city}`,
    "",
    `Booking reference: ${pass.pnr}`,
    `Flight: ${pass.flightNumber}`,
    `Departs: ${pass.departureTime.toISOString()}`,
    "",
    ...pass.passengers.map(
      (p) =>
        `  ${p.fullName} — ${p.seatNumber ?? "no seat"}, ${p.baggageAllowanceKg + p.extraBaggageKg}kg checked`,
    ),
    "",
    `Boarding pass: ${passUrl}`,
    `Verify this ticket: ${verifyUrl}`,
    "",
    "Keep this email — it is your boarding pass.",
  ];
  return lines.join("\n");
}

/** Escapes the five characters that can break out of HTML text content. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Attribute values additionally must not carry a quote or a backtick. */
function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
