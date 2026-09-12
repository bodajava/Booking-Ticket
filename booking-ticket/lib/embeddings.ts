import { EMBEDDING_DIMENSIONS } from "@/db/schema";
import { EMBEDDING_MODEL, getOpenRouter } from "./openrouter";

/**
 * Providers cap how many inputs one embeddings call accepts. 96 is the
 * conservative ceiling that every OpenRouter-fronted provider honours.
 */
const MAX_INPUTS_PER_REQUEST = 96;

function assertDimensions(vector: number[], model: string): number[] {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `${model} returned ${vector.length} dimensions but destination_guides.embedding is vector(${EMBEDDING_DIMENSIONS}). ` +
        `Either pick a ${EMBEDDING_DIMENSIONS}-dimension model or migrate the column.`,
    );
  }
  return vector;
}

/** Embed a single string. */
export async function embed(input: string): Promise<number[]> {
  const [vector] = await embedBatch([input]);
  return vector;
}

/**
 * Embed many strings, preserving input order. Chunks automatically, and
 * re-sorts each response by its `index` since providers are not required to
 * return embeddings in request order.
 */
export async function embedBatch(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const vectors: number[][] = [];

  for (let i = 0; i < inputs.length; i += MAX_INPUTS_PER_REQUEST) {
    const chunk = inputs.slice(i, i + MAX_INPUTS_PER_REQUEST);

    const response = await getOpenRouter().embeddings.create({
      model: EMBEDDING_MODEL,
      input: chunk,
    });

    const ordered = [...response.data].sort((a, b) => a.index - b.index);

    for (const item of ordered) {
      vectors.push(assertDimensions(item.embedding as number[], EMBEDDING_MODEL));
    }
  }

  return vectors;
}
