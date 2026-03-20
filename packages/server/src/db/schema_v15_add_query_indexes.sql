-- ================================================
-- AUTONOMICZNE BIURO - Schema v15 (Add query indexes)
-- ================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_heartbeats_agent_created
  ON heartbeats(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_status
  ON tasks(assigned_to, status);

CREATE INDEX IF NOT EXISTS idx_audit_log_company_created
  ON audit_log(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_policies_company_type_active
  ON policies(company_id, type, is_active);

COMMIT;
