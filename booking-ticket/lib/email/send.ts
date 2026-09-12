// Build-time guard: this module reaches SMTP credentials through `lib/mailer`,
// so importing it from a client component must fail loudly rather than
// silently shipping the mail path to a browser.
import "server-only";

import { getDefaultAppOrigin } from "@/lib/app-origin";
import { MailerConfigError, getFromAddress, getTransporter } from "@/lib/mailer";
import { qrPng, verificationUrl } from "@/lib/qr";
import type { VerifiedPass } from "@/lib/verification";
import { bookingConfirmationHtml, bookingConfirmationText } from "./booking-confirmation";

/**
 * Transactional email, over Gmail SMTP.
 *
 * Deliberately best-effort. A confirmation email failing must never fail the
 * webhook: Stripe retries a non-2xx delivery, and a retry would re-enter
 * fulfilment for a booking that already exists. The ticket is valid whether or
 * not the mail lands, and the traveller can always open the pass in the app —
 * so a send failure is logged loudly and swallowed. The customer must never be
 * told their payment failed because a mailbox was unreachable.
 *
 * With no credentials configured the whole thing no-ops with one clear line in
 * the log, so local development and CI never need a mailbox.
 */

export type SendResult =
  | { sent: true; id: string }
  | { sent: false; reason: "not_configured" | "no_recipient" | "failed" };

export async function sendBookingConfirmation(input: {
  to: string | null;
  pass: VerifiedPass;
  verificationToken: string;
}): Promise<SendResult> {
  let mailer;
  try {
    mailer = getTransporter();
  } catch (error) {
    // Half-configured is a deployment mistake worth shouting about, but still
    // not worth failing a paid booking over.
    if (error instanceof MailerConfigError) {
      console.error(`[email] ${error.message}`);
      return { sent: false, reason: "not_configured" };
    }
    throw error;
  }

  const from = getFromAddress();

  if (!mailer || !from) {
    console.info(
      `[email] EMAIL_APP / EMAIL_APP_PASSWORD not set — skipping confirmation for ${input.pass.pnr}`,
    );
    return { sent: false, reason: "not_configured" };
  }

  if (!input.to) {
    console.warn(`[email] no address on file for ${input.pass.pnr}`);
    return { sent: false, reason: "no_recipient" };
  }

  const origin = getDefaultAppOrigin();
  if (!origin) {
    console.error("[email] NEXT_PUBLIC_APP_URL is not set; cannot build links");
    return { sent: false, reason: "failed" };
  }

  // Absolute URLs throughout: an email has no page to resolve a relative path
  // against. Both point at the *existing* endpoints rather than anything new.
  const passUrl = `${origin}/bookings/${input.pass.pnr}`;
  const verifyUrl = verificationUrl(origin, input.verificationToken);

  // The QR travels as an inline attachment rather than a hosted `<img src>`.
  //
  // Two reasons, both observed rather than theoretical. Mail clients block
  // remote images by default, so a hosted code stays invisible until the
  // traveller taps "load images" — at a gate, that is a failure. And a hosted
  // code is only as reachable as the origin: behind a tunnel or a staging
  // firewall the fetch returns something that is not a PNG and the image
  // breaks. An inline part renders immediately, offline, everywhere.
  //
  // Encoded by the same `lib/qr` helper the boarding-pass page and the
  // /api/boarding-pass/[token]/qr route use, so there is exactly one QR
  // implementation and all three encode the identical URL.
  const QR_CID = "boarding-pass-qr";
  let qrAttachment: { filename: string; content: Buffer; cid: string; contentType: string } | null =
    null;

  try {
    qrAttachment = {
      filename: `boarding-pass-${input.pass.pnr}.png`,
      content: await qrPng(verifyUrl, 480),
      cid: QR_CID,
      contentType: "image/png",
    };
  } catch (error) {
    // Fall back to the hosted image rather than sending no code at all.
    console.error(
      `[email] QR render failed for ${input.pass.pnr}: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }

  const qrSrc = qrAttachment
    ? `cid:${QR_CID}`
    : `${origin}/api/boarding-pass/${input.verificationToken}/qr`;

  try {
    const info = await mailer.sendMail({
      from,
      to: input.to,
      subject: `Your AeroFlow booking ${input.pass.pnr} — ${input.pass.origin.city} to ${input.pass.destination.city}`,
      html: bookingConfirmationHtml({ pass: input.pass, qrSrc, passUrl, verifyUrl }),
      text: bookingConfirmationText({ pass: input.pass, passUrl, verifyUrl }),
      attachments: qrAttachment ? [qrAttachment] : undefined,
      headers: {
        // Lets a mail client thread a re-send with the original rather than
        // showing the traveller two unrelated confirmations.
        "X-Entity-Ref-ID": input.pass.pnr,
      },
    });

    console.info(`[email] confirmation for ${input.pass.pnr} sent (${info.messageId})`);
    return { sent: true, id: info.messageId };
  } catch (error) {
    // Message only, never the error object: a nodemailer SMTP error can carry
    // the full protocol conversation, and the AUTH line in it contains the
    // base64-encoded app password.
    console.error(
      `[email] send failed for ${input.pass.pnr}: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    return { sent: false, reason: "failed" };
  }
}
