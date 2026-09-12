/**
 * Proves the SMTP credentials work, without sending anything.
 *
 *   npm run qa:mailer
 *
 * A wrong Gmail App Password otherwise stays invisible until the first real
 * booking — by which point a traveller has paid and not received their pass.
 * Prints no secret: on failure only the SMTP error *message* is shown, because
 * a nodemailer error object can carry the protocol transcript, and the AUTH
 * line in that transcript contains the base64-encoded password.
 */
import { describeTransport, getFromAddress, isMailerConfigured, verifyTransport } from "../../lib/mailer.js";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

console.log("\n── configuration ──");
check("EMAIL_APP is set", Boolean(process.env.EMAIL_APP));
check("EMAIL_APP_PASSWORD is set", Boolean(process.env.EMAIL_APP_PASSWORD));
check("mailer reports configured", isMailerConfigured());
check("no NEXT_PUBLIC_ email vars", !Object.keys(process.env).some((k) => /^NEXT_PUBLIC_EMAIL/i.test(k)));
check("no Resend vars left", !process.env.RESEND_API_KEY && !process.env.RESEND_FROM);

const from = getFromAddress();
check("sends from the configured account", Boolean(from?.includes("@")), from ?? "none");

console.log("\n── nothing leaks to the browser ──");
// The real protection is that Next never inlines a non-NEXT_PUBLIC_ variable
// into a client bundle. Asserted against the built chunks rather than trusted:
// this is the check that would actually catch someone renaming the variable to
// NEXT_PUBLIC_ or pasting the password into a component.
const { readdirSync, readFileSync, existsSync } = await import("node:fs");
const { join } = await import("node:path");

const chunkDir = join(process.cwd(), ".next", "static", "chunks");
if (!existsSync(chunkDir)) {
  console.log("  SKIP  no client build found — run `npm run build` first");
} else {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : full.endsWith(".js") ? [full] : [];
    });

  const chunks = walk(chunkDir);
  const secret = process.env.EMAIL_APP_PASSWORD ?? "@@none@@";
  const account = process.env.EMAIL_APP ?? "@@none@@";

  const leakingSecret = chunks.filter((f) => readFileSync(f, "utf8").includes(secret));
  const leakingAccount = chunks.filter((f) => readFileSync(f, "utf8").includes(account));
  const leakingResend = chunks.filter((f) => /RESEND_API_KEY|from "resend"/.test(readFileSync(f, "utf8")));

  check(`app password absent from all ${chunks.length} client chunks`, leakingSecret.length === 0, leakingSecret.join(", "));
  check("account address absent from client chunks", leakingAccount.length === 0, leakingAccount.join(", "));
  check("no Resend remnants in client chunks", leakingResend.length === 0, leakingResend.join(", "));
}

console.log(`\n── SMTP handshake: ${describeTransport()} ──`);
const result = await verifyTransport();
check("server accepts the credentials", result.ok, result.ok ? "" : result.reason);
if (!result.ok && result.hint) console.log(`\n  → ${result.hint}`);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
