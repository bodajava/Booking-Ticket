-- Enables pgvector. Must run before `destination_guides` is created, since that
-- table declares a `vector(1536)` column and an HNSW index.
-- Neon ships the extension; this only registers it in the current database.
CREATE EXTENSION IF NOT EXISTS vector;
