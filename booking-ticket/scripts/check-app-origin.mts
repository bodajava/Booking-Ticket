/**
 * Checks the redirect-origin allowlist in lib/app-origin.ts.
 *
 *   npm run check:origins
 *
 * This is the security-relevant half of the Stripe return flow: it decides
 * which host the browser is sent back to after payment. Getting it wrong
 * either strands the user on an origin where their session cookie does not
 * exist, or — if the request's own headers were trusted blindly — lets a third
 * party aim our redirect at a domain they control.
 */
import { pickReturnOrigin } from "../lib/app-origin.js";

const LOCAL = "http://localhost:3000";
const TUNNEL = "https://aracely-unslanderous-mariam.ngrok-free.dev";
const ALLOWED = [LOCAL, TUNNEL];

let pass = 0;
let fail = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  if (actual === expected) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}\n          expected ${expected}\n          got      ${actual}`);
  }
};

console.log("\n  the browser returns to the origin it is actually on");
check("localhost stays on localhost", pickReturnOrigin([LOCAL], ALLOWED), LOCAL);
check("tunnel stays on the tunnel", pickReturnOrigin([TUNNEL], ALLOWED), TUNNEL);
check("Origin beats forwarded host", pickReturnOrigin([TUNNEL, LOCAL], ALLOWED), TUNNEL);
check("falls through to host when Origin is absent", pickReturnOrigin([null, TUNNEL], ALLOWED), TUNNEL);

console.log("\n  untrusted input cannot steer the redirect");
check("unknown origin falls back", pickReturnOrigin(["https://evil.example"], ALLOWED), LOCAL);
check("look-alike suffix is rejected", pickReturnOrigin(["https://localhost:3000.evil.example"], ALLOWED), LOCAL);
check("port mismatch is rejected", pickReturnOrigin(["http://localhost:9999"], ALLOWED), LOCAL);
check("scheme mismatch is rejected", pickReturnOrigin(["https://localhost:3000"], ALLOWED), LOCAL);
check("javascript: is rejected", pickReturnOrigin(["javascript:alert(1)"], ALLOWED), LOCAL);
check("garbage is rejected", pickReturnOrigin(["not a url"], ALLOWED), LOCAL);
check("empty candidates fall back", pickReturnOrigin([null, undefined], ALLOWED), LOCAL);

console.log("\n  normalisation");
check("trailing slash ignored", pickReturnOrigin([`${LOCAL}/`], ALLOWED), LOCAL);
check("path ignored", pickReturnOrigin([`${LOCAL}/flights/abc`], ALLOWED), LOCAL);
check("case ignored", pickReturnOrigin(["HTTP://LOCALHOST:3000"], ALLOWED), LOCAL);
check("no allowlist means no redirect", pickReturnOrigin([LOCAL], []), null);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
