-- ================================================
-- AUTONOMICZNE BIURO - Schema v17 (Deduplicate query indexes)
-- ================================================

BEGIN;

DROP INDEX IF EXISTS idx_heartbeats_agent_time;
DROP INDEX IF EXISTS idx_tasks_agent_status;
DROP INDEX IF EXISTS idx_audit_company_time;

CREATE INDEX IF NOT EXISTS idx_heartbeats_agent_created
  ON heartbeats(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_status
  ON tasks(assigned_to, status);

CREATE INDEX IF NOT EXISTS idx_audit_log_company_created
  ON audit_log(company_id, created_at DESC);

COMMIT;
