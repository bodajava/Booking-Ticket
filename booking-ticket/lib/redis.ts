import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  throw new Error(
    "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set. Copy them from the Upstash console into .env.local",
  );
}

/**
 * Upstash speaks HTTP, so there is no connection pool to reuse and no need for
 * the dev-mode globalThis caching that `db/index.ts` needs.
 */
export const redis = new Redis({ url, token });
