-- ================================================
-- AUTONOMICZNE BIURO - Schema v19 (Synaptic Knowledge Graph)
-- ================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE knowledge_nodes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('memory', 'document', 'agent', 'client', 'project', 'topic')),
  label         TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  summary       TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  embedding     VECTOR(1536),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, kind, canonical_key)
);

CREATE TABLE knowledge_edges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  from_node_id UUID NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  to_node_id   UUID NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  relation     TEXT NOT NULL CHECK (relation IN ('mentions', 'learned', 'co_occurs')),
  weight       NUMERIC(10,4) NOT NULL DEFAULT 1,
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, from_node_id, to_node_id, relation)
);

CREATE INDEX idx_knowledge_nodes_company_kind
  ON knowledge_nodes(company_id, kind, updated_at DESC);

CREATE INDEX idx_knowledge_nodes_company_canonical
  ON knowledge_nodes(company_id, canonical_key);

CREATE INDEX idx_knowledge_edges_company_from
  ON knowledge_edges(company_id, from_node_id, relation);

CREATE INDEX idx_knowledge_edges_company_to
  ON knowledge_edges(company_id, to_node_id, relation);

CREATE INDEX idx_knowledge_nodes_embedding
  ON knowledge_nodes USING ivfflat (embedding vector_l2_ops) WITH (lists = 100);

ALTER TABLE knowledge_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_nodes_isolation ON knowledge_nodes
  USING (company_id = (current_setting('app.current_company_id'))::uuid);

CREATE POLICY knowledge_edges_isolation ON knowledge_edges
  USING (company_id = (current_setting('app.current_company_id'))::uuid);