-- ================================================
-- AUTONOMICZNE BIURO - Schema v18 (Refine query indexes)
-- ================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_heartbeats_agent_created
  ON heartbeats(agent_id, created_at DESC);

DROP INDEX IF EXISTS idx_tasks_assigned_status;
CREATE INDEX idx_tasks_assigned_status
  ON tasks(assigned_to, status)
  WHERE status NOT IN ('done', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_audit_log_company_created
  ON audit_log(company_id, created_at DESC);

DROP INDEX IF EXISTS idx_policies_company_type_active;
DROP INDEX IF EXISTS idx_policies_company_type;
CREATE INDEX idx_policies_company_type
  ON policies(company_id, type)
  WHERE is_active = true;

COMMIT;