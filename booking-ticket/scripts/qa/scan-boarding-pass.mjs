/**
 * Scans the boarding-pass QR codes the way a phone camera would.
 *
 *   npm run qa:scan -- <PNR>
 *
 * Uses Chromium's BarcodeDetector to decode the codes actually rendered by the
 * email endpoint and the boarding-pass page, rather than trusting that what we
 * encoded is what came out. Then follows the decoded URL in a session-less
 * context, which is the real scan path: a gate agent's phone has no account.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = require(
  require.resolve("playwright", { paths: [`${process.env.HOME}/.claude/skills/gstack/browse`] }),
);

const ROOT = new URL("../..", import.meta.url).pathname;
const PNR = (process.argv[2] ?? "").toUpperCase();
if (!PNR) {
  console.error("usage: npm run qa:scan -- <PNR>");
  process.exit(1);
}

// Minted per run: Clerk sign-in tokens are single-use, so a cached one from an
// earlier run silently leaves the browser signed out and the pass 404s.
const ticket = Object.values(
  JSON.parse(
    execFileSync(
      "npx",
      ["tsx", "--env-file=.env.local", "scripts/qa/sign-in-tickets.mts",
       "aeroflow.qa+clerk_test@example.com"],
      { cwd: ROOT, encoding: "utf8" },
    ),
  ),
)[0];

const [token] = execFileSync(
  "npx",
  ["tsx", "--env-file=.env.local", "scripts/qa/latest-token.mts"],
  { cwd: ROOT, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .pop()
  .split("\t");

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};

// The canonical origin the QR encodes. Read from the environment rather than
// assumed: it is localhost in development and the real domain in production,
// and the codes must match whichever is configured.
const ORIGIN = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * ngrok's free tier answers browser-looking requests with an interstitial
 * instead of the app. Real mail clients and phone cameras hit the same wall —
 * which is exactly why the email carries the QR as an inline attachment — but
 * the test needs to reach the page underneath it.
 *
 * Applied per-request rather than as context-wide `extraHTTPHeaders`: those go
 * to *every* host, including Clerk's frontend API, where the unexpected header
 * breaks the sign-in handshake and leaves the browser silently signed out.
 */
const bypassTunnelInterstitial = async (context) => {
  if (!ORIGIN.includes("ngrok")) return;
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (!url.includes("ngrok-free.dev")) return route.continue();
    return route.continue({
      headers: { ...route.request().headers(), "ngrok-skip-browser-warning": "1" },
    });
  });
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 900 },
  isMobile: true,
  deviceScaleFactor: 3,
});
await bypassTunnelInterstitial(ctx);
const page = await ctx.newPage();

await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
const supported = await page.evaluate(() => "BarcodeDetector" in globalThis);
if (!supported) {
  console.log("  BarcodeDetector unavailable in this Chromium — cannot scan");
  await browser.close();
  process.exit(2);
}

/* ---- 1. the QR the email embeds ---- */
console.log("\n── scanning the email QR (PNG endpoint) ──");
await page.goto(`http://localhost:3000/api/boarding-pass/${token}/qr`, { waitUntil: "load" });
const emailScan = await page.evaluate(async () => {
  const img = document.querySelector("img");
  await img.decode();
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  return (await detector.detect(img)).map((c) => c.rawValue);
});
check("email QR decodes", emailScan.length === 1, JSON.stringify(emailScan));
check(
  "email QR points at the verification URL",
  emailScan[0] === `${ORIGIN}/verify/${token}`,
  emailScan[0],
);
check("email QR carries no PNR", !emailScan[0]?.includes(PNR));

/* ---- 2. the QR on the boarding pass ---- */
console.log("\n── scanning the boarding-pass QR (inline SVG) ──");
await page.goto(`http://localhost:3000/sign-in?__clerk_ticket=${ticket.token}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30000 }).catch(() => {});
await page.goto(`http://localhost:3000/bookings/${PNR}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);

const box = await page.locator("[data-boarding-pass-qr]").boundingBox();
const shot = await page.screenshot({ clip: box });
const passScan = await page.evaluate(async (data) => {
  const img = new Image();
  img.src = `data:image/png;base64,${data}`;
  await img.decode();
  const bitmap = await createImageBitmap(img);
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  return (await detector.detect(bitmap)).map((c) => c.rawValue);
}, shot.toString("base64"));

check("boarding-pass QR decodes", passScan.length === 1, JSON.stringify(passScan));
check("boarding-pass QR is a /verify link", /\/verify\/[0-9A-Z]{32}$/.test(passScan[0] ?? ""), passScan[0]);
check("boarding-pass QR carries no PNR", !passScan[0]?.includes(PNR));

/* ---- 3. follow the scanned link, as a phone would ---- */
console.log("\n── following the scanned link, no session ──");
const scanned = passScan[0] ?? emailScan[0];
const anon = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
await bypassTunnelInterstitial(anon);
const ap = await anon.newPage();
const resp = await ap.goto(scanned, { waitUntil: "domcontentloaded" });
await ap.waitForTimeout(900);
const body = await ap.evaluate(() => document.body.innerText);

check("loads without a session", resp.status() === 200, String(resp.status()));
check("not redirected to sign-in", !ap.url().includes("sign-in"), ap.url());
check("shows the verdict", /Valid boarding pass|departed|cancelled/.test(body));
check("shows the flight number", /\b[A-Z]{2}\d+\b/.test(body));
check("shows a seat", /Seat/i.test(body));
check("shows baggage in kg", /\d+\s?kg/.test(body));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
