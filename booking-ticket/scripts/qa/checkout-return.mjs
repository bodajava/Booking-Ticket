/**
 * Sign in → pick a seat → Stripe Checkout → return → still signed in.
 *
 *   npm run qa:checkout
 *
 * Guards the regression this exists for: the browser must come back to the
 * origin it signed in on. A return to a different host renders a signed-out
 * page even though the session is untouched, because session cookies are
 * host-scoped.
 *
 * Card entry is the one step not driven here — Stripe's card fields are
 * cross-origin iframes behind hCaptcha. The payment is completed by delivering
 * the correctly-signed webhook Stripe would have sent for the real session.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = require(
  require.resolve("playwright", { paths: [`${process.env.HOME}/.claude/skills/gstack/browse`] }),
);

const PROJECT_ROOT = new URL("../..", import.meta.url).pathname;
const ORIGIN = process.env.QA_ORIGIN ?? "http://localhost:3000";
const FLIGHT = process.env.QA_FLIGHT ?? "7da3695c-304d-443d-85e0-d98f45d73e5d";

const run = (args) =>
  execFileSync("npx", ["tsx", "--env-file=.env.local", ...args], {
    cwd: PROJECT_ROOT, encoding: "utf8",
  }).trim();

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

run(["scripts/qa/ops.mts", "clear"]);
const ticket = Object.values(
  JSON.parse(run(["scripts/qa/sign-in-tickets.mts", "aeroflow.qa+clerk_test@example.com"])),
)[0];

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const signedIn = async () =>
  !(await page.evaluate(() => document.body.innerText.includes("Sign in to choose a seat")));
const headerSignedOut = async () =>
  page.evaluate(() => /Create account/.test(document.body.innerText));

console.log(`\n── 1. sign in at ${ORIGIN} ──`);
await page.goto(`${ORIGIN}/sign-in?__clerk_ticket=${ticket.token}`, { waitUntil: "domcontentloaded" });
await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30000 }).catch(() => {});
await page.goto(`${ORIGIN}/flights/${FLIGHT}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-seat-id]", { timeout: 25000 });
await page.waitForTimeout(2000);
check("signed in", await signedIn());

console.log("\n── 2. select a seat and start checkout ──");
const seat = await page.evaluate(() =>
  document.querySelector('[data-state="available"]')?.getAttribute("aria-label")?.match(/Seat (\S+),/)?.[1]);
await page.click(`[aria-label^="Seat ${seat},"]`);
await page.waitForSelector("#p0-name", { timeout: 20000 });
await page.fill("#p0-name", "Return Path");
await page.fill("#p0-passport", "R7654321");
await page.selectOption("#p0-nationality", "EG");
await page.fill("#p0-dob", "1990-06-15");
await page.waitForTimeout(1200);
await page.click("text=Continue to payment");
await page.waitForURL((u) => u.hostname.includes("stripe.com"), { timeout: 45000 });
const sessionId = page.url().match(/(cs_test_[A-Za-z0-9]+)/)[1];
check(`reached Stripe with seat ${seat}`, Boolean(sessionId));

console.log("\n── 3. the return URL points back at the signing origin ──");
const urls = run(["scripts/qa/ops.mts", "urls", sessionId]);
const successUrl = urls.match(/success_url (\S+)/)[1];
console.log(`   success_url ${successUrl}`);
check("success_url is on the same origin as sign-in", successUrl.startsWith(ORIGIN), successUrl);
check("cancel_url is on the same origin", urls.match(/cancel_url (\S+)/)[1].startsWith(ORIGIN));

console.log("\n── 4. return to the app before the booking exists ──");
const returnUrl = successUrl.replace("{CHECKOUT_SESSION_ID}", sessionId);
await page.goto(returnUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
check("still signed in on return", !(await headerSignedOut()));
check("session_id preserved in the URL", page.url().includes(sessionId));
check("does not claim a booking yet",
  await page.evaluate(() => !/Booking reference/i.test(document.body.innerText)));
// The card step cannot be driven headlessly, so Stripe still reports this
// session as unpaid. "Nothing was charged" is therefore the correct copy —
// the paid-but-webhook-pending window needs a real card payment to observe.
check("says nothing was charged while the session is unpaid",
  await page.evaluate(() => /Nothing was charged|not been booked/i.test(document.body.innerText)));

console.log("\n── 5. webhook confirms the sale; the booking becomes visible ──");
console.log("   " + run(["scripts/qa/ops.mts", "webhook", sessionId]));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
check("booking is shown once the webhook has run",
  await page.evaluate(() => /Booking reference/i.test(document.body.innerText)));
check("still signed in after confirmation", !(await headerSignedOut()));
// The label renders uppercase via CSS, so match case-insensitively.
const pnr = await page.evaluate(() =>
  document.body.innerText.match(/booking reference\s*([A-Z0-9]{6})/i)?.[1]);
check("booking reference shown", /^[A-Z0-9]{6}$/.test(pnr ?? ""), `got ${pnr}`);

console.log("\n── 6. the session survived the whole round trip ──");
await page.goto(`${ORIGIN}/flights/${FLIGHT}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-seat-id]", { timeout: 25000 });
await page.waitForTimeout(1500);
check("still signed in back on the flight page", await signedIn());

console.log("\n── 7. another user cannot read this booking ──");
const other = Object.values(
  JSON.parse(run(["scripts/qa/sign-in-tickets.mts", "aeroflow.qa2+clerk_test@example.com"])),
)[0];
const ctx2 = await browser.newContext();
const page2 = await ctx2.newPage();
await page2.goto(`${ORIGIN}/sign-in?__clerk_ticket=${other.token}`, { waitUntil: "domcontentloaded" });
await page2.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30000 }).catch(() => {});
await page2.goto(returnUrl, { waitUntil: "domcontentloaded" });
await page2.waitForTimeout(2500);
check("other user is redirected away from the booking",
  !page2.url().includes("/bookings/confirmed"), `landed on ${page2.url()}`);
check("other user sees no booking reference",
  await page2.evaluate(() => !/Booking reference/i.test(document.body.innerText)));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
