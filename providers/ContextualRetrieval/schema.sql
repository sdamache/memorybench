-- Enable the vector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS contextual_retrieval;

-- Documents table to track source documents
CREATE TABLE IF NOT EXISTS contextual_retrieval.documents (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL
);

-- Chunks table for document chunks (without embeddings)
CREATE TABLE IF NOT EXISTS contextual_retrieval.chunks (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES contextual_retrieval.documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL
);

-- Embeddings table to store chunk embeddings only (no question embeddings)
-- VECTOR(3072) matches gemini-embedding-001 output dimension
CREATE TABLE IF NOT EXISTS contextual_retrieval.embeddings (
    id SERIAL PRIMARY KEY,
    chunk_id INTEGER NOT NULL REFERENCES contextual_retrieval.chunks(id) ON DELETE CASCADE,
    embedding VECTOR(3072) NOT NULL
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON contextual_retrieval.chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_chunk_id ON contextual_retrieval.embeddings(chunk_id);
-- NOTE: No vector index for embeddings because gemini-embedding-001 has 3072 dimensions
-- but pgvector index limit is 2000 dimensions. Searches will use brute-force (slower but accurate).
