/**
 * Proves the production send path works, independently of Gmail.
 *
 *   npm run qa:prove-send -- <PNR>
 *
 * Starts a throwaway SMTP server, points EMAIL_SMTP_HOST/PORT at it, and calls
 * `sendBookingConfirmation` — the exact function the Stripe webhook calls, with
 * the real template, the real QR and the real booking.
 *
 * The point is diagnostic. When Gmail answers `535 BadCredentials`, this
 * separates "the credential is dead" from "the email code is broken" in one
 * run: if the message lands here, every part except the credential is fine.
 */
import { createServer } from "node:net";
import { desc, eq } from "drizzle-orm";

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

/** Accepts one message and hands back the raw bytes. */
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
          // Advertise PLAIN so nodemailer's auth step succeeds against us.
          socket.write("250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 10485760\r\n");
        } else if (command.startsWith("AUTH")) {
          socket.write("235 Authentication successful\r\n");
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

const sink = await startSink();

// Redirect the transport *before* lib/mailer is imported, so its cached
// transporter is built against the sink rather than Gmail.
process.env.EMAIL_SMTP_HOST = "127.0.0.1";
process.env.EMAIL_SMTP_PORT = String(sink.port);

const { db } = await import("../../db/index.js");
const { bookings } = await import("../../db/schema.js");
const { sendBookingConfirmation } = await import("../../lib/email/send.js");
const { describeTransport } = await import("../../lib/mailer.js");
const { verifyByToken } = await import("../../lib/verification.js");

console.log(`\n── transport: ${describeTransport()} ──`);

const wanted = (process.argv[2] ?? "").toUpperCase();
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

console.log(`\n── sending ${booking.pnr} through the production path ──`);

const result = await sendBookingConfirmation({
  to: "traveller@example.test",
  pass: verified.pass,
  verificationToken: booking.verificationToken,
});

check("sendBookingConfirmation reports success", result.sent, result.sent ? "" : result.reason);

const raw = await sink.received;
sink.close();

const decoded = raw
  .replace(/=\r\n/g, "")
  .replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

console.log("\n── what actually arrived ──");
check("addressed to the recipient", /To: .*traveller@example\.test/i.test(raw));
check("subject names the booking", decoded.includes(booking.pnr));
check("carries the QR as an inline PNG", /Content-Type: image\/png/i.test(raw));
check("QR referenced by CID", /src="cid:boarding-pass-qr"/.test(decoded));
check("has the verification link", /\/verify\/[0-9A-Z]{32}/.test(decoded));
check("shows the flight number", decoded.includes(verified.pass.flightNumber));
check("shows a passenger name", verified.pass.passengers.every((p) => decoded.includes(p.fullName)));

console.log(`\n  ${pass} passed, ${fail} failed`);
console.log(
  fail === 0
    ? "\n  => the send path is healthy. A 535 from Gmail is the credential, nothing else.\n"
    : "\n  => something in the send path itself is broken.\n",
);
process.exit(fail === 0 ? 0 : 1);
