/**
 * Two independent authenticated browser sessions on the same flight.
 *
 *   npm run qa:realtime
 *
 * Requires the dev server on :3000 and a seeded flight. Drives two isolated
 * Chromium contexts signed in as different Clerk users, then asserts that seat
 * availability stays in step between them without a single page reload.
 * Verifies real-time propagation, simultaneous-selection arbitration,
 * release/expiry/booking updates, reconnection, and form preservation.
 */
import { createRequire } from "node:module";

// Playwright comes from the gstack browse skill's install — one shared
// Chromium per machine rather than a second copy in this repo.
const require = createRequire(import.meta.url);
const { chromium } = require(
  require.resolve("playwright", {
    paths: [`${process.env.HOME}/.claude/skills/gstack/browse`],
  }),
);
import { execFileSync } from "node:child_process";

const BASE = "http://localhost:3000";
const FLIGHT = "7da3695c-304d-443d-85e0-d98f45d73e5d";
const PROJECT_ROOT = new URL("../..", import.meta.url).pathname;

/**
 * Clerk sign-in tokens are single-use, so they are minted per run rather than
 * cached. Headless sign-up is not an option — the dev instance puts Cloudflare
 * Turnstile in front of the form.
 */
const tickets = JSON.parse(
  execFileSync(
    "npx",
    ["tsx", "--env-file=.env.local", "scripts/qa/sign-in-tickets.mts",
     "aeroflow.qa+clerk_test@example.com", "aeroflow.qa2+clerk_test@example.com"],
    { cwd: PROJECT_ROOT, encoding: "utf8" },
  ),
);
const [A, B] = Object.values(tickets);

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const qaop = (...args) =>
  execFileSync("npx", ["tsx", "--env-file=.env.local", "scripts/qa/ops.mts", ...args],
    { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();

const waitForState = (page, seat, want, timeout = 20000) =>
  page.waitForFunction(
    ([n, w]) => document.querySelector(`[aria-label^="Seat ${n},"]`)?.dataset.state === w,
    [seat, want], { timeout },
  ).then(() => true).catch(() => false);

const seatState = (page, n) =>
  page.getAttribute(`[aria-label^="Seat ${n},"]`, "data-state").catch(() => null);
const badge = (page) =>
  page.evaluate(() => document.body.innerText.match(/\b(LIVE|RECONNECTING…|CONNECTING…|CHECKING EVERY FEW SECONDS)\b/i)?.[1]?.toUpperCase() ?? null);

qaop("clear");
const browser = await chromium.launch();

async function session(label, ticket) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`  [${label}] pageerror: ${e.message}`));
  await page.goto(`${BASE}/sign-in?__clerk_ticket=${ticket.token}`, { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30000 }).catch(() => {});
  await page.goto(`${BASE}/flights/${FLIGHT}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-seat-id]", { timeout: 20000 });
  await page.waitForFunction(() => /\bLIVE\b/i.test(document.body.innerText), { timeout: 20000 }).catch(() => {});
  return { context, page };
}

console.log("\n── setup: two isolated browser contexts ──");
const a = await session("A", A);
const b = await session("B", B);
check("A signed in", !(await a.page.evaluate(() => document.body.innerText.includes("Sign in to choose a seat"))));
check("B signed in", !(await b.page.evaluate(() => document.body.innerText.includes("Sign in to choose a seat"))));
check("A shows Live badge", (await badge(a.page)) === "LIVE", `got ${await badge(a.page)}`);
check("B shows Live badge", (await badge(b.page)) === "LIVE", `got ${await badge(b.page)}`);

console.log("\n── 1. hold in A propagates to B with no reload ──");
const SEAT1 = "31D";
check(`B sees ${SEAT1} available first`, (await seatState(b.page, SEAT1)) === "available");
const bNavCount = await b.page.evaluate(() => performance.getEntriesByType("navigation").length);
await a.page.click(`[aria-label^="Seat ${SEAT1},"]`);
await b.page.waitForFunction(
  (n) => document.querySelector(`[aria-label^="Seat ${n},"]`)?.dataset.state === "held",
  SEAT1, { timeout: 15000 },
).catch(() => {});
check(`B sees ${SEAT1} held`, (await seatState(b.page, SEAT1)) === "held", `got ${await seatState(b.page, SEAT1)}`);
await a.page.waitForFunction(
  (n) => document.querySelector(`[aria-label^="Seat ${n},"]`)?.dataset.state === "selected",
  SEAT1, { timeout: 15000 },
).catch(() => {});
check(`A sees ${SEAT1} as its own selection`, (await seatState(a.page, SEAT1)) === "selected", `got ${await seatState(a.page, SEAT1)}`);
check("B did not reload", (await b.page.evaluate(() => performance.getEntriesByType("navigation").length)) === bNavCount);

console.log("\n── 2. B's form inputs survive A's update ──");
await b.page.click(`[aria-label^="Seat 32E,"]`);
await b.page.waitForSelector("#p0-name", { timeout: 15000 });
await b.page.fill("#p0-name", "Priya Menon");
await b.page.fill("#p0-passport", "P9988776");
await b.page.selectOption("#p0-nationality", "AE");
await b.page.fill("#p0-dob", "1991-02-20");
await b.page.click('[aria-label*="Add a kilo"]');
await b.page.click('[aria-label*="Add a kilo"]');
await sleep(1200);
const beforeTotal = await b.page.evaluate(() => document.body.innerText.match(/Total\s+\$[\d,.]+/)?.[0]);
await a.page.click(`[aria-label^="Seat 34A,"]`);   // A switches seat -> two events to B
await sleep(3000);
check("B name preserved", (await b.page.inputValue("#p0-name")) === "Priya Menon");
check("B passport preserved", (await b.page.inputValue("#p0-passport")) === "P9988776");
check("B baggage preserved", (await b.page.evaluate(() => document.body.innerText.includes("+2kg"))));
check("B total unchanged", (await b.page.evaluate(() => document.body.innerText.match(/Total\s+\$[\d,.]+/)?.[0])) === beforeTotal, `${beforeTotal}`);
check("B still holds 32E", (await seatState(b.page, "32E")) === "selected");
check(`B sees A's old seat ${SEAT1} released`, (await seatState(b.page, SEAT1)) === "available", `got ${await seatState(b.page, SEAT1)}`);
check("B sees A's new seat 34A held", (await seatState(b.page, "34A")) === "held", `got ${await seatState(b.page, "34A")}`);

console.log("\n── 3. simultaneous selection: exactly one winner ──");
const SEAT2 = "36F";
await Promise.all([
  a.page.click(`[aria-label^="Seat ${SEAT2},"]`).then(() => "clicked").catch((e) => e.message),
  b.page.click(`[aria-label^="Seat ${SEAT2},"]`).then(() => "clicked").catch((e) => e.message),
]);
await sleep(4000);
const sa = await seatState(a.page, SEAT2), sb = await seatState(b.page, SEAT2);
const winners = [sa, sb].filter((s) => s === "selected").length;
check("exactly one session won", winners === 1, `A=${sa} B=${sb}`);
const alertText = await a.page.evaluate(() => document.querySelector('[role=alert]')?.innerText ?? "")
  + " | " + await b.page.evaluate(() => document.querySelector('[role=alert]')?.innerText ?? "");
check("loser was told the seat was taken", /just|Someone else|taken|Choose another/i.test(alertText), alertText.trim());
check("loser sees the seat as held", [sa, sb].filter((s) => s === "held").length === 1, `A=${sa} B=${sb}`);

console.log("\n── 4. release propagates ──");
const holder = sa === "selected" ? a : b;
const watcher = sa === "selected" ? b : a;
await holder.page.click('button:has-text("Release ")');
await watcher.page.waitForFunction(
  (n) => document.querySelector(`[aria-label^="Seat ${n},"]`)?.dataset.state === "available",
  SEAT2, { timeout: 15000 },
).catch(() => {});
check("watcher sees released seat available", (await seatState(watcher.page, SEAT2)) === "available", `got ${await seatState(watcher.page, SEAT2)}`);

console.log("\n── 4b. re-establish B with a seat and a filled form ──");
await b.page.click(`[aria-label^="Seat 40D,"]`);
await b.page.waitForSelector("#p0-name", { timeout: 20000 });
await b.page.fill("#p0-name", "Priya Menon");
await b.page.fill("#p0-passport", "P9988776");
await b.page.selectOption("#p0-nationality", "AE");
await b.page.fill("#p0-dob", "1991-02-20");
await b.page.click('[aria-label*="Add a kilo"]');
await sleep(1500);
check("B holds 40D with a filled form", (await b.page.inputValue("#p0-name")) === "Priya Menon");

console.log("\n── 5. hold expiry reaches both sessions with nobody's browser open ──");
// A hold owned by a user that has no browser here at all: proves expiry does
// not depend on the holder's client being alive to release it.
const SEAT3 = "38B";
console.log("   " + qaop("holdshort", SEAT3, "6000"));
check("A sees it held", await waitForState(a.page, SEAT3, "held", 15000), `got ${await seatState(a.page, SEAT3)}`);
check("B sees it held", await waitForState(b.page, SEAT3, "held", 15000), `got ${await seatState(b.page, SEAT3)}`);
check("A sees it free again once it lapses", await waitForState(a.page, SEAT3, "available", 30000),
  `got ${await seatState(a.page, SEAT3)}`);
check("B sees it free again once it lapses", await waitForState(b.page, SEAT3, "available", 30000),
  `got ${await seatState(b.page, SEAT3)}`);

console.log("\n── 5b. the holder's own countdown ending clears their selection ──");
const SEAT3B = "41F";
await a.page.click(`[aria-label^="Seat ${SEAT3B},"]`);
check("A holds it", await waitForState(a.page, SEAT3B, "selected"));
// Shorten the hold, then reload: the page re-reads the real PTTL from Redis,
// so A's countdown now runs to the actual deadline rather than a remembered
// one. This is the same path a user takes when they reload mid-checkout.
console.log("   " + qaop("expire", SEAT3B));
await a.page.reload({ waitUntil: "domcontentloaded" });
await a.page.waitForSelector("[data-seat-id]", { timeout: 20000 });
check("A's countdown resumed from the real expiry", await a.page.evaluate(() => {
  const t = document.querySelector("[role=progressbar]")?.getAttribute("aria-valuetext") ?? "";
  const m = t.match(/(\d+) minutes (\d+) seconds/);
  return m ? Number(m[1]) === 0 && Number(m[2]) <= 30 : false;
}));
check("A is told the hold ended", await a.page.waitForFunction(
  () => /hold ended/i.test(document.querySelector("[aria-live=polite]")?.innerText ?? ""),
  { timeout: 30000 }).then(() => true).catch(() => false));
check("A's seat assignment cleared", await a.page.evaluate(() =>
  /No seat chosen/.test(document.body.innerText)));
check("A's typed details were NOT discarded", await a.page.evaluate(() =>
  document.querySelector("#p0-name") !== null));

console.log("\n── 6. confirmed booking reaches both sessions ──");
const bookOut = qaop("book");
console.log("   " + bookOut.split("\n")[0]);
const SEAT4 = bookOut.match(/SEAT=(\S+)/)[1];
check("A sees it booked", await waitForState(a.page, SEAT4, "booked", 25000), `got ${await seatState(a.page, SEAT4)}`);
check("B sees it booked", await waitForState(b.page, SEAT4, "booked", 25000), `got ${await seatState(b.page, SEAT4)}`);

console.log("\n── 7. B's form inputs survived every update above ──");
check("B name still set", (await b.page.inputValue("#p0-name")) === "Priya Menon");
check("B passport still set", (await b.page.inputValue("#p0-passport")) === "P9988776");
const bBaggage = await b.page.evaluate(() => {
  const el = [...document.querySelectorAll("section")].find((s) => /Checked baggage/.test(s.innerText));
  return el ? el.innerText.replace(/\s+/g, " ") : "(no baggage section)";
});
check("B baggage still set", /\+1kg/.test(bBaggage), `-> ${bBaggage}`);
check("B still holds 40D", (await seatState(b.page, "40D")) === "selected");

console.log("\n── 8. reconnecting indicator when the stream is unreachable ──");
// Block the stream route, then reload so the page must open a fresh
// EventSource against a server it cannot reach.
await a.context.route("**/stream", (route) => route.abort());
await a.page.reload({ waitUntil: "domcontentloaded" });
await a.page.waitForSelector("[data-seat-id]", { timeout: 20000 });
const showedIndicator = await a.page.waitForFunction(
  () => /RECONNECTING|CONNECTING|CHECKING EVERY FEW SECONDS/i.test(document.body.innerText),
  { timeout: 30000 },
).then(() => true).catch(() => false);
check("A shows a non-live indicator", showedIndicator, `badge=${await badge(a.page)}`);
check("A never claims to be Live while cut off", (await badge(a.page)) !== "LIVE", `badge=${await badge(a.page)}`);
check("A still renders the cabin while cut off",
  (await a.page.locator("[data-seat-id]").count()) > 100);

console.log("\n── 9. recovery once the stream is reachable again ──");
await a.context.unroute("**/stream");
await a.page.evaluate(() => window.dispatchEvent(new Event("online")));
check("A returns to Live", await a.page.waitForFunction(
  () => /\bLIVE\b/i.test(document.body.innerText), { timeout: 40000 },
).then(() => true).catch(() => false), `badge=${await badge(a.page)}`);
check("A resynced its availability", (await seatState(a.page, SEAT4)) === "booked");

console.log(`\n  ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
