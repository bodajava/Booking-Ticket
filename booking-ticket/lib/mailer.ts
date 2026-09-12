import nodemailer, { type Transporter } from "nodemailer";

/**
 * SMTP transport, over Gmail.
 *
 * Deliberately free of the `server-only` marker, which throws outside a Next
 * server bundle and would make this module impossible to exercise from a
 * script — including the one that proves the credentials work before a
 * deployment. The marker lives on `lib/email/send.ts` instead, the module the
 * app actually imports, so a client component pulling the mail path in still
 * fails the build.
 *
 * The credentials themselves are read from non-`NEXT_PUBLIC_` variables, which
 * Next never inlines into a browser bundle; `npm run qa:mailer` asserts that
 * directly against the built client chunks rather than trusting it.
 *
 * Gmail on 465/TLS rather than 587/STARTTLS: implicit TLS means the connection
 * is encrypted before any credential is offered, so there is no plaintext
 * window in which a downgrade could strip the upgrade.
 *
 * The transporter is created once and reused. Nodemailer pools connections, and
 * building a new one per email would pay the TLS handshake on every booking and
 * make Gmail's per-connection rate limits far easier to hit.
 */

/**
 * Gmail by default, any SMTP provider by configuration.
 *
 * Gmail App Passwords are fragile in a way that is worth designing around:
 * Google revokes them the moment it believes one has been exposed, and turning
 * 2-Step Verification off invalidates every one of them at once. Either leaves
 * SMTP answering `535 BadCredentials` with a credential that looks perfectly
 * correct — and confirmations stop arriving while bookings keep succeeding.
 *
 * Setting EMAIL_SMTP_HOST / EMAIL_SMTP_PORT points the same code at Brevo,
 * SendGrid, Mailgun, Outlook or a local capture server without touching
 * anything else. The credential pair stays EMAIL_APP / EMAIL_APP_PASSWORD.
 */
const DEFAULT_HOST = "smtp.gmail.com";
const DEFAULT_PORT = 465;

function readServer(): { host: string; port: number; secure: boolean } {
  const host = process.env.EMAIL_SMTP_HOST?.trim() || DEFAULT_HOST;
  const port = Number(process.env.EMAIL_SMTP_PORT?.trim() || DEFAULT_PORT);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MailerConfigError(`EMAIL_SMTP_PORT is not a valid port: ${port}`);
  }

  // 465 is implicit TLS; 587 and 25 start plaintext and upgrade via STARTTLS.
  return { host, port, secure: port === 465 };
}

export class MailerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailerConfigError";
  }
}

/**
 * Credentials, read from the environment and never from source.
 *
 * Returns `null` rather than throwing when nothing is configured, so local
 * development and CI can run the whole booking flow without a mailbox. A
 * *partial* configuration does throw: one variable set and the other missing is
 * a deployment mistake that would otherwise surface as an authentication
 * failure at the worst possible moment.
 */
function readCredentials(): { user: string; pass: string } | null {
  const user = process.env.EMAIL_APP?.trim();
  // Google displays app passwords as four spaced groups ("abcd efgh ijkl mnop")
  // and people paste them exactly like that. SMTP AUTH wants the 16 characters
  // with no separators, so the spaces come out here rather than becoming a
  // "wrong password" nobody can explain.
  const pass = process.env.EMAIL_APP_PASSWORD?.replace(/\s+/g, "");

  if (!user && !pass) return null;

  if (!user || !pass) {
    throw new MailerConfigError(
      "Email is half-configured: set both EMAIL_APP and EMAIL_APP_PASSWORD, or neither.",
    );
  }

  return { user, pass };
}

/** True when the app is able to send mail at all. */
export function isMailerConfigured(): boolean {
  return readCredentials() !== null;
}

let transporter: Transporter | null = null;

/**
 * The shared transport, or `null` when no credentials are configured.
 *
 * @throws {MailerConfigError} when only one of the two variables is present.
 */
export function getTransporter(): Transporter | null {
  const credentials = readCredentials();
  if (!credentials) return null;

  const server = readServer();

  transporter ??= nodemailer.createTransport({
    host: server.host,
    port: server.port,
    secure: server.secure,
    auth: { user: credentials.user, pass: credentials.pass },
    pool: true,
    maxConnections: 2,
  });

  return transporter;
}

/** The address mail is sent from — the authenticated Gmail account itself. */
export function getFromAddress(): string | null {
  const credentials = readCredentials();
  return credentials ? `AeroFlow <${credentials.user}>` : null;
}

/**
 * Prove the credentials work, without sending anything.
 *
 * Used by the QA script and worth calling at deploy time: a wrong app password
 * otherwise stays invisible until the first real booking, by which point a
 * traveller has already paid and not received their pass.
 */
export async function verifyTransport(): Promise<
  { ok: true; host: string; port: number } | { ok: false; reason: string; hint?: string }
> {
  const mailer = getTransporter();
  if (!mailer) return { ok: false, reason: "not_configured" };

  const server = readServer();

  try {
    await mailer.verify();
    return { ok: true, host: server.host, port: server.port };
  } catch (error) {
    // Message only. A nodemailer error can carry the SMTP conversation, and
    // the AUTH line in it contains the base64-encoded app password.
    const reason = error instanceof Error ? error.message : "unknown";

    // 535 with a well-formed credential is almost never a typo. Say what it
    // actually means so nobody spends an afternoon re-reading the password.
    const hint = /535|BadCredentials|Invalid login/i.test(reason)
      ? server.host === DEFAULT_HOST
        ? "Gmail rejected the credential. Either the App Password was revoked, " +
          "or 2-Step Verification is switched off on the account — turning it " +
          "off invalidates every App Password at once. Generate a new one at " +
          "https://myaccount.google.com/apppasswords, or point EMAIL_SMTP_HOST " +
          "at another provider."
        : "The SMTP server rejected EMAIL_APP / EMAIL_APP_PASSWORD."
      : undefined;

    return { ok: false, reason, hint };
  }
}

/** Where mail is being sent from, for diagnostics. */
export function describeTransport(): string {
  const server = readServer();
  return `${server.host}:${server.port} (${server.secure ? "implicit TLS" : "STARTTLS"})`;
}
