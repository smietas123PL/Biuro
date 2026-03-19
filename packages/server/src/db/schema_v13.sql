-- ================================================
-- AUTONOMICZNE BIURO - Schema v13 (Gemini default runtime)
-- ================================================

ALTER TABLE agents
  ALTER COLUMN runtime SET DEFAULT 'gemini';

ALTER TABLE agents
  ALTER COLUMN model SET DEFAULT 'gemini-2.0-flash';
