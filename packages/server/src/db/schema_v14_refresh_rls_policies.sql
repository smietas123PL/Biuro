-- ================================================
-- AUTONOMICZNE BIURO - Schema v14 (Refresh RLS policies)
-- ================================================

BEGIN;

CREATE OR REPLACE FUNCTION biuro_current_company_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_company_id', true), '')::uuid
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION biuro_current_user_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION biuro_is_internal_context()
RETURNS BOOLEAN AS $$
  SELECT biuro_current_company_id() IS NULL AND biuro_current_user_id() IS NULL
$$ LANGUAGE sql STABLE;

DROP POLICY IF EXISTS company_isolation_policy ON companies;
DROP POLICY IF EXISTS agents_isolation_policy ON agents;
DROP POLICY IF EXISTS tasks_isolation_policy ON tasks;
DROP POLICY IF EXISTS goals_isolation_policy ON goals;
DROP POLICY IF EXISTS messages_isolation_policy ON messages;
DROP POLICY IF EXISTS audit_log_isolation_policy ON audit_log;
DROP POLICY IF EXISTS tools_isolation_policy ON tools;
DROP POLICY IF EXISTS policies_isolation_policy ON policies;
DROP POLICY IF EXISTS approvals_isolation_policy ON approvals;
DROP POLICY IF EXISTS agent_memory_isolation_policy ON agent_memory;
DROP POLICY IF EXISTS company_credits_isolation_policy ON company_credits;
DROP POLICY IF EXISTS billing_transactions_isolation_policy ON billing_transactions;
DROP POLICY IF EXISTS company_knowledge_isolation ON company_knowledge;
DROP POLICY IF EXISTS retrieval_metrics_isolation_policy ON retrieval_metrics;

DROP POLICY IF EXISTS companies_select_policy ON companies;
DROP POLICY IF EXISTS companies_insert_policy ON companies;
DROP POLICY IF EXISTS companies_write_policy ON companies;

DROP POLICY IF EXISTS direct_company_scope_policy ON agents;
DROP POLICY IF EXISTS direct_company_scope_policy ON tasks;
DROP POLICY IF EXISTS direct_company_scope_policy ON goals;
DROP POLICY IF EXISTS direct_company_scope_policy ON messages;
DROP POLICY IF EXISTS direct_company_scope_policy ON audit_log;
DROP POLICY IF EXISTS direct_company_scope_policy ON tools;
DROP POLICY IF EXISTS direct_company_scope_policy ON policies;
DROP POLICY IF EXISTS direct_company_scope_policy ON approvals;
DROP POLICY IF EXISTS direct_company_scope_policy ON agent_memory;
DROP POLICY IF EXISTS direct_company_scope_policy ON company_credits;
DROP POLICY IF EXISTS direct_company_scope_policy ON billing_transactions;
DROP POLICY IF EXISTS direct_company_scope_policy ON company_knowledge;
DROP POLICY IF EXISTS direct_company_scope_policy ON retrieval_metrics;

DROP POLICY IF EXISTS budgets_company_scope_policy ON budgets;
DROP POLICY IF EXISTS heartbeats_company_scope_policy ON heartbeats;
DROP POLICY IF EXISTS agent_sessions_company_scope_policy ON agent_sessions;
DROP POLICY IF EXISTS agent_tools_company_scope_policy ON agent_tools;
DROP POLICY IF EXISTS tool_calls_company_scope_policy ON tool_calls;
DROP POLICY IF EXISTS user_roles_scope_policy ON user_roles;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE retrieval_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_select_policy ON companies
  FOR SELECT
  USING (
    biuro_is_internal_context()
    OR id = biuro_current_company_id()
    OR EXISTS (
      SELECT 1
      FROM user_roles ur
      WHERE ur.company_id = companies.id
        AND ur.user_id = biuro_current_user_id()
    )
  );

CREATE POLICY companies_insert_policy ON companies
  FOR INSERT
  WITH CHECK (
    biuro_is_internal_context()
    OR biuro_current_user_id() IS NOT NULL
  );

CREATE POLICY companies_write_policy ON companies
  FOR UPDATE
  USING (
    biuro_is_internal_context()
    OR id = biuro_current_company_id()
    OR EXISTS (
      SELECT 1
      FROM user_roles ur
      WHERE ur.company_id = companies.id
        AND ur.user_id = biuro_current_user_id()
    )
  )
  WITH CHECK (
    biuro_is_internal_context()
    OR id = biuro_current_company_id()
  );

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agents',
    'goals',
    'tasks',
    'messages',
    'audit_log',
    'tools',
    'policies',
    'approvals',
    'agent_memory',
    'company_credits',
    'billing_transactions',
    'company_knowledge',
    'retrieval_metrics'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY direct_company_scope_policy ON %I FOR ALL USING (biuro_is_internal_context() OR company_id = biuro_current_company_id()) WITH CHECK (biuro_is_internal_context() OR company_id = biuro_current_company_id())',
      table_name
    );
  END LOOP;
END $$;

CREATE POLICY budgets_company_scope_policy ON budgets
  FOR ALL
  USING (
    biuro_is_internal_context()
    OR EXISTS (
      SELECT 1
      FROM agents a
      WHERE a.id = budgets.agent_id
        AND a.company_id = biuro_current_company_id()
    )
  )
  WITH CHECK (
    biuro_is_internal_context()
    OR EXISTS (
      SELECT 1
      FROM agents a
      WHERE a.id = budgets.agent_id
        AND a.company_id = biuro_current_company_id()
    )
  );

CREATE POLICY heartbeats_company_scope_policy ON heartbeats
  FOR ALL
  USING (
    biuro_is_internal_context()
    OR EXISTS (
      SELECT 1
      FROM agents a
      WHERE a.id = heartbeats.agent_id
        AND a.company_id = biuro_current_company_id()
    )
  )
  WITH CHECK (
    biuro_is_internal_context()
    OR EXISTS (
      SELECT 1
      FROM agents a
      WHERE a.id = heartbeats.agent_id
        AND a.company_id = biuro_current_company_id()
    )
  );

CREATE POLICY agent_sessions_company_scope_policy ON agent_sessions
  FOR ALL
  USING (
    biuro_is_internal_context()
    OR EXISTS (
      SELECT 1
      FROM tasks t
      WHERE t.id = agent_sessions.task_id
        AND t.company_id = biuro_current_company_id()
    )
    OR EXISTS (
      SELECT 1
      FROM agents a
      WHERE a.id = agent_sessions.agent_id
        AND a.company_id = biuro_current_company_id()
    )
  )
  WITH CHECK (
    biuro_is_internal_context()
    OR EXISTS (
      SELECT 1
      FROM tasks t
      WHERE t.id = agent_sessions.task_id
        AND t.company_id = biuro_current_company_id()
    )
    OR EXISTS (
      SELECT 1
      FROM agents a
      WHERE a.id = agent_sessions.agent_id
        AND a.company_id = biuro_current_company_id()
    )
  );

CREATE POLICY agent_tools_company_scope_policy ON agent_tools
  FOR ALL
  USING (
    biuro_is_internal_context()
    OR EXISTS (
      SELECT 1
      FROM agents a
      WHERE a.id = agent_tools.agent_id
        AND a.company_id = biuro_current_company_id()
    )
    OR EXISTS (
      SELECT 1
      FROM tools t
      WHERE t.id = agent_tools.tool_id
        AND t.company_id = biuro_current_company_id()
    )
  )
  WITH CHECK (
    biuro_is_internal_context()
    OR EXISTS (
      SELECT 1
      FROM agents a
      WHERE a.id = agent_tools.agent_id
        AND a.company_id = biuro_current_company_id()
    )
    OR EXISTS (
      SELECT 1
      FROM tools t
      WHERE t.id = agent_tools.tool_id
        AND t.company_id = biuro_current_company_id()
    )
  );

CREATE POLICY tool_calls_company_scope_policy ON tool_calls
  FOR ALL
  USING (
    biuro_is_internal_context()
    OR EXISTS (
      SELECT 1
      FROM tasks t
      WHERE t.id = tool_calls.task_id
        AND t.company_id = biuro_current_company_id()
    )
    OR EXISTS (
      SELECT 1
      FROM tools tool_ref
      WHERE tool_ref.id = tool_calls.tool_id
        AND tool_ref.company_id = biuro_current_company_id()
    )
    OR EXISTS (
      SELECT 1
      FROM agents a
      WHERE a.id = tool_calls.agent_id
        AND a.company_id = biuro_current_company_id()
    )
  )
  WITH CHECK (
    biuro_is_internal_context()
    OR EXISTS (
      SELECT 1
      FROM tasks t
      WHERE t.id = tool_calls.task_id
        AND t.company_id = biuro_current_company_id()
    )
    OR EXISTS (
      SELECT 1
      FROM tools tool_ref
      WHERE tool_ref.id = tool_calls.tool_id
        AND tool_ref.company_id = biuro_current_company_id()
    )
    OR EXISTS (
      SELECT 1
      FROM agents a
      WHERE a.id = tool_calls.agent_id
        AND a.company_id = biuro_current_company_id()
    )
  );

CREATE POLICY user_roles_scope_policy ON user_roles
  FOR ALL
  USING (
    biuro_is_internal_context()
    OR user_id = biuro_current_user_id()
    OR company_id = biuro_current_company_id()
  )
  WITH CHECK (
    biuro_is_internal_context()
    OR user_id = biuro_current_user_id()
    OR company_id = biuro_current_company_id()
  );

COMMIT;
