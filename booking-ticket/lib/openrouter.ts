import OpenAI from "openai";

let client: OpenAI | null = null;

/**
 * OpenRouter is OpenAI-wire-compatible for both `/chat/completions` and
 * `/embeddings`, so the official `openai` client works against it directly and
 * gives far better types than the generated OpenRouter SDK.
 *
 * Constructed lazily: `listFreeChatModels` hits a public endpoint and must stay
 * usable without a key, and Next.js must be able to import this module during a
 * build that has no secrets available.
 */
export function getOpenRouter(): OpenAI {
  if (client) return client;

  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Create a key at https://openrouter.ai/keys and add it to .env.local",
    );
  }

  client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      // Optional attribution — shows the app on OpenRouter's dashboard rankings.
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": "AeroFlow",
    },
  });

  return client;
}

/**
 * Default returns 1536 dimensions, which is exactly what
 * `destination_guides.embedding` declares — swapping models means changing
 * that column and rebuilding the HNSW index, so override with care.
 */
export const EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL ?? "openai/text-embedding-3-small";

/**
 * Free-tier chat model.
 *
 * `openrouter/free` routes to whichever free model is currently up, which
 * matters more than it sounds: probing the catalogue on a free-tier key, most
 * named `:free` models returned 429 (throttled) or 403 (paid tiers only), and
 * some reasoning models burn the whole token budget on hidden thinking and
 * return an empty message. The router sidesteps all three.
 *
 * Pin a specific id via OPENROUTER_CHAT_MODEL if you need reproducible output;
 * `npm run ai:models` lists what is live right now.
 */
export const CHAT_MODEL =
  process.env.OPENROUTER_CHAT_MODEL ?? "openrouter/free";

export type FreeModel = { id: string; name: string; contextLength: number };

/** Models currently priced at zero for both prompt and completion tokens. */
export async function listFreeChatModels(): Promise<FreeModel[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) {
    throw new Error(`Could not list models: ${res.status} ${res.statusText}`);
  }

  const { data } = (await res.json()) as {
    data: Array<{
      id: string;
      name: string;
      context_length: number;
      pricing: { prompt: string; completion: string };
    }>;
  };

  return data
    .filter(
      (m) =>
        Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0,
    )
    .map((m) => ({
      id: m.id,
      name: m.name,
      contextLength: m.context_length,
    }));
}
