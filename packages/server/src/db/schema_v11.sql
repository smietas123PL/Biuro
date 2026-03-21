-- Schema v11: Vector indexes for semantic retrieval

CREATE EXTENSION IF NOT EXISTS vector;

DROP INDEX IF EXISTS agent_memory_embedding_idx;

CREATE INDEX IF NOT EXISTS idx_agent_memory_embedding_cosine
  ON agent_memory
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_company_knowledge_embedding_cosine
  ON company_knowledge
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);