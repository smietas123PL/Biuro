-- ================================================
-- AUTONOMICZNE BIURO — Schema v1
-- ================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============ FIRMY ============

CREATE TABLE companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  mission     TEXT,
  config      JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ============ CELE ============

CREATE TABLE goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES goals(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'achieved', 'abandoned')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ============ AGENCI ============

CREATE TABLE agents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  title         TEXT,
  reports_to    UUID REFERENCES agents(id) ON DELETE SET NULL,
  runtime       TEXT NOT NULL DEFAULT 'gemini',
  model         TEXT NOT NULL DEFAULT 'gemini-2.0-flash',
  system_prompt TEXT,
  config        JSONB DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'working', 'paused', 'terminated')),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ============ BUDŻETY ============

CREATE TABLE budgets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  month       DATE NOT NULL,
  limit_usd   NUMERIC(10,2) NOT NULL DEFAULT 50.00,
  spent_usd   NUMERIC(10,4) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_id, month)
);

-- ============ TASKI ============

CREATE TABLE tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  goal_id       UUID REFERENCES goals(id) ON DELETE SET NULL,
  parent_id     UUID REFERENCES tasks(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  assigned_to   UUID REFERENCES agents(id) ON DELETE SET NULL,
  created_by    TEXT, 
  status        TEXT NOT NULL DEFAULT 'backlog'
    CHECK (status IN (
      'backlog', 'assigned', 'in_progress',
      'review', 'done', 'blocked', 'cancelled'
    )),
  priority      INT NOT NULL DEFAULT 0,
  locked_by     UUID REFERENCES agents(id) ON DELETE SET NULL,
  locked_at     TIMESTAMPTZ,
  result        TEXT,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ============ WIADOMOŚCI ============

CREATE TABLE messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  task_id     UUID REFERENCES tasks(id) ON DELETE CASCADE,
  from_agent  UUID REFERENCES agents(id) ON DELETE SET NULL,
  to_agent    UUID REFERENCES agents(id) ON DELETE SET NULL,
  content     TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'message'
    CHECK (type IN (
      'message', 'delegation', 'status_update',
      'approval_request', 'tool_call', 'tool_result',
      'heartbeat_log'
    )),
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============ AUDIT LOG ============

CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id    UUID REFERENCES agents(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   UUID,
  details     JSONB DEFAULT '{}',
  cost_usd    NUMERIC(10,6),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============ HEARTBEATS ============

CREATE TABLE heartbeats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  task_id     UUID REFERENCES tasks(id) ON DELETE SET NULL,
  status      TEXT NOT NULL, -- 'idle' | 'worked' | 'budget_exceeded' | 'error'
  duration_ms INT,
  cost_usd    NUMERIC(10,6),
  details     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============ SESJE AGENTÓW ============

CREATE TABLE agent_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  state       JSONB DEFAULT '{}',
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_id, task_id)
);

-- ============ UPDATED_AT TRIGGER ============

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_companies_updated BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_agents_updated BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_goals_updated BEFORE UPDATE ON goals FOR EACH ROW EXECUTE FUNCTION update_updated_at();