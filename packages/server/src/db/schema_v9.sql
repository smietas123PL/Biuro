-- ================================================
-- AUTONOMICZNE BIURO - Schema v9 (Indexes & Auth Hardening)
-- ================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
CREATE INDEX IF NOT EXISTS idx_tasks_agent_status ON tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tasks_company_status_priority ON tasks(company_id, status, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_heartbeats_agent_time ON heartbeats(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_company_time ON audit_log(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_task_agent_time ON messages(task_id, from_agent, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_company_status ON approvals(company_id, status, created_at DESC);