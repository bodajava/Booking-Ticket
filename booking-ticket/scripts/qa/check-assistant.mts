/**
 * Behavioural check on the travel concierge.
 *
 *   npm run qa:assistant
 *
 * Retrieval was never broken — a greeting simply scores ~0.1 against travel
 * guides, so nothing passes the similarity floor and the model used to answer
 * "hello" with a list of things it cannot do. These assertions pin the two
 * behaviours that matter: conversational turns get a conversational reply, and
 * a real question gets a grounded one naming real places.
 */
import { answerTravelQuestion } from "../../lib/assistant.js";
import { listGuideDestinations, searchGuides } from "../../lib/guides.js";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          ${extra}`); }
};

console.log("\n── retrieval health ──");
const covered = await listGuideDestinations();
check("guides are loaded and embedded", covered.length > 0, `${covered.length} destinations`);
console.log(`  covering: ${covered.map((d) => d.city).join(", ")}`);

const onTopic = await searchGuides("best time to visit Cairo", { limit: 4 });
check("a real question retrieves guides", onTopic.length > 0, `${onTopic.length} hits`);

const greeting = await searchGuides("hello can you help me", { limit: 4 });
check("a greeting retrieves nothing (expected)", greeting.length === 0);

// The chat model is on OpenRouter's free tier, which has a daily request cap.
// When it is exhausted the retrieval half is still worth checking, so the
// script degrades to that rather than reporting a false failure.
const chatAvailable = await answerTravelQuestion("hi")
  .then(() => true)
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (/429|rate limit/i.test(message)) {
      console.log("\n  SKIP  chat model is rate-limited today — retrieval checks above still ran");
      return false;
    }
    throw error;
  });

if (!chatAvailable) {
  console.log(`\n  ${pass} passed, ${fail} failed (chat checks skipped)\n`);
  process.exit(fail === 0 ? 0 : 1);
}

console.log("\n── greeting gets a greeting, not an apology ──");
const hello = await answerTravelQuestion("hello sir you can help me pleass");
console.log(`  → ${hello.answer.replace(/\s+/g, " ").slice(0, 160)}`);
check("does not claim it has no guides", !/don't have any destination guides|no destination guides/i.test(hello.answer), hello.answer.slice(0, 120));
check("contains no bracket placeholders", !/\[(city|destination|place)\]/i.test(hello.answer), hello.answer.slice(0, 120));
check("is short", hello.answer.length < 700, `${hello.answer.length} chars`);

console.log("\n── unknown destination names real ones ──");
const unknown = await answerTravelQuestion("what should I do in Reykjavik?");
console.log(`  → ${unknown.answer.replace(/\s+/g, " ").slice(0, 200)}`);
check("names at least one covered destination",
  covered.some((d) => unknown.answer.includes(d.city)),
  unknown.answer.slice(0, 160));
check("no bracket placeholders", !/\[(city|destination|place)\]/i.test(unknown.answer));

console.log("\n── a real question is answered and grounded ──");
const real = await answerTravelQuestion("What should I budget for a 5-day trip to Dubai?");
console.log(`  → ${real.answer.replace(/\s+/g, " ").slice(0, 200)}`);
// Grounding is asserted through the retrieval that produced the answer and
// the facts in it, not through a citation marker. Whether a model emits "[1]"
// is stylistic and varies run to run; whether it used the guide does not.
check("no citation markers to invisible sources",
  !/[[\u3010]\s*\d\s*[\]\u3011]/.test(real.answer), real.answer.slice(0, 160));
check("uses the figure from the guide", /120|600/.test(real.answer), real.answer.slice(0, 160));
check("reports its sources", real.sources.length > 0, `${real.sources.length}`);
check("mentions Dubai", /dubai/i.test(real.answer));
// The panel renders message text literally, so markdown would show as symbols.
check("no markdown bold", !/\*\*/.test(real.answer), real.answer.slice(0, 120));
check("no markdown headings or bullets", !/^\s*[#*-]\s/m.test(real.answer), real.answer.slice(0, 120));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
