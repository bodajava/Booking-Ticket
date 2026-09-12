/**
 * Proves the confirmation email that Nodemailer actually builds is correct.
 *
 *   npm run qa:email-send -- <PNR>
 *
 * Runs a throwaway SMTP server on localhost, points a transport at it, and
 * sends the real confirmation for a real booking through the real template.
 * What gets asserted is the message on the wire: headers, both MIME parts, the
 * QR image URL, the verification link, and the absence of anything sensitive.
 *
 * Separate from `qa:mailer`, which checks that Gmail accepts the credentials.
 * This one deliberately does not need Gmail, so the message content stays
 * testable even when the app password is expired.
 */
import { createServer } from "node:net";
import { desc, eq } from "drizzle-orm";
import nodemailer from "nodemailer";

import { db } from "../../db/index.js";
import { bookings, passengers } from "../../db/schema.js";
import {
  bookingConfirmationHtml,
  bookingConfirmationText,
} from "../../lib/email/booking-confirmation.js";
import { qrPng } from "../../lib/qr.js";
import { verifyByToken } from "../../lib/verification.js";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};

/* ------------------------------- SMTP sink -------------------------------- */

/**
 * The smallest SMTP server that will satisfy a client: greet, accept every
 * command, swallow the DATA block, and hand the raw message back.
 */
function startSink(): Promise<{ port: number; received: Promise<string>; close: () => void }> {
  let resolveMessage: (raw: string) => void;
  const received = new Promise<string>((resolve) => {
    resolveMessage = resolve;
  });

  const server = createServer((socket) => {
    let inData = false;
    let body = "";

    socket.write("220 localhost ESMTP sink\r\n");

    socket.on("data", (chunk) => {
      const text = chunk.toString();

      if (inData) {
        body += text;
        if (body.includes("\r\n.\r\n")) {
          inData = false;
          socket.write("250 OK queued\r\n");
          resolveMessage(body);
        }
        return;
      }

      for (const line of text.split("\r\n").filter(Boolean)) {
        const command = line.toUpperCase();
        if (command.startsWith("EHLO") || command.startsWith("HELO")) {
          socket.write("250-localhost\r\n250 SIZE 10485760\r\n");
        } else if (command.startsWith("MAIL") || command.startsWith("RCPT")) {
          socket.write("250 OK\r\n");
        } else if (command.startsWith("DATA")) {
          inData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (command.startsWith("QUIT")) {
          socket.write("221 Bye\r\n");
          socket.end();
        } else {
          socket.write("250 OK\r\n");
        }
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ port, received, close: () => server.close() });
    });
  });
}

/* --------------------------------- fixture -------------------------------- */

const wanted = (process.argv[2] ?? "").toUpperCase();
const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const [booking] = wanted
  ? await db.select().from(bookings).where(eq(bookings.pnr, wanted)).limit(1)
  : await db
      .select()
      .from(bookings)
      .where(eq(bookings.status, "CONFIRMED"))
      .orderBy(desc(bookings.createdAt))
      .limit(1);

if (!booking?.verificationToken) {
  console.error("no confirmed booking with a verification token");
  process.exit(1);
}

const verified = await verifyByToken(booking.verificationToken);
if (verified.outcome !== "found") {
  console.error("token did not verify");
  process.exit(1);
}

const token = booking.verificationToken;
const passUrl = `${origin}/bookings/${booking.pnr}`;
const verifyUrl = `${origin}/verify/${token}`;

/* ---------------------------------- send ---------------------------------- */

console.log(`\n── sending ${booking.pnr} through a local SMTP sink ──`);

const sink = await startSink();
const transport = nodemailer.createTransport({
  host: "127.0.0.1",
  port: sink.port,
  secure: false,
  ignoreTLS: true,
});

// Mirrors lib/email/send.ts exactly: the QR rides along as an inline
// attachment, not as a hosted <img src>.
const QR_CID = "boarding-pass-qr";

const info = await transport.sendMail({
  from: "AeroFlow <noreply@example.test>",
  to: "traveller@example.test",
  subject: `Your AeroFlow booking ${booking.pnr} — ${verified.pass.origin.city} to ${verified.pass.destination.city}`,
  html: bookingConfirmationHtml({ pass: verified.pass, qrSrc: `cid:${QR_CID}`, passUrl, verifyUrl }),
  text: bookingConfirmationText({ pass: verified.pass, passUrl, verifyUrl }),
  headers: { "X-Entity-Ref-ID": booking.pnr },
  attachments: [
    {
      filename: `boarding-pass-${booking.pnr}.png`,
      content: await qrPng(verifyUrl, 480),
      cid: QR_CID,
      contentType: "image/png",
    },
  ],
});

const raw = await sink.received;
sink.close();
transport.close();

check("nodemailer reports the message accepted", Boolean(info.messageId));

/* -------------------------------- assertions ------------------------------- */

// Quoted-printable wraps long lines and escapes "=", so compare against a
// decoded copy rather than the raw transfer encoding.
const decoded = raw
  .replace(/=\r\n/g, "")
  .replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

console.log("\n── envelope and structure ──");
check("has a multipart body", /Content-Type: multipart\/(alternative|related|mixed)/i.test(raw));
check("carries a plain-text alternative", /Content-Type: text\/plain/i.test(raw));
check("carries an HTML part", /Content-Type: text\/html/i.test(raw));
check("subject names the booking", raw.includes(booking.pnr) || decoded.includes(booking.pnr));
check("threading header present", /X-Entity-Ref-ID/i.test(raw));

console.log("\n── boarding-pass content ──");
check("shows the PNR", decoded.includes(booking.pnr));
check("shows the flight number", decoded.includes(verified.pass.flightNumber));
check("shows origin and destination", decoded.includes(verified.pass.origin.code) && decoded.includes(verified.pass.destination.code));
check("shows the passenger name", verified.pass.passengers.every((p) => decoded.includes(p.fullName)));
check("shows a seat", verified.pass.passengers.every((p) => !p.seatNumber || decoded.includes(p.seatNumber)));
check("shows baggage in kg", /\d+kg checked/.test(decoded));
check("QR is referenced by CID, not a remote URL", decoded.includes(`src="cid:${QR_CID}"`));
check("no data: URI image", !decoded.includes('src="data:'));
check("QR travels as an inline PNG attachment", /Content-Type: image\/png/i.test(raw));
check("attachment carries the matching Content-ID", raw.includes(`<${QR_CID}>`));
check("attachment is marked inline", /Content-Disposition: inline/i.test(raw));
check("has the verification link as a fallback", decoded.includes(verifyUrl));
check("has the boarding-pass link", decoded.includes(passUrl));

console.log("\n── email-client compatibility ──");
check("table-based layout", /<table/i.test(decoded));
check("no flexbox", !/display:\s*flex/i.test(decoded));
check("no external web fonts", !/fonts\.googleapis|@font-face/i.test(decoded));
check("no <script>", !/<script/i.test(decoded));
check("no external stylesheet", !/<link[^>]+stylesheet/i.test(decoded));

console.log("\n── privacy ──");
const [person] = await db
  .select()
  .from(passengers)
  .where(eq(passengers.bookingId, booking.id))
  .limit(1);

check("no passport number", !decoded.includes(person?.passportNumber ?? "@@none@@"));
check("no date of birth", !decoded.includes(person?.dateOfBirth ?? "@@none@@"));
check("no Clerk user id", !decoded.includes(booking.userId));
check("no Stripe ids", !decoded.includes(booking.stripePaymentIntentId ?? "@@none@@"));
check("no internal database id", !decoded.includes(booking.id));
check("no SMTP password", !decoded.includes(process.env.EMAIL_APP_PASSWORD ?? "@@none@@"));
// The token has to appear — it is what the QR and the verify link encode — but
// only inside those URLs, never as a standalone value.
const tokenMentions = decoded.split(token).length - 1;
const urlMentions = (decoded.match(new RegExp(`(qr|verify)/${token}|${token}/qr`, "g")) ?? []).length;
check("token appears only inside URLs", tokenMentions > 0 && tokenMentions === urlMentions, `${tokenMentions} mentions, ${urlMentions} in URLs`);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
