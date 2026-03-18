-- Schema v7: Company Knowledge (RAG v2)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE company_knowledge (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}',
  embedding   vector(1536), -- Assuming OpenAI 1536-dim embeddings
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE company_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_knowledge_isolation ON company_knowledge
  USING (company_id = (current_setting('app.current_company_id'))::uuid);
