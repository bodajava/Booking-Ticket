import { cosineDistance, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { destinationGuides } from "@/db/schema";
import { embed, embedBatch } from "./embeddings";

export type GuideMatch = {
  id: string;
  city: string;
  country: string;
  content: string;
  /** 1.0 is identical, 0.0 is unrelated. */
  similarity: number;
};

export type SearchGuidesOptions = {
  limit?: number;
  /** Drop weak matches so the model is not fed irrelevant context. */
  minSimilarity?: number;
};

/**
 * Semantic search over destination guides.
 *
 * Ordering is by cosine *distance* ascending, which is what lets Postgres use
 * the `hnsw (embedding vector_cosine_ops)` index. Ordering by similarity
 * descending, or filtering on similarity in SQL, would force a sequential scan.
 * The threshold is therefore applied after the indexed top-k comes back.
 */
export async function searchGuides(
  query: string,
  { limit = 5, minSimilarity = 0.2 }: SearchGuidesOptions = {},
): Promise<GuideMatch[]> {
  const queryEmbedding = await embed(query);
  const distance = cosineDistance(destinationGuides.embedding, queryEmbedding);

  const rows = await db
    .select({
      id: destinationGuides.id,
      city: destinationGuides.city,
      country: destinationGuides.country,
      content: destinationGuides.content,
      distance: sql<number>`${distance}`,
    })
    .from(destinationGuides)
    .where(isNotNull(destinationGuides.embedding))
    .orderBy(distance)
    .limit(limit);

  return rows
    .map(({ distance: d, ...guide }) => ({
      ...guide,
      similarity: 1 - Number(d),
    }))
    .filter((guide) => guide.similarity >= minSimilarity);
}

/**
 * Every destination we hold a guide for.
 *
 * The assistant needs this even when a search returns nothing: without it the
 * model has no idea what it covers, and its "try asking about…" suggestions
 * come out as literal placeholders like "[city]". Cheap enough to read per
 * question — six rows, no embedding call, no vector scan.
 */
export async function listGuideDestinations(): Promise<
  Array<{ city: string; country: string }>
> {
  return db
    .select({ city: destinationGuides.city, country: destinationGuides.country })
    .from(destinationGuides)
    .where(isNotNull(destinationGuides.embedding))
    .orderBy(destinationGuides.city);
}

export type NewGuide = { city: string; country: string; content: string };

/** Insert guides, embedding all of them in as few API calls as possible. */
export async function createGuides(guides: NewGuide[]): Promise<number> {
  if (guides.length === 0) return 0;

  const embeddings = await embedBatch(
    guides.map((g) => `${g.city}, ${g.country}\n\n${g.content}`),
  );

  const inserted = await db
    .insert(destinationGuides)
    .values(guides.map((g, i) => ({ ...g, embedding: embeddings[i] })))
    .returning({ id: destinationGuides.id });

  return inserted.length;
}

/**
 * Embed any guides that were inserted without a vector — for content imported
 * from elsewhere, or rows written before an embedding-model change.
 */
export async function backfillGuideEmbeddings(): Promise<number> {
  const pending = await db
    .select({
      id: destinationGuides.id,
      city: destinationGuides.city,
      country: destinationGuides.country,
      content: destinationGuides.content,
    })
    .from(destinationGuides)
    .where(sql`${destinationGuides.embedding} IS NULL`);

  if (pending.length === 0) return 0;

  const embeddings = await embedBatch(
    pending.map((g) => `${g.city}, ${g.country}\n\n${g.content}`),
  );

  await Promise.all(
    pending.map((guide, i) =>
      db
        .update(destinationGuides)
        .set({ embedding: embeddings[i] })
        .where(sql`${destinationGuides.id} = ${guide.id}`),
    ),
  );

  return pending.length;
}
