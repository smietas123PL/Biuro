-- Schema v12: Retrieval quality metrics

CREATE TABLE IF NOT EXISTS retrieval_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  scope TEXT NOT NULL CHECK (scope IN ('knowledge', 'memory')),
  consumer TEXT NOT NULL,
  query_preview TEXT NOT NULL,
  query_length INT NOT NULL DEFAULT 0,
  limit_requested INT NOT NULL DEFAULT 0,
  result_count INT NOT NULL DEFAULT 0,
  lexical_candidate_count INT NOT NULL DEFAULT 0,
  vector_candidate_count INT NOT NULL DEFAULT 0,
  overlap_count INT NOT NULL DEFAULT 0,
  top_distance NUMERIC(12,6),
  embedding_source TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  latency_ms INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retrieval_metrics_company_time
  ON retrieval_metrics(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_retrieval_metrics_company_scope_time
  ON retrieval_metrics(company_id, scope, created_at DESC);
