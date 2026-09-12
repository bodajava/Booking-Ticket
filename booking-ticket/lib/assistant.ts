import { listGuideDestinations, searchGuides, type GuideMatch } from "./guides";
import { CHAT_MODEL, getOpenRouter } from "./openrouter";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type AssistantAnswer = {
  answer: string;
  /** Which guides were retrieved, so the UI can cite them. */
  sources: Array<{ city: string; country: string; similarity: number }>;
  /** Echoed back because OpenRouter may route `:free` ids to a variant. */
  model: string;
};

/** Keep the prompt bounded; older turns matter less than retrieved context. */
const MAX_HISTORY_TURNS = 6;

const SYSTEM_PROMPT = `You are AeroFlow's travel assistant.

Ground every FACTUAL claim about a destination in the guides provided in the
user message. Never invent details about a place.

Do not write citation markers such as [1]. The chat panel shows only your reply
— the guides are not on screen — so a bracketed number points at nothing the
traveller can see. The retrieved guides are returned alongside your answer for
the interface to attribute if it chooses.

Not every message is a question about a destination. Greetings, thanks and
small talk get a warm one-line reply and an offer to help — do not recite what
you cannot do, and never answer a greeting with an apology or a list of
limitations.

When someone asks about a destination you have no guide for, say so in one
sentence and name two or three destinations you DO cover, taken from the
covered list in the user message. Never write a placeholder like "[city]" —
always use real names from that list.

Keep answers under 150 words and practical: what to do, when to go, what to
budget.

Write plain sentences. The chat panel renders text literally, so markdown
syntax such as **bold**, headings or bullet markers appears on screen as raw
asterisks and hashes — use none of it.`;

function formatGuides(guides: GuideMatch[]): string {
  if (guides.length === 0) {
    return "(nothing matched — this may simply be a greeting rather than a destination question)";
  }
  return guides
    .map((g, i) => `[${i + 1}] ${g.city}, ${g.country}\n${g.content}`)
    .join("\n\n");
}

/**
 * Retrieval-augmented answer: embed the question, pull the nearest guides out
 * of pgvector, and ground the model in them.
 *
 * Lives outside the route handler so the whole pipeline is exercisable without
 * an authenticated session.
 */
export async function answerTravelQuestion(
  question: string,
  history: ChatTurn[] = [],
): Promise<AssistantAnswer> {
  // Fetched alongside the search so the model can always name real
  // destinations, including when nothing matched.
  const [guides, covered] = await Promise.all([
    searchGuides(question, { limit: 4 }),
    listGuideDestinations(),
  ]);

  const coveredList = covered.length
    ? covered.map((d) => `${d.city}, ${d.country}`).join(" · ")
    : "(none loaded)";

  const completion = await getOpenRouter().chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0.3,
    max_tokens: 700,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.slice(-MAX_HISTORY_TURNS),
      {
        role: "user",
        content: [
          `Destinations you have guides for: ${coveredList}`,
          "",
          "Retrieved guides:",
          "",
          formatGuides(guides),
          "",
          `Question: ${question}`,
        ].join("\n"),
      },
    ],
  });

  const answer = completion.choices[0]?.message?.content?.trim();

  if (!answer) {
    throw new Error(
      `${CHAT_MODEL} returned an empty completion (finish_reason=${completion.choices[0]?.finish_reason})`,
    );
  }

  return {
    answer,
    sources: guides.map(({ city, country, similarity }) => ({
      city,
      country,
      similarity,
    })),
    model: completion.model,
  };
}
