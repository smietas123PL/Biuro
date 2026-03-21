-- ================================================
-- AUTONOMICZNE BIURO — Schema v2 (Tools & Governance)
-- ================================================

-- ============ TOOLS ============

CREATE TABLE tools (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  type        TEXT NOT NULL CHECK (type IN ('builtin', 'http', 'bash', 'mcp')),
  config      JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, name)
);

CREATE TABLE agent_tools (
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tool_id     UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  can_execute BOOLEAN DEFAULT true,
  config      JSONB DEFAULT '{}',
  PRIMARY KEY (agent_id, tool_id)
);

-- ============ GOVERNANCE ============

CREATE TABLE policies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  type         TEXT NOT NULL CHECK (type IN (
    'approval_required', 'budget_threshold', 
    'delegation_limit', 'rate_limit', 'tool_restriction'
  )),
  rules        JSONB NOT NULL DEFAULT '{}',
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE approvals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  task_id           UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  requested_by_agent UUID REFERENCES agents(id) ON DELETE SET NULL,
  policy_id         UUID REFERENCES policies(id) ON DELETE SET NULL,
  reason            TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'approved', 'rejected')),
  resolution_notes  TEXT,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ============ LOGS EXTENSION ============

CREATE TABLE tool_calls (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID REFERENCES agents(id) ON DELETE SET NULL,
  task_id     UUID REFERENCES tasks(id) ON DELETE SET NULL,
  tool_id     UUID REFERENCES tools(id) ON DELETE SET NULL,
  input       JSONB,
  output      JSONB,
  status      TEXT CHECK (status IN ('success', 'error')),
  duration_ms INT,
  created_at  TIMESTAMPTZ DEFAULT now()
);