-- Enable the vector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS aqrag;

-- Documents table to track source documents
CREATE TABLE IF NOT EXISTS aqrag.documents (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL
);

-- Chunks table for document chunks (without embeddings)
CREATE TABLE IF NOT EXISTS aqrag.chunks (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES aqrag.documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL
);

-- Embeddings table to store both chunk and question embeddings
CREATE TABLE IF NOT EXISTS aqrag.embeddings (
    id SERIAL PRIMARY KEY,
    chunk_id INTEGER NOT NULL REFERENCES aqrag.chunks(id) ON DELETE CASCADE,
    embedding VECTOR(1536) NOT NULL,
    is_question_embedding BOOLEAN NOT NULL DEFAULT FALSE
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON aqrag.chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_chunk_id ON aqrag.embeddings(chunk_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_is_question ON aqrag.embeddings(is_question_embedding);
CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON aqrag.embeddings USING ivfflat (embedding vector_cosine_ops);
