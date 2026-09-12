import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add your Neon connection string to .env.local");
}

// Routes single (non-transactional) queries over HTTP fetch instead of opening
// a WebSocket, which is meaningfully cheaper in serverless. Transactions still
// use the WebSocket pool.
neonConfig.poolQueryViaFetch = true;

const createPool = () => new Pool({ connectionString: process.env.DATABASE_URL });

// Next.js hot-reloads modules in dev, which would otherwise leak a pool per edit.
const globalForDb = globalThis as unknown as { pool?: Pool };
const pool = globalForDb.pool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema });

export type Db = typeof db;
export * from "./schema";
