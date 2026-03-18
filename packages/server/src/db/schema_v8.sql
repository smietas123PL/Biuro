-- ================================================
-- AUTONOMICZNE BIURO — Schema v8 (Missing Columns)
-- ================================================

ALTER TABLE agents ADD COLUMN monthly_budget_usd NUMERIC(10,2) DEFAULT 0.00;
ALTER TABLE tasks ADD COLUMN completed_at TIMESTAMPTZ;
